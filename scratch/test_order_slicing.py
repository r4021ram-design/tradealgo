import unittest
from unittest.mock import MagicMock
from pathlib import Path
import sys

# Add root folder to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from kotak_algo.broker.order_manager import OrderManager

class TestOrderSlicing(unittest.TestCase):
    def setUp(self):
        # Mock dependencies
        self.broker = MagicMock()
        self.position_tracker = MagicMock()
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

    def test_get_freeze_qty(self):
        # Test defaults
        self.assertEqual(self.order_manager._get_freeze_qty("NIFTY2660218150CE"), 1800)
        self.assertEqual(self.order_manager._get_freeze_qty("BANKNIFTY2660218150CE"), 1200)
        self.assertEqual(self.order_manager._get_freeze_qty("FINNIFTY2660218150CE"), 1800)
        self.assertEqual(self.order_manager._get_freeze_qty("MIDCPNIFTY2660218150CE"), 4200)
        self.assertEqual(self.order_manager._get_freeze_qty("SENSEX2660467600PE"), 1000)
        self.assertEqual(self.order_manager._get_freeze_qty("BANKEX2660467600PE"), 1000)

    def test_slice_quantity(self):
        # Under limit
        slices = self.order_manager._slice_quantity("NIFTY", 1000)
        self.assertEqual(slices, [1000])

        # Exactly at limit
        slices = self.order_manager._slice_quantity("NIFTY", 1800)
        self.assertEqual(slices, [1800])

        # Over limit
        slices = self.order_manager._slice_quantity("NIFTY", 3000)
        self.assertEqual(slices, [1800, 1200])

        # Over limit (multiples)
        slices = self.order_manager._slice_quantity("BANKNIFTY", 3000)
        self.assertEqual(slices, [1200, 1200, 600])

    def test_place_order_slicing(self):
        # Mock submit return value
        self.order_manager._submit = MagicMock(return_value={"order_id": "paper-123"})
        
        order_ids = self.order_manager.place_order(
            trading_symbol="NIFTY",
            side="BUY",
            quantity=3000,
            price="10.00"
        )
        
        # Should call submit twice (3000 -> 1800, 1200)
        self.assertEqual(self.order_manager._submit.call_count, 2)
        # Should return comma-separated order IDs
        self.assertEqual(order_ids, "paper-123,paper-123")

    def test_market_exit_slicing(self):
        # Mock submit return value
        self.order_manager._submit = MagicMock(return_value={"order_id": "paper-123"})
        
        leg = {
            "trading_symbol": "NIFTY",
            "exchange_segment": "nse_fo",
            "product": "NRML",
            "quantity": 3000,
            "side": "LONG"
        }
        
        self.order_manager.market_exit(leg, reason="test")
        
        # Should call submit twice
        self.assertEqual(self.order_manager._submit.call_count, 2)

    def test_modify_order_throttling(self):
        import time
        # Mock mid_price return value
        self.position_tracker.mid_price.return_value = 100.0
        # Add a dummy pending order to cache
        self.order_manager.pending_orders["test-order"] = {
            "order_id": "test-order",
            "trading_symbol": "NIFTY",
            "price": "100.00",
            "quantity": 100,
            "payload": {
                "trading_symbol": "NIFTY",
                "price": "100.00",
                "quantity": 100,
                "exchange_segment": "nse_fo",
                "product": "NRML",
                "order_type": "L",
                "validity": "DAY"
            }
        }
        
        # Track start time
        start_time = time.monotonic()
        
        # Call modify_order once (sets initial last_mod_times)
        self.order_manager.modify_order("test-order", 101.0, 100)
        
        # Call modify_order again immediately (should be throttled by 2.0 seconds)
        self.order_manager.modify_order("test-order", 102.0, 100)
        
        duration = time.monotonic() - start_time
        
        # The duration should be at least 2.0 seconds due to the sleep
        self.assertGreaterEqual(duration, 1.99)

if __name__ == "__main__":
    unittest.main()
