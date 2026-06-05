import unittest
from unittest.mock import MagicMock, call
from pathlib import Path
import sys
import time

# Add root folder to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from kotak_algo.broker.order_manager import OrderManager
from kotak_algo.strategies.base_strategy import BaseStrategy, StrategyState
from kotak_algo.core.position_tracker import PositionTracker

class DummyStrategy(BaseStrategy):
    def build_legs(self) -> list[dict]:
        return [
            {
                "trading_symbol": "HEDGE_BUY",
                "exchange_segment": "nse_fo",
                "product": "NRML",
                "lots": 1,
                "lot_size": 75,
                "side": "LONG",
                "instrument_token": "token_buy",
            },
            {
                "trading_symbol": "WRITE_SELL",
                "exchange_segment": "nse_fo",
                "product": "NRML",
                "lots": 1,
                "lot_size": 75,
                "side": "SHORT",
                "instrument_token": "token_sell",
            }
        ]

class TestExecutionSequence(unittest.TestCase):
    def setUp(self):
        self.broker = MagicMock()
        self.position_tracker = PositionTracker(
            client_provider=self.broker
        )
        self.position_tracker.paper_trade = True
        self.risk_manager = MagicMock()
        self.notifier = MagicMock()
        self.logger = MagicMock()

        self.order_manager = OrderManager(
            broker=self.broker,
            position_tracker=self.position_tracker,
            risk_manager=self.risk_manager,
            notifier=self.notifier,
            logger=self.logger,
            paper_trade=True
        )

        self.scheduler = MagicMock()
        self.scheduler.is_entry_allowed.return_value = True
        self.scheduler.match_entry_time.return_value = "09:25"
        self.risk_manager.can_open_strategy.return_value = True

        self.position_tracker.mid_price = MagicMock(return_value=100.0)
        self.position_tracker.ltp = MagicMock(return_value=100.0)

    def test_confirm_fill_paper_trade(self):
        # Place a dummy paper order
        payload = {
            "trading_symbol": "HEDGE_BUY",
            "exchange_segment": "nse_fo",
            "product": "NRML",
            "price": "100.00",
            "order_type": "L",
            "quantity": 75,
            "validity": "DAY",
            "transaction_type": "B",
            "trigger_price": "0",
        }
        # Place stop loss or entry
        order = self.order_manager._submit(payload, paper_price=100.0)
        self.assertEqual(order["status"], "filled")

        # Set order as pending to test confirm_fill
        order["status"] = "pending"
        order["fill_price"] = None
        self.order_manager.pending_orders[order["order_id"]] = order

        # confirm_fill should find it, mark it filled immediately (paper trade fallback)
        res = self.order_manager.confirm_fill(order["order_id"])
        self.assertEqual(res["status"], "filled")
        self.assertEqual(res["fill_price"], 100.0)

    def test_confirm_fill_live_trade(self):
        # Configure live trading
        self.order_manager.paper_trade = False
        
        # Mock broker.place_order response
        self.broker.place_order.return_value = {"success": True, "data": {"orderId": "live-123"}}
        
        # Mock order history responses: pending first, then complete
        self.broker.order_history.side_effect = [
            [{"status": "pending", "avgPrc": "0.0"}],
            [{"status": "complete", "avgPrc": "105.50"}]
        ]

        # Populate pending_orders cache
        self.order_manager.pending_orders["live-123"] = {
            "order_id": "live-123",
            "status": "pending",
            "payload": {"trading_symbol": "TEST", "quantity": 75, "price": "105.0"},
            "trading_symbol": "TEST"
        }

        # Call confirm_fill, should poll twice and confirm filled
        res = self.order_manager.confirm_fill("live-123", poll_interval=0.01)
        self.assertEqual(res["status"], "filled")
        self.assertEqual(res["fill_price"], 105.50)
        self.assertEqual(self.broker.order_history.call_count, 2)

    def test_sequential_execution_logic(self):
        # Keep track of the order of place_entry_order calls
        placed_legs = []
        original_place_entry_order = self.order_manager.place_entry_order

        def mock_place_entry_order(leg, transaction_type="S"):
            placed_legs.append((leg["trading_symbol"], transaction_type))
            # Call original to keep implementation state consistent (paper trades auto-fill)
            return original_place_entry_order(leg, transaction_type)

        self.order_manager.place_entry_order = mock_place_entry_order

        strategy = DummyStrategy(
            name="test_strategy",
            config={
                "underlying": "NIFTY",
                "exchange_segment": "nse_fo",
                "product": "NRML",
                "lots": 1,
                "lot_size": 75,
                "strike_gap": 50,
                "sl_multiplier": 2.0,
                "entry_times": ["09:25"],
                "exit_time": "15:15"
            },
            scheduler=self.scheduler,
            strike_selector=MagicMock(),
            order_manager=self.order_manager,
            position_tracker=self.position_tracker,
            risk_manager=self.risk_manager,
            notifier=self.notifier,
            logger=self.logger
        )

        # Execute strategy entry
        strategy.execute()

        # Check execution order: Buy/Long leg (HEDGE_BUY) must run first, then Sell/Short leg (WRITE_SELL)
        self.assertEqual(len(placed_legs), 2)
        self.assertEqual(placed_legs[0], ("HEDGE_BUY", "B"))
        self.assertEqual(placed_legs[1], ("WRITE_SELL", "S"))

        # Verify stop loss levels:
        # HEDGE_BUY is LONG. Entry price is 100.0 (from setUp mid_price/ltp mock).
        # Multiplier is 2.0. So for LONG, sl_level = 100.0 / 2.0 = 50.0
        hedge_leg = [l for l in strategy.legs if l["trading_symbol"] == "HEDGE_BUY"][0]
        self.assertEqual(hedge_leg["sl_level"], 50.0)

        # WRITE_SELL is SHORT. Entry price is 100.0.
        # Multiplier is 2.0. So for SHORT, sl_level = 100.0 * 2.0 = 200.0
        write_leg = [l for l in strategy.legs if l["trading_symbol"] == "WRITE_SELL"][0]
        self.assertEqual(write_leg["sl_level"], 200.0)

        # Verify net premium:
        # Sell leg received 100.0. Buy leg paid 100.0.
        # Net premium = 100.0 (received) - 100.0 (paid) = 0.0
        self.assertEqual(self.position_tracker.strategy_net_premium["test_strategy"], 0.0)

if __name__ == "__main__":
    unittest.main()
