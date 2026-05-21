from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from kotak_algo.core.greeks_engine import calculate_greeks
from kotak_algo.exceptions import SessionExpiredError
from kotak_algo.utils.api_validator import validate_positions_response, validate_tick
from kotak_algo.utils.logger import get_logger
from kotak_algo.events import event_bus, Event, EventNames

OPTION_REGEX = re.compile(r'^(?P<symbol>[A-Za-z]+)(?P<expiry>\d{1,2}[A-Za-z]{3}(?:\d{2,4})?)(?P<strike>\d+(?:\.\d+)?)(?P<type>CE|PE)$', re.IGNORECASE)

def parse_expiry(expiry_str: str) -> datetime:
    expiry_str = expiry_str.upper()
    try:
        if len(expiry_str) <= 5:
            dt = datetime.strptime(expiry_str, "%d%b")
            return dt.replace(year=datetime.now().year, hour=15, minute=30, second=0)
        elif len(expiry_str) == 7:
            dt = datetime.strptime(expiry_str, "%d%b%y")
            return dt.replace(hour=15, minute=30, second=0)
        else:
            dt = datetime.strptime(expiry_str, "%d%b%Y")
            return dt.replace(hour=15, minute=30, second=0)
    except ValueError:
        return datetime.now().replace(hour=15, minute=30, second=0)


