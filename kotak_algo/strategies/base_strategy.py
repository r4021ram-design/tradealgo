from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from enum import Enum
from typing import Any

from kotak_algo.utils.logger import get_logger


class StrategyState(Enum):
    IDLE = "IDLE"
    ENTERING = "ENTERING"
    IN_TRADE = "IN_TRADE"
    EXITING = "EXITING"
    DONE = "DONE"


class BaseStrategy(ABC):
    def __init__(
        self,
        name: str,
        config: dict[str, Any],
        scheduler,
        strike_selector,
        order_manager,
        position_tracker,
        risk_manager,
        notifier,
        telemetry_manager=None,
        logger=None,
    ) -> None:
        self.name = name
        self.config = config
        self.scheduler = scheduler
        self.strike_selector = strike_selector
        self.order_manager = order_manager
        self.position_tracker = position_tracker
        self.risk_manager = risk_manager
        self.notifier = notifier
        self.telemetry_manager = telemetry_manager
        self.logger = (logger or get_logger(name)).bind(component=name)
        
        self._state = StrategyState.IDLE
        self._lock = threading.RLock()
        self.entered_slots: set[str] = set()
        self.legs: list[dict[str, Any]] = []
        self.websocket = None

    @property
    def state(self) -> StrategyState:
        return self._state

    @property
    def active(self) -> bool:
        return self._state == StrategyState.IN_TRADE

    def prepare(self) -> list[dict[str, str]]:
        self.legs = self.build_legs()
        return [
            {
                "instrument_token": leg["instrument_token"],
                "exchange_segment": leg["exchange_segment"],
            }
            for leg in self.legs
        ]

    def should_enter(self) -> bool:
        if self._state != StrategyState.IDLE:
            return False
        if not self.scheduler.is_entry_allowed():
            return False
        if not self.risk_manager.can_open_strategy():
            return False
        slot = self.scheduler.match_entry_time(self.config.get("entry_times", []))
        return bool(slot and slot not in self.entered_slots)

    def should_exit(self) -> bool:
        if self._state != StrategyState.IN_TRADE:
            return False
        return self.scheduler.is_exit_time(self.config.get("exit_time", "15:15"))

    def execute(self) -> None:
        if not self._lock.acquire(blocking=False):
            return
            
        try:
            if self._state != StrategyState.IDLE:
                return

            slot = self.scheduler.match_entry_time(self.config.get("entry_times", []))
            if not slot:
                return

            self._state = StrategyState.ENTERING
            self.legs = self.build_legs()
            self.logger.info("strategy_entry_started", strategy=self.name, legs=self.legs)
            entry_orders = []
            net_premium = 0.0

            try:
                # 1. Resolve transaction_type and side for each leg
                for leg in self.legs:
                    leg_tx = leg.get("transaction_type") or leg.get("side") or leg.get("action") or self.config.get("transaction_type") or "S"
                    leg_tx = "B" if str(leg_tx).upper() in ("B", "BUY", "LONG") else "S"
                    leg["transaction_type"] = leg_tx
                    leg["side"] = "LONG" if leg_tx == "B" else "SHORT"

                # 2. Partition legs into buy (hedges) and sell (writing) legs
                buy_legs = [leg for leg in self.legs if leg["transaction_type"] == "B"]
                sell_legs = [leg for leg in self.legs if leg["transaction_type"] == "S"]

                def place_and_confirm(leg, txn_type):
                    self.logger.info("submitting_sequenced_leg", symbol=leg["trading_symbol"], txn_type=txn_type)
                    order = self.order_manager.place_entry_order(leg, transaction_type=txn_type)
                    
                    if order.get("status") != "filled":
                        self.logger.info("waiting_for_leg_fill", symbol=leg["trading_symbol"], order_id=order["order_id"])
                        order = self.order_manager.confirm_fill(order["order_id"])
                        
                    fill_price = float(order.get("fill_price") or 0.0)
                    leg["entry_price"] = fill_price
                    leg["entry_order_id"] = order["order_id"]
                    self.position_tracker.attach_strategy_leg(self.name, leg)
                    self.logger.info("sequenced_leg_filled", symbol=leg["trading_symbol"], fill_price=fill_price)
                    return order, fill_price

                # 3. Execute Buy/Long legs first (Hedges) and confirm fill
                for leg in buy_legs:
                    order, fill_price = place_and_confirm(leg, "B")
                    entry_orders.append(order)
                    net_premium -= fill_price

                # 4. Execute Sell/Short legs second (Writing) and confirm fill
                for leg in sell_legs:
                    order, fill_price = place_and_confirm(leg, "S")
                    entry_orders.append(order)
                    net_premium += fill_price

                # 5. Place stop loss orders
                for leg in self.legs:
                    if leg["side"] == "LONG":
                        sl_level = float(leg["entry_price"]) / float(self.config.get("sl_multiplier", 2.0))
                    else:
                        sl_level = float(leg["entry_price"]) * float(self.config.get("sl_multiplier", 2.0))
                        
                    leg["sl_level"] = sl_level
                    self.position_tracker.update_leg_metadata(leg["trading_symbol"], sl_level=sl_level)
                    sl_order = self.order_manager.place_stop_loss_order(leg, sl_level=sl_level)
                    leg["sl_order_id"] = sl_order["order_id"]
                    self.position_tracker.update_leg_metadata(leg["trading_symbol"], sl_order_id=sl_order["order_id"])

                self.position_tracker.set_strategy_net_premium(
                    self.name,
                    net_premium * int(self.config.get("lot_size", 1)) * int(self.config.get("lots", 1))
                )
                self.risk_manager.register_strategy_open(self.name)
                self.entered_slots.add(slot)
                self._state = StrategyState.IN_TRADE
                self.notifier.send(f"✅ {self.name} entered at {net_premium:.2f}")
                self.logger.info("strategy_entry_completed", strategy=self.name, slot=slot, net_premium=net_premium)
            except Exception as exc:
                self.logger.exception("strategy_entry_failed", strategy=self.name, error=str(exc))
                self.notifier.send(f"❌ {self.name} entry failed: {exc}")
                self.square_off(reason="entry_failed_cleanup")
                self._state = StrategyState.IDLE # Allow retry next cycle if possible
                
        finally:
            self._lock.release()

    def square_off(self, reason: str) -> None:
        with self._lock:
            if self._state not in (StrategyState.IN_TRADE, StrategyState.ENTERING):
                return
            
            old_state = self._state
            self._state = StrategyState.EXITING
            self.logger.info("strategy_square_off_started", strategy=self.name, reason=reason)
            
            try:
                # Group open legs to ensure Sell/Short legs exit first, then Buy/Long (hedges) second
                open_legs = []
                for leg in self.legs:
                    tracked_leg = self.position_tracker.legs.get(leg["trading_symbol"], {})
                    if tracked_leg.get("status") == "OPEN":
                        open_legs.append(leg)
                
                sell_legs = [leg for leg in open_legs if leg.get("transaction_type", "S") == "S"]
                buy_legs = [leg for leg in open_legs if leg.get("transaction_type") == "B"]
                
                for leg in sell_legs + buy_legs:
                    sl_order_id = leg.get("sl_order_id")
                    if sl_order_id:
                        self.order_manager.cancel_order(sl_order_id)
                    self.order_manager.market_exit(leg, reason=reason)
                
                self.risk_manager.register_strategy_close(self.name)
                self._state = StrategyState.DONE
                self.notifier.send(f"🏁 {self.name} squared off: {reason}")
                self.logger.info("strategy_square_off_completed", strategy=self.name, reason=reason)
            except Exception as exc:
                self.logger.exception("strategy_square_off_failed", strategy=self.name, error=str(exc))
                self.notifier.send(f"⚠️ {self.name} square-off encountered errors: {exc}")
                # We stay in EXITING state to let the main loop or manual intervention handle it

    def cancel_pending(self) -> None:
        for leg in self.legs:
            if leg.get("entry_order_id"):
                self.order_manager.cancel_order(leg["entry_order_id"])
            if leg.get("sl_order_id"):
                self.order_manager.cancel_order(leg["sl_order_id"])

    def adjust(self) -> None:
        """Hook called inside main tick loop for open strategies to perform adjustments."""
        pass

    @abstractmethod
    def build_legs(self) -> list[dict[str, Any]]:
        raise NotImplementedError
