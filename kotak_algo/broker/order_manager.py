from __future__ import annotations

import threading
import time
import uuid
from datetime import datetime
from typing import Any

from kotak_algo.exceptions import (
    DuplicateOrderError,
    OrderRejectedError,
    SessionExpiredError,
)
from kotak_algo.utils.api_validator import validate_order_response, validate_cancel_response
from kotak_algo.broker.pre_trade_validator import PreTradeValidator
from kotak_algo.utils.logger import get_logger
from kotak_algo.events import event_bus, Event, EventNames


# ── Duplicate Order Guard ────────────────────────────────────────

class _DedupCache:
    """Track recent orders to prevent duplicates within a cooldown window."""

    def __init__(self, cooldown_seconds: float = 10.0) -> None:
        self._cooldown = cooldown_seconds
        self._recent: dict[str, float] = {}  # key → timestamp
        self._lock = threading.Lock()

    def _key(self, symbol: str, txn_type: str, quantity: int, price: str | None = None) -> str:
        # Include price in key to allow intentional re-entries at different prices if needed,
        # but for most algos, symbol+side+qty is enough to flag a duplicate.
        return f"{symbol}|{txn_type}|{quantity}|{price or 'MKT'}"

    def check_and_record(self, symbol: str, txn_type: str, quantity: int, price: str | None = None) -> None:
        """Raise DuplicateOrderError if same order seen within cooldown."""
        key = self._key(symbol, txn_type, quantity, price)
        now = time.monotonic()
        with self._lock:
            # Purge expired entries
            self._recent = {k: t for k, t in self._recent.items() if now - t < self._cooldown}

            if key in self._recent:
                elapsed = now - self._recent[key]
                event_bus.publish(Event(
                    EventNames.DUPLICATE_ORDER_BLOCKED,
                    {"symbol": symbol, "txn_type": txn_type, "quantity": quantity, "elapsed_s": round(elapsed, 2)},
                ))
                raise DuplicateOrderError(
                    f"Duplicate order blocked: {symbol} {txn_type} x{quantity} "
                    f"(last order {elapsed:.1f}s ago, cooldown={self._cooldown}s)",
                    details={"symbol": symbol, "txn_type": txn_type, "quantity": quantity},
                )
            self._recent[key] = now


