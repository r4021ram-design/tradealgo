import time
from typing import List, Dict, Any
from kotak_algo.utils.logger import get_logger
from kotak_algo.events import event_bus, Event, EventNames


class RiskManager:
    def __init__(self, risk_config, position_tracker, notifier, logger=None) -> None:
        self.risk_config = risk_config
        self.position_tracker = position_tracker
        self.notifier = notifier
        self.logger = (logger or get_logger("risk_manager")).bind(component="risk_manager")
        self.open_strategies: set[str] = set()
        self.combined_sl_triggered = False
        self.kill_switch_active = False
        
        # Throttling
        self._order_count_window: List[float] = []
        self.MAX_ORDERS_PER_MINUTE = int(self.risk_config.get("max_orders_per_minute", 20))

    def can_open_strategy(self) -> bool:
        return len(self.open_strategies) < int(self.risk_config.get("max_open_strategies", 1))

    def register_strategy_open(self, strategy_name: str) -> None:
        self.open_strategies.add(strategy_name)

    def register_strategy_close(self, strategy_name: str) -> None:
        self.open_strategies.discard(strategy_name)

    def daily_loss_breached(self) -> bool:
        total_pnl = self.position_tracker.total_pnl()
        return total_pnl <= -abs(float(self.risk_config.get("max_daily_loss", 0)))

    def enforce_combined_stop_loss(self, order_manager) -> None:
        if self.combined_sl_triggered:
            return
        net_premium = self.position_tracker.net_premium_received()
        if net_premium <= 0:
            return

        combined_sl_pct = float(self.risk_config.get("combined_sl_pct", 50))
        max_loss = net_premium * (combined_sl_pct / 100.0)
        current_loss = -self.position_tracker.total_pnl()
        if current_loss < max_loss:
            return

        self.logger.warning("combined_stop_loss_hit", current_loss=current_loss, max_loss=max_loss)
        self.notifier.send(f"Combined SL hit. Loss={current_loss:.2f}, Threshold={max_loss:.2f}")
        event_bus.publish(Event(
            EventNames.COMBINED_STOP_LOSS_TRIGGERED,
            {"current_loss": current_loss, "max_loss": max_loss}
        ))
        self.combined_sl_triggered = True
        for symbol, leg in list(self.position_tracker.legs.items()):
            if leg.get("status") == "OPEN" and leg.get("quantity", 0) > 0:
                exit_leg = {
                    "exchange_segment": leg.get("exchange_segment", "nse_fo"),
                    "product": leg.get("product", "NRML"),
                    "trading_symbol": symbol,
                    "lot_size": int(leg["quantity"]),
                    "lots": 1,
                }
                order_manager.market_exit(exit_leg, reason="combined_stop_loss")

    def enforce_leg_stop_losses(self, order_manager) -> None:
        for symbol, leg in list(self.position_tracker.legs.items()):
            if leg.get("status") != "OPEN":
                continue
            sl_level = float(leg.get("sl_level", 0.0))
            ltp = self.position_tracker.ltp(symbol)
            if sl_level <= 0 or ltp <= 0:
                continue
            
            # For LONG positions, SL triggers if price falls to or below SL level.
            # For SHORT positions (default), SL triggers if premium rises to or above SL level.
            is_sl_hit = (ltp <= sl_level) if leg.get("side") == "LONG" else (ltp >= sl_level)
            
            if is_sl_hit:
                self.logger.warning("leg_stop_loss_hit", trading_symbol=symbol, ltp=ltp, sl_level=sl_level, side=leg.get("side"))
                event_bus.publish(Event(
                    EventNames.LEG_STOP_LOSS_TRIGGERED,
                    {"trading_symbol": symbol, "sl_level": sl_level, "ltp": ltp}
                ))
                exit_leg = {
                    "exchange_segment": leg.get("exchange_segment", "nse_fo"),
                    "product": leg.get("product", "NRML"),
                    "trading_symbol": symbol,
                    "lot_size": int(leg["quantity"]),
                    "lots": 1,
                    "sl_order_id": leg.get("sl_order_id"),
                    "sl_level": sl_level,
                    "tag": f"{leg.get('strategy', 'strategy')}-sl-hit",
                }
                order_manager.trigger_stop_loss(exit_leg)

    def validate_order(self, payload: Dict[str, Any]) -> None:
        """
        Risk middleware called before every order.
        Raises ValueError if risk limits are breached.
        """
        if self.kill_switch_active:
            raise ValueError("Risk Error: Global Kill Switch is ACTIVE")

        # 1. Throttling Check
        now = time.monotonic()
        self._order_count_window = [t for t in self._order_count_window if now - t < 60]
        if len(self._order_count_window) >= self.MAX_ORDERS_PER_MINUTE:
            raise ValueError(f"Risk Error: Order throttling active ({len(self._order_count_window)} orders/min)")
        
        self._order_count_window.append(now)

        # 2. Exposure/Quantity Check
        quantity = payload.get("quantity", 0)
        max_qty = int(self.risk_config.get("max_quantity_per_order", 10000))
        if quantity > max_qty:
            raise ValueError(f"Risk Error: Quantity {quantity} exceeds max per order {max_qty}")

    def reconcile_positions(self, broker_positions: List[Dict[str, Any]]) -> None:
        """
        Compare local position state with broker state.
        Flags mismatches via event bus.
        """
        local_positions = self.position_tracker.legs
        broker_map = {row.get("trading_symbol"): abs(int(float(row.get("netQty", 0)))) for row in broker_positions if row.get("trading_symbol")}
        
        for symbol, leg in local_positions.items():
            local_qty = leg.get("quantity", 0)
            broker_qty = broker_map.get(symbol, 0)
            
            if local_qty != broker_qty:
                self.logger.error("position_mismatch_detected", symbol=symbol, local=local_qty, broker=broker_qty)
                event_bus.publish(Event(EventNames.POSITION_MISMATCH, {
                    "symbol": symbol,
                    "local_qty": local_qty,
                    "broker_qty": broker_qty
                }))
                # Auto-correction: Trust the broker
                leg["quantity"] = broker_qty
                if broker_qty == 0:
                    leg["status"] = "CLOSED"

    def activate_kill_switch(self, order_manager) -> None:
        """Emergency procedure to exit all positions and halt trading."""
        if self.kill_switch_active:
            return
            
        self.kill_switch_active = True
        self.logger.critical("KILL_SWITCH_ACTIVATED")
        self.notifier.send("🚨 EMERGENCY: Kill Switch Activated! Exiting all positions.")
        
        for symbol, leg in list(self.position_tracker.legs.items()):
            if leg.get("status") == "OPEN":
                exit_leg = {
                    "exchange_segment": leg.get("exchange_segment", "nse_fo"),
                    "trading_symbol": symbol,
                    "lot_size": int(leg["quantity"]),
                    "lots": 1,
                }
                try:
                    order_manager.market_exit(exit_leg, reason="kill_switch")
                except Exception as e:
                    self.logger.error("kill_switch_exit_failed", symbol=symbol, error=str(e))
