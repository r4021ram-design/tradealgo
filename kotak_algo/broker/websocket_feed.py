from __future__ import annotations

import threading
import time
from datetime import datetime, time as dt_time
from typing import Any

from kotak_algo.exceptions import ConnectionLostError, ReconnectFailedError
from kotak_algo.utils.api_validator import validate_tick
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
        self._symbol_last_payload: dict[str, dict[str, Any]] = {}  # For deduplication
        self._should_run = False
        self._heartbeat_thread: threading.Thread | None = None
        
        # Configuration
        self.MAX_RECONNECT_ATTEMPTS = 20
        self.HEARTBEAT_TIMEOUT_S = 30
        self.STALE_SYMBOL_THRESHOLD_S = 60
        self._last_cleanup_time = time.monotonic()

    def start(self) -> None:
        self._should_run = True
        
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
                new_client.subscribe(
                    instrument_tokens=list(self._subscribed.values()),
                    isIndex=False,
                    isDepth=False,
                )
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

    def subscribe(self, tokens: list[dict[str, str]]) -> None:
        if not tokens:
            return
        for token in tokens:
            token_key = f"{token['exchange_segment']}:{token['instrument_token']}"
            self._subscribed[token_key] = token
        unique_tokens = list(self._subscribed.values())
        try:
            self.broker.client.subscribe(
                instrument_tokens=unique_tokens,
                isIndex=False,
                isDepth=False,
            )
            self.logger.info("websocket_subscribed", count=len(unique_tokens))
        except Exception as exc:
            self.logger.error("subscribe_failed", error=str(exc))

    # ── Callbacks ────────────────────────────────────────────────

    def on_message(self, message: Any) -> None:
        self._last_message_time = time.monotonic()
        parsed = self._extract_market_data(message)
        if not parsed:
            return

        symbol = parsed.get("trading_symbol") or parsed.get("instrument_token")
        if not symbol:
            return

        # --- Tick Deduplication ---
        # We use LTP + Bid + Ask + Volume (if available) to detect duplicates
        current_payload = {
            "lp": parsed.get("ltp"),
            "b": parsed.get("bid"),
            "a": parsed.get("ask"),
            "v": parsed.get("v")  # Kotak might provide volume
        }
        if self._symbol_last_payload.get(symbol) == current_payload:
            return
            
        self._symbol_last_payload[symbol] = current_payload

        # Validate tick data
        ltp = parsed.get("ltp", 0.0)
        prev_ltp = self.position_tracker.ltp(symbol)

        try:
            validate_tick(ltp, parsed.get("bid"), parsed.get("ask"), prev_ltp, symbol)
        except Exception as exc:
            self.logger.warning("invalid_tick_rejected", symbol=symbol, error=str(exc))
            return

        self._symbol_last_tick[symbol] = time.monotonic()
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
                self.broker.client.subscribe(
                    instrument_tokens=list(self._subscribed.values()),
                    isIndex=False,
                    isDepth=False,
                )
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
                client.subscribe(
                    instrument_tokens=list(self._subscribed.values()),
                    isIndex=False,
                    isDepth=False,
                )
            
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
        initial_count = len(self._symbol_last_payload)
        
        # Keep only recently active or currently subscribed symbols
        active_symbols = {s for s, t in self._symbol_last_tick.items() if now - t < stale_threshold}
        subscribed_symbols = {v["trading_symbol"] for v in self._subscribed.values() if "trading_symbol" in v}
        keep_symbols = active_symbols | subscribed_symbols
        
        self._symbol_last_payload = {s: p for s, p in self._symbol_last_payload.items() if s in keep_symbols}
        self._symbol_last_tick = {s: t for s, t in self._symbol_last_tick.items() if s in keep_symbols}
        
        pruned = initial_count - len(self._symbol_last_payload)
        if pruned > 0:
            self.logger.info("websocket_memory_cleanup", pruned_symbols=pruned)

    # ── Data Extraction ──────────────────────────────────────────

    @staticmethod
    def _extract_market_data(message: Any) -> dict[str, Any] | None:
        if not isinstance(message, dict):
            return None

        symbol = message.get("trading_symbol") or message.get("ts") or message.get("symbol")
        token = message.get("instrument_token") or message.get("token")
        ltp = message.get("ltp") or message.get("last_traded_price") or message.get("lastPrice")
        bid = message.get("best_bid_price") or message.get("bid")
        ask = message.get("best_ask_price") or message.get("ask")
        if symbol is None and token is None:
            return None
        return {
            "trading_symbol": symbol,
            "instrument_token": str(token) if token is not None else None,
            "ltp": float(ltp) if ltp is not None else 0.0,
            "bid": float(bid) if bid is not None else None,
            "ask": float(ask) if ask is not None else None,
        }

    def to_dict(self) -> dict:
        """Health status for the /api/health endpoint."""
        return {
            "connected": self.connected,
            "subscribed_symbols": len(self._subscribed),
            "reconnect_count": self._reconnect_count,
            "last_message_age_s": round(time.monotonic() - self._last_message_time, 1) if self._last_message_time else None,
        }