class PositionTracker:
    """
    Enhanced position tracker with:
      - Typed error handling in poll loop
      - Tick data validation
      - Consecutive failure monitoring with alerts
      - Per-symbol tick freshness tracking
    """

    MAX_CONSECUTIVE_POLL_FAILURES = 5

    def __init__(self, client_provider, poll_interval: int = 5, notifier=None, logger=None) -> None:
        self.client_provider = client_provider
        self.poll_interval = poll_interval
        self.notifier = notifier
        self.logger = (logger or get_logger("position_tracker")).bind(component="position_tracker")
        self.market_data: dict[str, dict[str, float | str | None]] = {}
        self.legs: dict[str, dict[str, Any]] = {}
        self.strategy_net_premium: dict[str, float] = {}
        self.margin_used = 0.0
        self._running = False
        self._thread: threading.Thread | None = None
        self._listeners = []
        self._snapshot_dir = Path(__file__).resolve().parents[1] / "snapshots"
        self._snapshot_dir.mkdir(parents=True, exist_ok=True)
        self._consecutive_poll_failures = 0
        self._symbol_last_update: dict[str, float] = {}

    @property
    def consecutive_poll_failures(self) -> int:
        return self._consecutive_poll_failures

    def register_listener(self, callback: Any) -> None:
        if callback not in self._listeners:
            self._listeners.append(callback)

    def start(self) -> None:
        self._running = True
        self._thread = threading.Thread(target=self._poll_positions, daemon=True)
        self._thread.start()
        self.logger.info("position_tracker_started", poll_interval=self.poll_interval)

    def stop(self) -> None:
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        self.logger.info("position_tracker_stopped")

    def attach_strategy_leg(self, strategy_name: str, leg: dict[str, Any]) -> None:
        symbol = leg["trading_symbol"]
        self.legs[symbol] = {
            "strategy": strategy_name,
            "trading_symbol": symbol,
            "instrument_token": leg["instrument_token"],
            "entry_price": float(leg.get("entry_price", 0.0)),
            "sl_level": float(leg.get("sl_level", 0.0)),
            "quantity": leg["lot_size"] * leg["lots"],
            "side": "SHORT",
            "exchange_segment": leg["exchange_segment"],
            "product": leg["product"],
            "status": "OPEN",
            "realized_pnl": 0.0,
        }

    def set_strategy_net_premium(self, strategy_name: str, net_premium: float) -> None:
        self.strategy_net_premium[strategy_name] = net_premium

    def update_leg_metadata(self, trading_symbol: str, **updates: Any) -> None:
        if trading_symbol not in self.legs:
            self.legs[trading_symbol] = {}
        self.legs[trading_symbol].update(updates)

    def update_market_data(
        self,
        trading_symbol: str | None,
        instrument_token: str | None,
        ltp: float,
        bid: float | None,
        ask: float | None,
    ) -> None:
        key = trading_symbol or instrument_token
        if key is None:
            return

        # Validate the tick
        prev_ltp = float(self.market_data.get(key, {}).get("ltp", 0.0) or 0.0)
        try:
            validate_tick(ltp, bid, ask, prev_ltp if prev_ltp > 0 else None, str(key))
        except Exception as exc:
            self.logger.warning("tick_validation_failed", key=key, error=str(exc))
            return

        payload = {
            "trading_symbol": trading_symbol,
            "instrument_token": instrument_token,
            "ltp": ltp,
            "bid": bid,
            "ask": ask,
        }
        
        # Calculate Greeks for Options
        if trading_symbol:
            ts_clean = str(trading_symbol).replace(" ", "").upper()
            match = OPTION_REGEX.match(ts_clean)
            if match:
                underlying = match.group("symbol")
                strike_price = float(match.group("strike"))
                option_type = match.group("type")
                expiry_dt = parse_expiry(match.group("expiry"))
                
                spot_price = self.ltp(underlying)
                if spot_price > 0:
                    greeks = calculate_greeks(spot_price, strike_price, ltp, expiry_dt, option_type)
                    payload.update(greeks)
                else:
                    payload.update({"iv": 0.0, "delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0})
                    
        self.market_data[key] = payload
        self._symbol_last_update[key] = time.monotonic()
        
        if trading_symbol and instrument_token:
            self.market_data[instrument_token] = self.market_data[key]
            
        for listener in self._listeners:
            try:
                listener(self.market_data[key])
            except Exception as e:
                self.logger.warning("listener_error", error=str(e))

    def ltp(self, trading_symbol: str) -> float:
        return float(self.market_data.get(trading_symbol, {}).get("ltp", 0.0) or 0.0)

    def mid_price(self, trading_symbol: str) -> float:
        row = self.market_data.get(trading_symbol, {})
        bid = row.get("bid")
        ask = row.get("ask")
        if bid and ask:
            return (float(bid) + float(ask)) / 2
        return float(row.get("ltp", 0.0) or 0.0)

    def record_fill(self, order: dict[str, Any], fill_price: float) -> None:
        symbol = order["trading_symbol"]
        entry = self.legs.get(symbol, {})
        if order["transaction_type"] == "S":
            entry["entry_price"] = fill_price
            entry["quantity"] = order["quantity"]
            entry["side"] = "SHORT"
            entry["status"] = "OPEN"
            self.legs[symbol] = entry
        elif order["transaction_type"] == "B":
            entry_price = float(entry.get("entry_price", 0.0))
            quantity = int(entry.get("quantity", order["quantity"]))
            realized = (entry_price - fill_price) * quantity
            entry["exit_price"] = fill_price
            entry["status"] = "CLOSED"
            entry["realized_pnl"] = float(entry.get("realized_pnl", 0.0)) + realized
            entry["quantity"] = 0
            self.legs[symbol] = entry
        self.logger.info("fill_recorded", trading_symbol=symbol, transaction_type=order["transaction_type"], fill_price=fill_price)

    def total_pnl(self) -> float:
        total = 0.0
        for symbol, leg in self.legs.items():
            total += float(leg.get("realized_pnl", 0.0))
            if leg.get("status") != "OPEN":
                continue
            entry = float(leg.get("entry_price", 0.0))
            ltp = self.ltp(symbol)
            qty = int(leg.get("quantity", 0))
            total += (entry - ltp) * qty
        return total

    def net_premium_received(self) -> float:
        return sum(self.strategy_net_premium.values())

    # ── Poll Loop with Error Classification ──────────────────────

    def _poll_positions(self) -> None:
        while self._running:
            try:
                positions_raw = self.client_provider.positions()
                positions = validate_positions_response(positions_raw)
                limits = self.client_provider.limits()
                self._update_margin(limits)
                self._merge_positions(positions)
                
                # --- Risk Reconciliation ---
                if hasattr(self, 'risk_manager') and self.risk_manager:
                    self.risk_manager.reconcile_positions(positions)
                
                self.print_table()

                # Reset failure counter on success
                if self._consecutive_poll_failures > 0:
                    self.logger.info("poll_recovered", previous_failures=self._consecutive_poll_failures)
                self._consecutive_poll_failures = 0

            except SessionExpiredError:
                self._consecutive_poll_failures += 1
                self.logger.error("poll_session_expired", failures=self._consecutive_poll_failures)
                event_bus.publish(Event(EventNames.SESSION_EXPIRED))
                # Broker client's _call wrapper will handle re-auth on next try

            except RuntimeError as exc:
                # Circuit breaker OPEN
                self._consecutive_poll_failures += 1
                self.logger.warning("poll_circuit_open", error=str(exc), failures=self._consecutive_poll_failures)

            except Exception as exc:
                self._consecutive_poll_failures += 1
                self.logger.exception("position_poll_error", error=str(exc), failures=self._consecutive_poll_failures)

            # Alert on repeated failures
            if self._consecutive_poll_failures == self.MAX_CONSECUTIVE_POLL_FAILURES:
                msg = f"🚨 Position polling failed {self._consecutive_poll_failures}x consecutively"
                self.logger.error("poll_failure_threshold_reached", count=self._consecutive_poll_failures)
                event_bus.publish(Event(EventNames.CRITICAL_ERROR, {"type": "poll_failures", "count": self._consecutive_poll_failures}))
                if self.notifier:
                    self.notifier.send(msg)

            time.sleep(self.poll_interval)

    def _update_margin(self, limits: Any) -> None:
        if isinstance(limits, dict):
            for key in ("used_margin", "usedMargin", "margin_used", "utilized"):
                value = limits.get(key)
                if value is not None:
                    self.margin_used = float(value)
                    return

    def _merge_positions(self, positions: list) -> None:
        for row in positions:
            symbol = row.get("trading_symbol") or row.get("trdSym") or row.get("symbol")
            if not symbol:
                continue
            leg = self.legs.setdefault(symbol, {})
            for price_key in ("avgPrice", "average_price", "buyAvg", "sellAvg"):
                if row.get(price_key) is not None and not leg.get("entry_price"):
                    leg["entry_price"] = float(row[price_key])
                    break
            for qty_key in ("netQty", "quantity", "net_quantity"):
                if row.get(qty_key) is not None:
                    qty = abs(int(float(row[qty_key])))
                    leg["quantity"] = qty
                    leg["status"] = "OPEN" if qty > 0 else "CLOSED"
                    break

    def print_table(self) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        header = f"\n[{timestamp}] Positions"
        divider = "-" * 98
        rows = [header, divider]
        rows.append(f"{'Symbol':<26}{'Entry':>10}{'LTP':>10}{'PnL':>12}{'SL':>10}{'Qty':>8}{'Status':>10}")
        rows.append(divider)
        for symbol, leg in sorted(self.legs.items()):
            entry = float(leg.get('entry_price', 0.0))
            ltp = self.ltp(symbol)
            qty = int(leg.get('quantity', 0))
            sl_level = float(leg.get('sl_level', 0.0))
            realized = float(leg.get("realized_pnl", 0.0))
            unrealized = (entry - ltp) * qty if leg.get("status") == "OPEN" else 0.0
            pnl = realized + unrealized
            status = str(leg.get("status", "OPEN"))
            rows.append(f"{symbol:<26}{entry:>10.2f}{ltp:>10.2f}{pnl:>12.2f}{sl_level:>10.2f}{qty:>8}{status:>10}")
        rows.append(divider)
        rows.append(
            f"Net premium: {self.net_premium_received():.2f} | Total PnL: {self.total_pnl():.2f} | Margin used: {self.margin_used:.2f}"
        )
        print("\n".join(rows), flush=True)

    def save_snapshot(self) -> Path:
        snapshot = {
            "timestamp": datetime.now().isoformat(),
            "legs": self.legs,
            "market_data": self.market_data,
            "net_premium": self.strategy_net_premium,
            "margin_used": self.margin_used,
            "total_pnl": self.total_pnl(),
        }
        snapshot_path = self._snapshot_dir / f"snapshot-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        snapshot_path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
        self.logger.info("snapshot_saved", path=str(snapshot_path))
        return snapshot_path

    def to_dict(self) -> dict:
        """Health status for /api/health."""
        return {
            "open_legs": sum(1 for l in self.legs.values() if l.get("status") == "OPEN"),
            "total_pnl": round(self.total_pnl(), 2),
            "consecutive_poll_failures": self._consecutive_poll_failures,
            "tracked_symbols": len(self.market_data),
        }
