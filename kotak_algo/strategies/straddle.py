from __future__ import annotations

from kotak_algo.strategies.base_strategy import BaseStrategy


class StraddleStrategy(BaseStrategy):
    def build_legs(self) -> list[dict]:
        selection = self.strike_selector.select_straddle(
            underlying=self.config["underlying"],
            exchange_segment=self.config["exchange_segment"],
            strike_gap=self.config["strike_gap"],
            instrument_type=self.config.get("instrument_type"),
        )
        common = {
            "exchange_segment": self.config["exchange_segment"],
            "product": self.config["product"],
            "lots": self.config["lots"],
            "lot_size": self.config["lot_size"],
            "strategy": self.name,
        }
        return [
            {**common, **selection["ce"], "tag": f"{self.name}-ce"},
            {**common, **selection["pe"], "tag": f"{self.name}-pe"},
        ]

    def adjust(self) -> None:
        """
        Perform straddle premium skew adjustments (Delta-neutral / leg-shifting).
        If spot price moves away from entry strike by > 1.5 * strike_gap, we roll the untested leg.
        """
        if self.state.value != "IN_TRADE" or not self.legs:
            return

        with self._lock:
            # 1. Identify current open CE and PE legs
            open_ce = None
            open_pe = None
            for leg in self.legs:
                tracked_leg = self.position_tracker.legs.get(leg["trading_symbol"], {})
                if tracked_leg.get("status") == "OPEN":
                    if leg.get("option_type") == "CE":
                        open_ce = leg
                    elif leg.get("option_type") == "PE":
                        open_pe = leg

            # Both legs must be open to perform straddle shifting
            if not open_ce or not open_pe:
                return

            # 2. Get spot price and evaluate divergence
            spot = self.position_tracker.ltp(self.config["underlying"])
            if spot <= 0:
                return

            # Since it's a straddle, CE and PE initially start at the same strike.
            # We use open_ce["strike"] as the baseline anchor strike.
            entry_strike = open_ce["strike"]
            pe_strike = open_pe["strike"]
            strike_gap = self.config["strike_gap"]
            threshold = self.config.get("adjustment_threshold_multiplier", 1.5) * strike_gap

            diff = spot - entry_strike

            # Case A: Spot moved UP significantly -> Roll UP the PE leg
            if diff > threshold:
                new_strike = round(spot / strike_gap) * strike_gap
                # Check if we actually need to roll (new strike should be higher than current PE strike)
                if new_strike > pe_strike:
                    self.logger.info("straddle_adjustment_trigger_roll_up_pe", spot=spot, entry_strike=entry_strike, current_pe_strike=pe_strike, new_strike=new_strike)
                    
                    # A. Close the current cheap PE leg
                    try:
                        self.order_manager.market_exit(open_pe, reason="straddle_skew_roll_up_pe")
                    except Exception as e:
                        self.logger.error("failed_to_exit_untested_pe_leg_for_adjustment", symbol=open_pe["trading_symbol"], error=str(e))
                        return

                    # B. Resolve and match the new ATM PE contract
                    try:
                        rows = self.strike_selector._load_rows(self.config["exchange_segment"])
                        new_contract = self.strike_selector._match_option(
                            rows=rows,
                            underlying=self.config["underlying"],
                            expiry=open_ce["expiry"],
                            strike=new_strike,
                            opt_type="PE",
                            instrument_type=self.config.get("instrument_type")
                        )
                    except Exception as e:
                        self.logger.error("failed_to_resolve_new_pe_leg_contract_for_adjustment", strike=new_strike, error=str(e))
                        return

                    # C. Sell the new PE leg
                    common = {
                        "exchange_segment": self.config["exchange_segment"],
                        "product": self.config["product"],
                        "lots": self.config["lots"],
                        "lot_size": self.config["lot_size"],
                        "strategy": self.name,
                        "transaction_type": "S",
                        "side": "SHORT"
                    }
                    new_pe_leg = {**common, **new_contract, "tag": f"{self.name}-pe-adj"}
                    
                    try:
                        order = self.order_manager.place_entry_order(new_pe_leg, transaction_type="S")
                        if order.get("status") != "filled":
                            order = self.order_manager.confirm_fill(order["order_id"])
                        
                        fill_price = float(order.get("fill_price") or 0.0)
                        new_pe_leg["entry_price"] = fill_price
                        new_pe_leg["entry_order_id"] = order["order_id"]
                        
                        # Place stop loss order
                        sl_level = fill_price * float(self.config.get("sl_multiplier", 2.0))
                        new_pe_leg["sl_level"] = sl_level
                        
                        self.position_tracker.attach_strategy_leg(self.name, new_pe_leg)
                        self.position_tracker.update_leg_metadata(new_pe_leg["trading_symbol"], sl_level=sl_level)
                        sl_order = self.order_manager.place_stop_loss_order(new_pe_leg, sl_level=sl_level)
                        new_pe_leg["sl_order_id"] = sl_order["order_id"]
                        self.position_tracker.update_leg_metadata(new_pe_leg["trading_symbol"], sl_order_id=sl_order["order_id"])
                        
                        # Subscribe to websocket feed
                        if self.websocket:
                            self.websocket.subscribe([{"instrument_token": new_pe_leg["instrument_token"], "exchange_segment": new_pe_leg["exchange_segment"]}])
                        
                        # Update legs list
                        self.legs.remove(open_pe)
                        self.legs.append(new_pe_leg)
                        
                        if self.telemetry_manager:
                            self.telemetry_manager.log_event(
                                "rebalance",
                                self.name,
                                {
                                    "action": "roll_up_pe",
                                    "old_symbol": open_pe["trading_symbol"],
                                    "new_symbol": new_pe_leg["trading_symbol"],
                                    "old_strike": pe_strike,
                                    "new_strike": new_strike,
                                    "fill_price": fill_price,
                                    "sl_level": sl_level
                                },
                                self.position_tracker.total_pnl(),
                                self.position_tracker.margin_used
                            )
                        
                        msg = (
                            f"🔄 <b>Straddle Leg Adjusted (Roll UP PE)</b>\n"
                            f"━━━━━━━━━━━━━━━━━\n"
                            f"📈 <b>Spot Price:</b> ₹{spot:.2f}\n"
                            f"❌ <b>Exited Leg:</b> <code>{open_pe['trading_symbol']}</code> (Strike {pe_strike})\n"
                            f"✅ <b>New Leg:</b> <code>{new_pe_leg['trading_symbol']}</code> (Strike {new_strike})\n"
                            f"💰 <b>Fill Premium:</b> ₹{fill_price:.2f}\n"
                            f"🛡️ <b>Stop-Loss:</b> ₹{sl_level:.2f}\n\n"
                            f"<i>Rebalanced successfully.</i>"
                        )
                        self.notifier.send(msg, parse_mode="HTML")
                        self.logger.info("straddle_adjusted_rolled_up_pe_completed", old_strike=pe_strike, new_strike=new_strike, fill_price=fill_price)
                    except Exception as e:
                        self.logger.error("failed_to_place_new_pe_leg_for_adjustment", error=str(e))
                        self.notifier.send(f"⚠️ Straddle PE roll adjustment failed: {e}")

            # Case B: Spot moved DOWN significantly -> Roll DOWN the CE leg
            elif diff < -threshold:
                new_strike = round(spot / strike_gap) * strike_gap
                # Check if we actually need to roll (new strike should be lower than current CE strike)
                if new_strike < entry_strike:
                    self.logger.info("straddle_adjustment_trigger_roll_down_ce", spot=spot, entry_strike=entry_strike, current_ce_strike=entry_strike, new_strike=new_strike)
                    
                    # A. Close the current cheap CE leg
                    try:
                        self.order_manager.market_exit(open_ce, reason="straddle_skew_roll_down_ce")
                    except Exception as e:
                        self.logger.error("failed_to_exit_untested_ce_leg_for_adjustment", symbol=open_ce["trading_symbol"], error=str(e))
                        return

                    # B. Resolve and match the new ATM CE contract
                    try:
                        rows = self.strike_selector._load_rows(self.config["exchange_segment"])
                        new_contract = self.strike_selector._match_option(
                            rows=rows,
                            underlying=self.config["underlying"],
                            expiry=open_pe["expiry"],
                            strike=new_strike,
                            opt_type="CE",
                            instrument_type=self.config.get("instrument_type")
                        )
                    except Exception as e:
                        self.logger.error("failed_to_resolve_new_ce_leg_contract_for_adjustment", strike=new_strike, error=str(e))
                        return

                    # C. Sell the new CE leg
                    common = {
                        "exchange_segment": self.config["exchange_segment"],
                        "product": self.config["product"],
                        "lots": self.config["lots"],
                        "lot_size": self.config["lot_size"],
                        "strategy": self.name,
                        "transaction_type": "S",
                        "side": "SHORT"
                    }
                    new_ce_leg = {**common, **new_contract, "tag": f"{self.name}-ce-adj"}
                    
                    try:
                        order = self.order_manager.place_entry_order(new_ce_leg, transaction_type="S")
                        if order.get("status") != "filled":
                            order = self.order_manager.confirm_fill(order["order_id"])
                        
                        fill_price = float(order.get("fill_price") or 0.0)
                        new_ce_leg["entry_price"] = fill_price
                        new_ce_leg["entry_order_id"] = order["order_id"]
                        
                        # Place stop loss order
                        sl_level = fill_price * float(self.config.get("sl_multiplier", 2.0))
                        new_ce_leg["sl_level"] = sl_level
                        
                        self.position_tracker.attach_strategy_leg(self.name, new_ce_leg)
                        self.position_tracker.update_leg_metadata(new_ce_leg["trading_symbol"], sl_level=sl_level)
                        sl_order = self.order_manager.place_stop_loss_order(new_ce_leg, sl_level=sl_level)
                        new_ce_leg["sl_order_id"] = sl_order["order_id"]
                        self.position_tracker.update_leg_metadata(new_ce_leg["trading_symbol"], sl_order_id=sl_order["order_id"])
                        
                        # Subscribe to websocket feed
                        if self.websocket:
                            self.websocket.subscribe([{"instrument_token": new_ce_leg["instrument_token"], "exchange_segment": new_ce_leg["exchange_segment"]}])
                        
                        # Update legs list
                        self.legs.remove(open_ce)
                        self.legs.append(new_ce_leg)
                        
                        if self.telemetry_manager:
                            self.telemetry_manager.log_event(
                                "rebalance",
                                self.name,
                                {
                                    "action": "roll_down_ce",
                                    "old_symbol": open_ce["trading_symbol"],
                                    "new_symbol": new_ce_leg["trading_symbol"],
                                    "old_strike": entry_strike,
                                    "new_strike": new_strike,
                                    "fill_price": fill_price,
                                    "sl_level": sl_level
                                },
                                self.position_tracker.total_pnl(),
                                self.position_tracker.margin_used
                            )
                        
                        msg = (
                            f"🔄 <b>Straddle Leg Adjusted (Roll DOWN CE)</b>\n"
                            f"━━━━━━━━━━━━━━━━━\n"
                            f"📈 <b>Spot Price:</b> ₹{spot:.2f}\n"
                            f"❌ <b>Exited Leg:</b> <code>{open_ce['trading_symbol']}</code> (Strike {entry_strike})\n"
                            f"✅ <b>New Leg:</b> <code>{new_ce_leg['trading_symbol']}</code> (Strike {new_strike})\n"
                            f"💰 <b>Fill Premium:</b> ₹{fill_price:.2f}\n"
                            f"🛡️ <b>Stop-Loss:</b> ₹{sl_level:.2f}\n\n"
                            f"<i>Rebalanced successfully.</i>"
                        )
                        self.notifier.send(msg, parse_mode="HTML")
                        self.logger.info("straddle_adjusted_rolled_down_ce_completed", old_strike=entry_strike, new_strike=new_strike, fill_price=fill_price)
                    except Exception as e:
                        self.logger.error("failed_to_place_new_ce_leg_for_adjustment", error=str(e))
                        self.notifier.send(f"⚠️ Straddle CE roll adjustment failed: {e}")
