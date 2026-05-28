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

OPTION_REGEX = re.compile(r'^(?P<symbol>[A-Za-z]+)(?P<middle>\d+.*)(?P<type>CE|PE)$', re.IGNORECASE)

def parse_expiry(expiry_clean_str: str, underlying: str = "") -> datetime:
    """
    Parses clean YYMMM or YYMMMdd expiry strings and handles 2026 trading holidays.
    """
    from datetime import timedelta
    expiry_clean_str = expiry_clean_str.upper()
    underlying = underlying.upper()
    now = datetime.now()
    
    HOLIDAYS_2026 = {
        "2026-01-15", "2026-01-26", "2026-03-03", "2026-03-26", "2026-03-31",
        "2026-04-03", "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-26",
        "2026-09-14", "2026-10-02", "2026-10-20", "2026-11-10", "2026-11-24",
        "2026-12-25"
    }

    # Special holiday exception for May 2026 SENSEX/BANKEX contracts expiring on May 27 due to holiday on May 28
    # NIFTY and BANKNIFTY expire on Tuesday, May 26 (no holiday shift required for them)
    if "26MAY" in expiry_clean_str and underlying in ("SENSEX", "BANKEX"):
        day_part = expiry_clean_str[5:]
        if not day_part or day_part in ("27", "28", "29"):
            return datetime(2026, 5, 27, 15, 30, 0)

    try:
        # Format: YYMMM (e.g. 26MAY, 26JUN) -> Monthly option
        if len(expiry_clean_str) == 5:
            year_val = int("20" + expiry_clean_str[:2])
            month_str = expiry_clean_str[2:]
            
            months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
            month_num = months.index(month_str) + 1
            
            # Find the last Tuesday of that month (or Thursday for SENSEX/BANKEX)
            import calendar
            last_day = calendar.monthrange(year_val, month_num)[1]
            day_val = 0
            target_weekday = calendar.THURSDAY if underlying in ("SENSEX", "BANKEX") else calendar.TUESDAY
            for d in range(last_day, last_day - 7, -1):
                if calendar.weekday(year_val, month_num, d) == target_weekday:
                    day_val = d
                    break
            
            dt = datetime(year_val, month_num, day_val, 15, 30, 0)
            
            # Shift preceding on holiday or weekend
            while True:
                dt_str = dt.strftime("%Y-%m-%d")
                weekday = dt.weekday() # 5 = Saturday, 6 = Sunday
                if weekday in (5, 6) or dt_str in HOLIDAYS_2026:
                    dt = dt - timedelta(days=1)
                else:
                    break
            return dt

        # Format: YYMMMdd (e.g. 26MAY28) -> Weekly option
        elif len(expiry_clean_str) == 7:
            year_val = int("20" + expiry_clean_str[:2])
            month_str = expiry_clean_str[2:5]
            day_val = int(expiry_clean_str[5:])
            
            months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
            month_num = months.index(month_str) + 1
            
            dt = datetime(year_val, month_num, day_val, 15, 30, 0)
            
            # Shift preceding on holiday or weekend
            while True:
                dt_str = dt.strftime("%Y-%m-%d")
                weekday = dt.weekday()
                if weekday in (5, 6) or dt_str in HOLIDAYS_2026:
                    dt = dt - timedelta(days=1)
                else:
                    break
            return dt

        else:
            # Fallback
            dt = datetime.strptime(expiry_clean_str, "%d%b%Y")
            return dt.replace(hour=15, minute=30, second=0)

    except Exception:
        return now.replace(hour=15, minute=30, second=0, microsecond=0)


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
        self.available_margin = 0.0
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
                middle = match.group("middle")
                option_type = match.group("type")
                
                # Find month
                months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
                month_name = None
                month_idx = -1
                for m in months:
                    idx = middle.find(m)
                    if idx != -1:
                        month_idx = idx
                        month_name = m
                        break
                        
                if month_idx != -1:
                    year_str = middle[:month_idx]
                    after_month = middle[month_idx + 3:]
                    digits_only = re.sub(r'\D', '', after_month)
                    
                    day_val = None
                    strike_str = after_month
                    if len(digits_only) >= 7:
                        day_val = int(digits_only[:2])
                        strike_str = after_month[2:]
                        
                    strike_price = float(strike_str)
                    
                    # Parse the expiry date using our robust parser
                    expiry_str = f"{year_str}{month_name}"
                    if day_val is not None:
                        expiry_str += f"{day_val:02d}"
                        
                    expiry_dt = parse_expiry(expiry_str, underlying)
                    
                    spot_price = self.ltp(underlying)
                    if spot_price > 0:
                        greeks = calculate_greeks(spot_price, strike_price, ltp, expiry_dt, option_type)
                        payload.update(greeks)
                    else:
                        payload.update({"iv": 0.0, "delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0})
                    
                    payload["expiry"] = expiry_dt.strftime("%Y-%m-%d")
                    payload["dte"] = max(0, (expiry_dt - datetime.now()).days)
                    
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
        tx_type = order["transaction_type"]
        order_qty = int(order.get("quantity", 0))
        
        current_qty = int(entry.get("quantity", 0))
        current_side = entry.get("side", "")
        current_status = entry.get("status", "CLOSED")
        
        if current_status == "CLOSED" or current_qty == 0:
            # Opening a new position
            entry["entry_price"] = fill_price
            entry["quantity"] = order_qty
            entry["side"] = "LONG" if tx_type == "B" else "SHORT"
            entry["status"] = "OPEN"
        else:
            # We have an open position. Are we adding or closing?
            is_adding = (current_side == "LONG" and tx_type == "B") or (current_side == "SHORT" and tx_type == "S")
            if is_adding:
                # Average the entry price
                current_value = float(entry.get("entry_price", 0.0)) * current_qty
                new_value = fill_price * order_qty
                entry["entry_price"] = (current_value + new_value) / (current_qty + order_qty)
                entry["quantity"] = current_qty + order_qty
            else:
                # Closing (fully or partially)
                close_qty = min(current_qty, order_qty)
                entry_price = float(entry.get("entry_price", 0.0))
                
                # Calculate realized PnL on the closed portion
                if current_side == "LONG":
                    realized = (fill_price - entry_price) * close_qty
                else:
                    realized = (entry_price - fill_price) * close_qty
                    
                entry["realized_pnl"] = float(entry.get("realized_pnl", 0.0)) + realized
                
                new_qty = current_qty - order_qty
                if new_qty > 0:
                    entry["quantity"] = new_qty
                elif new_qty < 0:
                    # Reversed position
                    entry["quantity"] = abs(new_qty)
                    entry["side"] = "LONG" if tx_type == "B" else "SHORT"
                    entry["entry_price"] = fill_price
                else:
                    entry["quantity"] = 0
                    entry["status"] = "CLOSED"
                    entry["exit_price"] = fill_price
                    
        self.legs[symbol] = entry
        self.logger.info("fill_recorded", trading_symbol=symbol, transaction_type=tx_type, fill_price=fill_price, new_qty=entry.get("quantity"), status=entry.get("status"))

    def total_pnl(self) -> float:
        total = 0.0
        for symbol, leg in self.legs.items():
            total += float(leg.get("realized_pnl", 0.0))
            if leg.get("status") != "OPEN":
                continue
            entry = float(leg.get("entry_price", 0.0))
            ltp = self.ltp(symbol)
            qty = int(leg.get("quantity", 0))
            if leg.get("side") == "LONG":
                total += (ltp - entry) * qty
            else:
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
                self._update_index_spots()
                
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
            for key in ("MarginUsed", "used_margin", "usedMargin", "margin_used", "utilized"):
                value = limits.get(key)
                if value is not None:
                    self.margin_used = float(value)
                    break
            for key in ("Net", "available_margin", "availableMargin", "free"):
                value = limits.get(key)
                if value is not None:
                    self.available_margin = float(value)
                    break

    def _update_index_spots(self) -> None:
        try:
            db_path = Path(__file__).resolve().parents[1] / "instruments" / "data" / "contracts.db"
            import sqlite3
            conn = sqlite3.connect(str(db_path))
            cursor = conn.cursor()
            
            for symbol in ("NIFTY", "BANKNIFTY"):
                cursor.execute(
                    "SELECT token FROM contracts WHERE symbol = ? AND instrument_type = 'FUTIDX' AND expiry >= DATE('now') ORDER BY expiry ASC LIMIT 1",
                    (symbol,)
                )
                row = cursor.fetchone()
                if row:
                    token = row[0]
                    try:
                        quotes = self.client_provider.quotes(instrument_tokens=[{"instrument_token": token, "exchange_segment": "nse_fo"}])
                        if quotes:
                            messages = []
                            if isinstance(quotes, list):
                                messages = quotes
                            elif isinstance(quotes, dict):
                                messages = quotes.get("message", [])
                                if not isinstance(messages, list):
                                    messages = [messages]
                            
                            for msg in messages:
                                if isinstance(msg, dict) and str(msg.get("instrument_token") or msg.get("tk") or msg.get("exchange_token")) == str(token):
                                    ltp = float(msg.get("last_traded_price") or msg.get("ltp") or 0.0)
                                    if ltp > 0:
                                        self.update_market_data(
                                            trading_symbol=symbol,
                                            instrument_token=token,
                                            ltp=ltp,
                                            bid=ltp - 0.05,
                                            ask=ltp + 0.05
                                        )
                    except Exception as e:
                        self.logger.warning("failed_to_fetch_index_spot_quote", symbol=symbol, error=str(e))
            conn.close()
        except Exception as exc:
            self.logger.warning("failed_to_update_index_spots", error=str(exc))

    def _merge_positions(self, positions: list) -> None:
        for row in positions:
            symbol = row.get("trading_symbol") or row.get("trdSym") or row.get("symbol")
            if not symbol:
                continue
            leg = self.legs.setdefault(symbol, {})
            
            # Parse Quantity (Kotak Neo specific fields or standard fallback)
            cf_buy = int(row.get("cfBuyQty", 0) or 0)
            fl_buy = int(row.get("flBuyQty", 0) or 0)
            cf_sell = int(row.get("cfSellQty", 0) or 0)
            fl_sell = int(row.get("flSellQty", 0) or 0)
            
            total_buy_qty = cf_buy + fl_buy
            total_sell_qty = cf_sell + fl_sell
            net_qty = total_buy_qty - total_sell_qty
            
            # Standard fallback if Kotak keys are not used
            if not total_buy_qty and not total_sell_qty:
                for qty_key in ("netQty", "quantity", "net_quantity"):
                    if row.get(qty_key) is not None:
                        net_qty = int(float(row[qty_key]))
                        total_buy_qty = abs(net_qty) if net_qty > 0 else 0
                        total_sell_qty = abs(net_qty) if net_qty < 0 else 0
                        break
                        
            qty = abs(net_qty)
            leg["quantity"] = qty
            leg["status"] = "OPEN" if qty > 0 else "CLOSED"
            leg["side"] = "SHORT" if net_qty < 0 else "LONG"
            
            # Parse Entry Price (Kotak Neo specific fields or standard fallback)
            entry_price = 0.0
            if net_qty > 0 and total_buy_qty > 0:
                buy_amt = float(row.get("cfBuyAmt", 0) or 0) + float(row.get("buyAmt", 0) or 0)
                entry_price = buy_amt / total_buy_qty
            elif net_qty < 0 and total_sell_qty > 0:
                sell_amt = float(row.get("cfSellAmt", 0) or 0) + float(row.get("sellAmt", 0) or 0)
                entry_price = sell_amt / total_sell_qty
                
            if entry_price == 0.0:
                for price_key in ("avgPrice", "average_price", "buyAvg", "sellAvg"):
                    if row.get(price_key) is not None:
                        entry_price = float(row[price_key])
                        break
                        
            leg["entry_price"] = entry_price

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
            if leg.get("status") == "OPEN":
                if leg.get("side") == "LONG":
                    unrealized = (ltp - entry) * qty
                else:
                    unrealized = (entry - ltp) * qty
            else:
                unrealized = 0.0
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
