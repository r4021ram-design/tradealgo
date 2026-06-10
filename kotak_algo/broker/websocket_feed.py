from __future__ import annotations

import math
import threading
import time
from datetime import datetime, time as dt_time
from typing import Any

from kotak_algo.exceptions import ConnectionLostError, ReconnectFailedError, InvalidMarketDataError
from kotak_algo.utils.logger import get_logger
from kotak_algo.events import event_bus, Event, EventNames


class WebSocketFeed:
    """
    Resilient WebSocket feed with:
      - Auto-reconnect with exponential backoff
      - Heartbeat monitoring (stale data detection)
      - Automatic re-subscribe after reconnect
      - Tick data validation
    """

    MAX_RECONNECT_ATTEMPTS = 20
    HEARTBEAT_TIMEOUT_S = 60  # No message for 60s → force reconnect
    STALE_SYMBOL_THRESHOLD_S = 30  # Per-symbol stale detection

    def __init__(self, broker, position_tracker, notifier=None, logger=None) -> None:
        self.broker = broker
        self.position_tracker = position_tracker
        self.notifier = notifier
        self.logger = (logger or get_logger("websocket")).bind(component="websocket")
        self.connected = False
        self._subscribed: dict[str, dict[str, str]] = {}
        self._reconnect_count = 0
        self._backoff = 1.0
        self._last_message_time: float = 0.0
        self._symbol_last_tick: dict[str, float] = {}
        self._symbol_last_dedup: dict[str, tuple] = {}  # tuple dedup (faster than dict)
        self._should_run = False
        self._heartbeat_thread: threading.Thread | None = None
        self._has_watchlist_map: bool = False  # cached hasattr check
        
        # Configuration
        self.MAX_RECONNECT_ATTEMPTS = 20
        self.HEARTBEAT_TIMEOUT_S = 30
        self.STALE_SYMBOL_THRESHOLD_S = 60
        self._last_cleanup_time = time.monotonic()
        
        # Tick validation threshold
        self._MAX_TICK_JUMP_PCT = 20.0

    def start(self) -> None:
        self._should_run = True
        
        # Apply SDK monkey-patch to prevent duplicate websocket threads
        try:
            import neo_api_client
            if hasattr(neo_api_client, "NeoWebSocket"):
                def patched_start_websocket_thread(ws_self):
                    if hasattr(ws_self, "hsw_thread") and ws_self.hsw_thread and ws_self.hsw_thread.is_alive():
                        self.logger.info("sdk_websocket_thread_already_running_skipping_spawn")
                        return
                    import threading as py_threading
                    ws_self.hsw_thread = py_threading.Thread(target=ws_self.start_websocket)
                    ws_self.hsw_thread.start()
                neo_api_client.NeoWebSocket.start_websocket_thread = patched_start_websocket_thread
                self.logger.info("sdk_websocket_thread_patched")
        except Exception as patch_err:
            self.logger.error("failed_to_patch_sdk_websocket", error=str(patch_err))
        
        # Cache watchlist_map check once at start
        self._has_watchlist_map = hasattr(self.position_tracker, "watchlist_map")
        
        # Register for re-authentication notifications from the broker
        self.broker.register_reauth_listener(self._on_reauth)
        
        client = self.broker.client
        client.on_message = self.on_message
        client.on_error = self.on_error
        client.on_close = self.on_close
        client.on_open = self.on_open
        self.logger.info("websocket_callbacks_registered")

        # Start heartbeat monitor
        self._heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self._heartbeat_thread.start()

    def _on_reauth(self, new_client: Any) -> None:
        """Callback from broker when session is refreshed."""
        self.logger.info("websocket_refreshing_client_after_reauth")
        
        was_stopped = not self._should_run
        self._should_run = True
        self._reconnect_count = 0
        self._backoff = 1.0
        
        # Update callbacks on the new client instance
        new_client.on_message = self.on_message
        new_client.on_error = self.on_error
        new_client.on_close = self.on_close
        new_client.on_open = self.on_open
        
        # Resubscribe using the new session
        if self._subscribed:
            self.logger.info("re_subscribing_after_reauth", count=len(self._subscribed))
            try:
                self._execute_subscribe(new_client, list(self._subscribed.values()))
            except Exception as e:
                self.logger.error("re_subscribe_failed_after_reauth", error=str(e))
                
        # Restart heartbeat thread if it died
        if was_stopped or not self._heartbeat_thread or not self._heartbeat_thread.is_alive():
            self.logger.info("restarting_heartbeat_loop")
            self._heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
            self._heartbeat_thread.start()

    def stop(self) -> None:
        self._should_run = False
        self.connected = False
        self.logger.info("websocket_stopped")

    def _execute_subscribe(self, client: Any, tokens: list[dict[str, str]]) -> None:
        if not tokens:
            return
        
        index_tokens = []
        non_index_tokens = []
        index_set = {"26000", "26009", "1", "12", "26017", "26067"}
        
        for token in tokens:
            if token.get("instrument_token") in index_set:
                index_tokens.append(token)
            else:
                non_index_tokens.append(token)
                
        if index_tokens:
            client.subscribe(
                instrument_tokens=index_tokens,
                isIndex=True,
                isDepth=False,
            )
            self.logger.info("websocket_subscribed_indices", count=len(index_tokens))
        if non_index_tokens:
            client.subscribe(
                instrument_tokens=non_index_tokens,
                isIndex=False,
                isDepth=False,
            )
            self.logger.info("websocket_subscribed_non_indices", count=len(non_index_tokens))

    def subscribe(self, tokens: list[dict[str, str]]) -> None:
        if not tokens:
            return
        for token in tokens:
            token_key = f"{token['exchange_segment']}:{token['instrument_token']}"
            self._subscribed[token_key] = token
        unique_tokens = list(self._subscribed.values())
        try:
            self._execute_subscribe(self.broker.client, unique_tokens)
        except Exception as exc:
            self.logger.error("subscribe_failed", error=str(exc))

    # ── Callbacks ────────────────────────────────────────────────

    def on_message(self, message: Any) -> None:
        now = time.monotonic()  # Single syscall, reuse everywhere
        self._last_message_time = now
        
        # Handle wrapped stock feed list or quotes list from the Kotak SDK
        if isinstance(message, dict) and message.get("type") in ("stock_feed", "quotes") and isinstance(message.get("data"), list):
            for tick in message["data"]:
                try:
                    self.on_message(tick)
                except Exception as tick_err:
                    self.logger.error("error_processing_individual_tick", error=str(tick_err))
            return

        # Fast-path extraction — no logging on hot path
        parsed = self._extract_market_data(message)
        if not parsed:
            return

        token = parsed.get("instrument_token")
        if token and self._has_watchlist_map and token in self.position_tracker.watchlist_map:
            parsed["trading_symbol"] = self.position_tracker.watchlist_map[token]

        symbol = parsed.get("trading_symbol") or token
        if not symbol:
            return

        # Fetch previous values from tracker to support partial/differential updates
        prev_data = self.position_tracker.market_data.get(symbol, {})
        
        ltp = parsed.get("ltp")
        if ltp is None or ltp == 0.0:
            ltp = prev_data.get("ltp")
            
        bid = parsed.get("bid")
        if bid is None or bid == 0.0:
            bid = prev_data.get("bid")
            
        ask = parsed.get("ask")
        if ask is None or ask == 0.0:
            ask = prev_data.get("ask")

        # If we still don't have a valid LTP, we cannot process this tick
        if ltp is None or ltp <= 0.0:
            return

        # --- Fast Tuple Deduplication (no dict allocation) ---
        dedup_key = (ltp, bid, ask, parsed.get("volume"))
        if self._symbol_last_dedup.get(symbol) == dedup_key:
            return
        self._symbol_last_dedup[symbol] = dedup_key

        # Update parsed dictionary with merged values
        parsed["ltp"] = ltp
        parsed["bid"] = bid
        parsed["ask"] = ask

        # Merge change/percent_change from previous data if not in this tick
        change = parsed.get("change")
        if change is None:
            prev_change = prev_data.get("change")
            if prev_change is not None:
                parsed["change"] = prev_change

        pct_change = parsed.get("percent_change")
        if pct_change is None:
            prev_pct = prev_data.get("percent_change")
            if prev_pct is not None:
                parsed["percent_change"] = prev_pct

        # --- Inline Tick Validation (no function call overhead) ---
        if math.isnan(ltp) or math.isinf(ltp):
            return
        prev_ltp = self.position_tracker.ltp(symbol)
        if prev_ltp and prev_ltp > 0:
            pct_jump = abs(ltp - prev_ltp) / prev_ltp * 100
            if pct_jump > self._MAX_TICK_JUMP_PCT:
                self.logger.warning("large_tick_jump", symbol=symbol, prev=prev_ltp, ltp=ltp, pct=round(pct_jump, 1))

        self._symbol_last_tick[symbol] = now
        self.position_tracker.update_market_data(**parsed)

    def on_error(self, error_message: Any) -> None:
        self.logger.error("websocket_error", error_message=error_message)
        if self._should_run:
            self._attempt_reconnect(reason=f"error: {error_message}")

    def on_close(self, message: Any) -> None:
        was_connected = self.connected
        self.connected = False
        self.logger.warning("websocket_closed", message=message)
        if was_connected and self._should_run:
            self._attempt_reconnect(reason=f"closed: {message}")

    def on_open(self, message: Any) -> None:
        self.connected = True
        self._reconnect_count = 0
        self._backoff = 1.0
        self._last_message_time = time.monotonic()
        self.logger.info("websocket_opened", message=message)

        # Re-subscribe all tokens after reconnect
        if self._subscribed:
            self.logger.info("re_subscribing_after_reconnect", count=len(self._subscribed))
            try:
                self._execute_subscribe(self.broker.client, list(self._subscribed.values()))
            except Exception as exc:
                self.logger.error("re_subscribe_failed", error=str(exc))

    # ── Auto Reconnect ───────────────────────────────────────────

    def _attempt_reconnect(self, reason: str = "") -> None:
        if not self._should_run:
            return

        self._reconnect_count += 1
        if self._reconnect_count > self.MAX_RECONNECT_ATTEMPTS:
            self._should_run = False
            self.logger.error("max_reconnects_exceeded", attempts=self._reconnect_count)
            event_bus.publish(Event(EventNames.RECONNECT_FAILED, {
                "attempts": self._reconnect_count,
                "reason": reason,
            }))
            if self.notifier:
                self.notifier.send(
                    f"🚨 WebSocket FAILED to reconnect after {self.MAX_RECONNECT_ATTEMPTS} attempts. "
                    f"Live data feed is DOWN."
                )
            return

        delay = min(self._backoff, 30.0)
        self.logger.info(
            "reconnecting",
            attempt=self._reconnect_count,
            delay=delay,
            reason=reason,
        )
        event_bus.publish(Event(EventNames.RECONNECT_STARTED, {
            "attempt": self._reconnect_count,
            "reason": reason,
        }))

        time.sleep(delay)
        self._backoff = min(self._backoff * 2, 30.0)

        try:
            client = self.broker.client
            client.on_message = self.on_message
            client.on_error = self.on_error
            client.on_close = self.on_close
            client.on_open = self.on_open
            
            if self._subscribed:
                self.logger.info("re_subscribing_in_reconnect", count=len(self._subscribed))
                self._execute_subscribe(client, list(self._subscribed.values()))
            
            self.logger.info("reconnect_callbacks_re_registered")
            event_bus.publish(Event(EventNames.RECONNECT_SUCCEEDED))
        except Exception as exc:
            self.logger.error("reconnect_failed", error=str(exc))
            # Will retry on next close/error callback

    # ── Heartbeat Monitor ────────────────────────────────────────

    def _heartbeat_loop(self) -> None:
        """Background thread that checks for stale connections."""
        while self._should_run:
            time.sleep(10)

            if not self.connected:
                continue

            # Check global heartbeat
            if self._last_message_time > 0:
                silence = time.monotonic() - self._last_message_time
                if silence > self.HEARTBEAT_TIMEOUT_S:
                    # Only alert/reconnect if it's market hours (09:15 - 15:30)
                    now_time = datetime.now().time()
                    if dt_time(9, 15) <= now_time <= dt_time(15, 30):
                        self.logger.warning("heartbeat_timeout", silence_seconds=round(silence, 1))
                        self._attempt_reconnect(reason="heartbeat_timeout")

            # Check per-symbol staleness
            now = time.monotonic()
            for symbol, last_tick in list(self._symbol_last_tick.items()):
                age = now - last_tick
                if age > self.STALE_SYMBOL_THRESHOLD_S:
                    event_bus.publish(Event(EventNames.STALE_DATA_DETECTED, {
                        "symbol": symbol,
                        "age_seconds": round(age, 1),
                    }))

            # Periodic Memory Cleanup
            if now - self._last_cleanup_time > 3600:
                self._cleanup_memory()
                self._last_cleanup_time = now

    def _cleanup_memory(self) -> None:
        """Prune tracking data for symbols not seen in > 1 hour."""
        now = time.monotonic()
        stale_threshold = 3600
        initial_count = len(self._symbol_last_dedup)
        
        # Keep only recently active or currently subscribed symbols
        active_symbols = {s for s, t in self._symbol_last_tick.items() if now - t < stale_threshold}
        subscribed_symbols = {v["trading_symbol"] for v in self._subscribed.values() if "trading_symbol" in v}
        keep_symbols = active_symbols | subscribed_symbols
        
        self._symbol_last_dedup = {s: p for s, p in self._symbol_last_dedup.items() if s in keep_symbols}
        self._symbol_last_tick = {s: t for s, t in self._symbol_last_tick.items() if s in keep_symbols}
        
        pruned = initial_count - len(self._symbol_last_dedup)
        if pruned > 0:
            self.logger.info("websocket_memory_cleanup", pruned_symbols=pruned)

    # ── Data Extraction ──────────────────────────────────────────

    @staticmethod
    def _extract_market_data(message: Any) -> dict[str, Any] | None:
        if not isinstance(message, dict):
            return None

        symbol = message.get("trading_symbol") or message.get("ts") or message.get("symbol")
        token = message.get("instrument_token") or message.get("tk") or message.get("token")
        ltp = message.get("ltp") or message.get("iv") or message.get("last_traded_price") or message.get("lastPrice")
        bid = message.get("best_bid_price") or message.get("bp") or message.get("bid")
        ask = message.get("best_ask_price") or message.get("sp") or message.get("ask")
        change = message.get("cng") or message.get("change") or message.get("netChange")
        percent_change = message.get("nc") or message.get("percent_change") or message.get("percentChange")
        close = message.get("c") or message.get("close") or message.get("prev_close")
        volume = message.get("v") or message.get("volume")
        if symbol is None and token is None:
            return None
        result = {
            "trading_symbol": symbol,
            "instrument_token": str(token) if token is not None else None,
            "ltp": float(ltp) if ltp is not None else None,
            "bid": float(bid) if bid is not None else None,
            "ask": float(ask) if ask is not None else None,
        }
        if change is not None:
            result["change"] = float(change)
        if percent_change is not None:
            result["percent_change"] = float(percent_change)
        if close is not None:
            result["close"] = float(close)
        if volume is not None:
            result["volume"] = int(volume)
        return result

    def to_dict(self) -> dict:
        """Health status for the /api/health endpoint."""
        return {
            "connected": self.connected,
            "subscribed_symbols": len(self._subscribed),
            "reconnect_count": self._reconnect_count,
            "last_message_age_s": round(time.monotonic() - self._last_message_time, 1) if self._last_message_time else None,
        }