class OrderManager:
    def __init__(
        self,
        broker,
        position_tracker,
        risk_manager,
        notifier,
        logger=None,
        paper_trade: bool = True,
        reprice_interval: int = 30,
        max_reprice_attempts: int = 3,
        dedup_cooldown: float = 10.0,
    ) -> None:
        self.broker = broker
        self.position_tracker = position_tracker
        self.risk_manager = risk_manager
        self.notifier = notifier
        self.logger = (logger or get_logger("order_manager")).bind(component="order_manager")
        self.paper_trade = paper_trade
        self.reprice_interval = reprice_interval
        self.max_reprice_attempts = max_reprice_attempts
        self.pending_orders: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._dedup = _DedupCache(cooldown_seconds=dedup_cooldown)
        self._validator = PreTradeValidator(logger=self.logger, paper_trade=self.paper_trade)

    def place_order(
        self,
        trading_symbol: str,
        side: str,
        quantity: int,
        order_type: str = "MKT",
        product: str = "NRML",
        price: str = "0",
        trigger_price: str = "0",
        tag: str | None = None,
        exchange_segment: str = "nse_fo",
    ) -> str:
        """Place an arbitrary/individual order with risk validation and pre-trade checks."""
        txn_type = "B" if side.upper() in ("BUY", "B") else "S"

        # Check duplicate guard
        formatted_price = self._format_price(float(price)) if price and price != "0" else None
        self._dedup.check_and_record(trading_symbol, txn_type, quantity, formatted_price)

        payload = {
            "exchange_segment": exchange_segment,
            "product": product,
            "price": price,
            "order_type": order_type,
            "quantity": quantity,
            "validity": "DAY",
            "trading_symbol": trading_symbol,
            "transaction_type": txn_type,
            "amo": "NO",
            "disclosed_quantity": "0",
            "market_protection": "0",
            "pf": "N",
            "trigger_price": trigger_price,
            "tag": tag,
        }

        paper_price_val = float(price) if price and price != "0" else None
        # Submit the order
        order = self._submit(payload, paper_price=paper_price_val)
        self.logger.info("arbitrary_order_placed", trading_symbol=trading_symbol, txn_type=txn_type, order_id=order["order_id"])
        return order["order_id"]

    # ── Entry Orders ─────────────────────────────────────────────

    def place_entry_order(self, leg: dict[str, Any], transaction_type: str = "S") -> dict[str, Any]:
        quantity = leg.get("quantity", leg.get("lot_size", 1) * leg.get("lots", 1))
        mid_price = self.position_tracker.mid_price(leg["trading_symbol"])
        formatted_price = self._format_price(mid_price) if mid_price > 0 else None

        # Duplicate guard
        self._dedup.check_and_record(leg["trading_symbol"], transaction_type, quantity, formatted_price)

        if mid_price <= 0:
            raise ValueError(f"Cannot place entry without market data for {leg['trading_symbol']}")

        payload = {
            "exchange_segment": leg["exchange_segment"],
            "product": leg["product"],
            "price": self._format_price(mid_price),
            "order_type": "L",
            "quantity": quantity,
            "validity": "DAY",
            "trading_symbol": leg["trading_symbol"],
            "transaction_type": transaction_type,
            "amo": "NO",
            "disclosed_quantity": "0",
            "market_protection": "0",
            "pf": "N",
            "trigger_price": "0",
            "tag": leg.get("tag"),
        }
        order = self._submit_with_reprice(payload, leg=leg)
        return order

    # ── Stop Loss Orders ─────────────────────────────────────────

    def place_stop_loss_order(self, leg: dict[str, Any], sl_level: float) -> dict[str, Any]:
        quantity = leg.get("quantity", leg.get("lot_size", 1) * leg.get("lots", 1))
        # If the position is LONG, we exit by SELLING ("S"). If SHORT, we exit by BUYING ("B").
        side = leg.get("side", "SHORT")
        txn_type = "S" if side == "LONG" else "B"
        payload = {
            "exchange_segment": leg["exchange_segment"],
            "product": leg["product"],
            "price": "0",
            "order_type": "SL-M",
            "quantity": quantity,
            "validity": "DAY",
            "trading_symbol": leg["trading_symbol"],
            "transaction_type": txn_type,
            "amo": "NO",
            "disclosed_quantity": "0",
            "market_protection": "0",
            "pf": "N",
            "trigger_price": self._format_price(sl_level),
            "tag": f"{leg.get('tag', leg['trading_symbol'])}-sl",
        }
        order = self._submit(payload, paper_price=sl_level)
        self.logger.info(
            "sl_order_placed",
            trading_symbol=leg["trading_symbol"],
            trigger_price=float(payload["trigger_price"]),
            order_id=order["order_id"],
        )
        return order

    # ── Market Exit with Retry ───────────────────────────────────

    def market_exit(self, leg: dict[str, Any], reason: str) -> dict[str, Any]:
        quantity = leg.get("quantity", leg.get("lot_size", 1) * leg.get("lots", 1))
        # If the position is LONG, we exit by SELLING ("S"). If SHORT, we exit by BUYING ("B").
        side = leg.get("side", "SHORT")
        txn_type = "S" if side == "LONG" else "B"
        payload = {
            "exchange_segment": leg["exchange_segment"],
            "product": leg["product"],
            "price": "0",
            "order_type": "MKT",
            "quantity": quantity,
            "validity": "DAY",
            "trading_symbol": leg["trading_symbol"],
            "transaction_type": txn_type,
            "amo": "NO",
            "disclosed_quantity": "0",
            "market_protection": "0",
            "pf": "N",
            "trigger_price": "0",
            "tag": f"{leg.get('tag', leg['trading_symbol'])}-exit",
        }

        last_exc = None
        for attempt in range(1, 4):  # 3 retries on exit failures
            try:
                order = self._submit(payload)
                self.logger.info("market_exit_placed", trading_symbol=leg["trading_symbol"], reason=reason, order_id=order["order_id"])
                self.notifier.send(f"Exit order placed for {leg['trading_symbol']} due to {reason}")
                return order
            except Exception as exc:
                last_exc = exc
                self.logger.error(
                    "market_exit_failed",
                    trading_symbol=leg["trading_symbol"],
                    reason=reason,
                    attempt=attempt,
                    error=str(exc),
                )
                if attempt < 3:
                    time.sleep(2)

        # All retries failed — critical alert
        self.notifier.send(
            f"🚨 CRITICAL: Exit order FAILED 3x for {leg['trading_symbol']}! "
            f"Reason: {reason}. Error: {last_exc}. MANUAL INTERVENTION REQUIRED."
        )
        event_bus.publish(Event(EventNames.CRITICAL_ERROR, {
            "type": "exit_order_failed",
            "symbol": leg["trading_symbol"],
            "reason": reason,
            "error": str(last_exc),
        }))
        raise last_exc  # type: ignore[misc]

    # ── Cancel ───────────────────────────────────────────────────

    def cancel_order(self, order_id: str) -> Any:
        if self.paper_trade:
            with self._lock:
                order = self.pending_orders.get(order_id)
                if order:
                    order["status"] = "cancelled"
            self.logger.info("paper_order_cancelled", order_id=order_id)
            return {"status": "cancelled", "order_id": order_id}

        try:
            response = self.broker.cancel_order(order_id=order_id)
            validate_cancel_response(response, context="cancel_order")
            self.logger.info("order_cancelled", order_id=order_id, response=response)
            return response
        except Exception as exc:
            self.logger.error("order_cancel_failed", order_id=order_id, error=str(exc))
            raise

    def modify_order(self, order_id: str, new_price: float, new_quantity: int) -> dict[str, Any]:
        """Modify price and quantity for a pending order."""
        if self.paper_trade:
            with self._lock:
                order = self.pending_orders.get(order_id)
                if not order:
                    raise ValueError(f"Order {order_id} not found")
                
                # Update paper order fields
                order["price"] = self._format_price(new_price)
                order["quantity"] = new_quantity
                order["payload"]["price"] = order["price"]
                order["payload"]["quantity"] = new_quantity
                
                # Check for instant fill if paper_trade and MKT or price crossed
                if new_price > 0:
                    mid = self.position_tracker.mid_price(order["trading_symbol"])
                    # Simple assumption for paper limit orders - fill immediately if changed
                    if mid > 0:
                        order["status"] = "filled"
                        order["fill_price"] = new_price
                        self.position_tracker.record_fill(order, fill_price=new_price)
                
            self.logger.info("paper_order_modified", order_id=order_id, new_price=new_price, new_qty=new_quantity)
            return {"status": "modified", "order_id": order_id}

        try:
            with self._lock:
                order = self.pending_orders.get(order_id)
                if not order:
                    raise ValueError(f"Order {order_id} not found in local cache")
                payload = order["payload"]
                
            # Resolve instrument token from database to satisfy Kotak Neo SDK validation requirements
            from pathlib import Path
            import sqlite3
            db_path = Path(__file__).resolve().parent.parent / "instruments" / "data" / "contracts.db"
            instrument_token = None
            try:
                conn = sqlite3.connect(str(db_path))
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT token FROM contracts WHERE trading_symbol = ? OR symbol = ?",
                    (payload["trading_symbol"], payload["trading_symbol"])
                )
                row = cursor.fetchone()
                if row:
                    instrument_token = row[0]
                conn.close()
            except Exception as e:
                self.logger.warning("failed_to_resolve_token_for_modification", symbol=payload["trading_symbol"], error=str(e))
                
            response = self.broker.modify_order(
                order_id=order_id,
                price=self._format_price(new_price),
                quantity=new_quantity,
                validity=payload["validity"],
                trading_symbol=payload["trading_symbol"],
                exchange_segment=payload["exchange_segment"],
                product=payload["product"],
                order_type=payload["order_type"],
                transaction_type=payload.get("transaction_type"),
                trigger_price=payload.get("trigger_price", "0"),
                instrument_token=str(instrument_token) if instrument_token else None,
            )
            validate_order_response(response, context="modify_order")
            
            # Update local cache
            with self._lock:
                order["price"] = self._format_price(new_price)
                order["quantity"] = new_quantity
                order["payload"]["price"] = order["price"]
                order["payload"]["quantity"] = new_quantity
                
            self.logger.info("order_modified", order_id=order_id, new_price=new_price, new_qty=new_quantity, response=response)
            return response
        except Exception as exc:
            self.logger.error("order_modify_failed", order_id=order_id, error=str(exc))
            raise

    def cancel_all_pending(self) -> None:
        with self._lock:
            for order_id, order in list(self.pending_orders.items()):
                if order.get("status") == "pending":
                    self.cancel_order(order_id)

    def trigger_stop_loss(self, leg: dict[str, Any], reason: str = "leg_stop_loss") -> dict[str, Any]:
        sl_order_id = leg.get("sl_order_id")
        if sl_order_id:
            try:
                self.cancel_order(sl_order_id)
            except Exception as exc:
                self.logger.warning("sl_cancel_failed", order_id=sl_order_id, error=str(exc))
        order = self.market_exit(leg, reason=reason)
        self.notifier.send(f"SL triggered for {leg['trading_symbol']} at {leg.get('sl_level', 0):.2f}")
        return order

    # ── Internal ─────────────────────────────────────────────────

    def _submit_with_reprice(self, payload: dict[str, Any], leg: dict[str, Any]) -> dict[str, Any]:
        order = self._submit(payload, paper_price=float(payload["price"]))
        if order["status"] == "filled":
            return order

        for attempt in range(1, self.max_reprice_attempts + 1):
            time.sleep(self.reprice_interval)
            new_mid = self.position_tracker.mid_price(leg["trading_symbol"])
            if new_mid <= 0:
                continue

            if self.paper_trade:
                order["price"] = self._format_price(new_mid)
                order["fill_price"] = new_mid
                order["status"] = "filled"
                self.position_tracker.record_fill(order, fill_price=new_mid)
                self.logger.info("paper_limit_repriced_and_filled", order_id=order["order_id"], attempt=attempt, price=new_mid)
                return order

            try:
                modified = self.broker.modify_order(
                    order_id=order["order_id"],
                    price=self._format_price(new_mid),
                    quantity=payload["quantity"],
                    validity=payload["validity"],
                    trading_symbol=payload["trading_symbol"],
                    exchange_segment=payload["exchange_segment"],
                    product=payload["product"],
                    order_type=payload["order_type"],
                )
                validate_order_response(modified, context="modify_order")
                self.logger.info("limit_order_modified", order_id=order["order_id"], attempt=attempt, new_price=new_mid, response=modified)
                history = self.broker.order_history(order_id=order["order_id"])
                if self._is_filled(history):
                    fill_price = self._extract_fill_price(history, fallback=new_mid)
                    order["status"] = "filled"
                    order["fill_price"] = fill_price
                    self.position_tracker.record_fill(order, fill_price=fill_price)
                    return order
            except Exception as exc:
                self.logger.warning("reprice_attempt_failed", attempt=attempt, error=str(exc))

        market_payload = dict(payload)
        market_payload["order_type"] = "MKT"
        market_payload["price"] = "0"
        order = self._submit(market_payload, paper_price=self.position_tracker.ltp(leg["trading_symbol"]))
        self.logger.info("limit_converted_to_market", trading_symbol=leg["trading_symbol"], order_id=order["order_id"])
        return order

    def _submit(self, payload: dict[str, Any], paper_price: float | None = None) -> dict[str, Any]:
        # ── Risk Middleware ──
        try:
            self.risk_manager.validate_order(payload)
        except ValueError as exc:
            self.logger.error("risk_validation_failed", payload=payload, error=str(exc))
            self.notifier.send(f"⚠️ Risk Block: {exc}")
            raise OrderRejectedError(f"Risk validation failed: {exc}", order_payload=payload)

        # ── Pre-Trade Validation ──
        try:
            self._validator.validate(payload)
        except ValueError as exc:
            self.logger.error("pre_trade_validation_failed", payload=payload, error=str(exc))
            self.notifier.send(f"🚫 Order blocked: {exc}")
            raise OrderRejectedError(f"Pre-trade validation failed: {exc}", order_payload=payload)

        if self.paper_trade:
            order_id = f"paper-{uuid.uuid4().hex[:12]}"
            should_fill = payload["order_type"] != "SL-M"
            fill_price = paper_price if paper_price and paper_price > 0 else self.position_tracker.ltp(payload["trading_symbol"])
            if should_fill and fill_price <= 0:
                fill_price = 100.0
            order = {
                "order_id": order_id,
                "status": "filled" if should_fill else "pending",
                "payload": payload,
                "price": payload["price"],
                "fill_price": fill_price if should_fill else None,
                "trading_symbol": payload["trading_symbol"],
                "transaction_type": payload["transaction_type"],
                "quantity": payload["quantity"],
                "exchange_segment": payload["exchange_segment"],
                "product": payload["product"],
                "order_type": payload["order_type"],
                "trigger_price": payload["trigger_price"],
                "submitted_at": datetime.now().isoformat(),
            }
            with self._lock:
                self.pending_orders[order_id] = order
            if should_fill:
                self.position_tracker.record_fill(order, fill_price=fill_price)
                self.logger.info("paper_order_filled", **{k: v for k, v in order.items() if k != "payload"})
            else:
                self.logger.info("paper_order_pending", **{k: v for k, v in order.items() if k != "payload"})
            return order

        # ── LIVE ORDER ──
        try:
            response = self.broker.place_order(**payload)
            order_id = validate_order_response(response, context="place_order")
        except OrderRejectedError as exc:
            self.logger.error("live_order_rejected", payload=payload, error=str(exc))
            event_bus.publish(Event(EventNames.ORDER_REJECTED, {
                "symbol": payload["trading_symbol"],
                "error": str(exc),
            }))
            self.notifier.send(f"⚠️ Order REJECTED: {payload['trading_symbol']} — {exc}")
            raise
        except SessionExpiredError:
            raise  # Let the broker client handle re-auth

        order = {
            "order_id": order_id,
            "status": "pending",
            "payload": payload,
            "price": payload["price"],
            "fill_price": None,
            "trading_symbol": payload["trading_symbol"],
            "transaction_type": payload["transaction_type"],
            "quantity": payload["quantity"],
            "exchange_segment": payload["exchange_segment"],
            "product": payload["product"],
            "order_type": payload["order_type"],
            "trigger_price": payload["trigger_price"],
            "submitted_at": datetime.now().isoformat(),
        }
        with self._lock:
            self.pending_orders[order_id] = order
        self.logger.info("live_order_submitted", order_id=order_id, payload=payload, response=response)
        self.notifier.send(f"Order submitted: {payload['trading_symbol']} {payload['transaction_type']} {payload['order_type']}")
        return order

    @staticmethod
    def _extract_order_id(response: Any) -> str:
        # Kept for backward compatibility; prefer validate_order_response
        return validate_order_response(response, context="extract_order_id")

    @staticmethod
    def _is_filled(history: Any) -> bool:
        history_text = str(history).lower()
        return "complete" in history_text or "filled" in history_text or "traded" in history_text

    @staticmethod
    def _extract_fill_price(history: Any, fallback: float) -> float:
        if isinstance(history, dict):
            for key in ("avgPrc", "avg_price", "price"):
                value = history.get(key)
                if value is not None:
                    return float(value)
            for value in history.values():
                if isinstance(value, dict):
                    for nested_key in ("avgPrc", "avg_price", "price"):
                        nested_value = value.get(nested_key)
                        if nested_value is not None:
                            return float(nested_value)
        return float(fallback)

    @staticmethod
    def _format_price(price: float) -> str:
        return f"{price:.2f}"
