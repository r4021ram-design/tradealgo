import unittest
from pathlib import Path
import sys
import tempfile
import sqlite3
import shutil

# Add root folder to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from kotak_algo.core.backtest_sandbox import BacktestSandbox

class TestBacktestSandbox(unittest.TestCase):
    def setUp(self):
        # Create a temp file and copy actual contracts.db to it
        self.db_fd, self.temp_db_path = tempfile.mkstemp(suffix=".db")
        actual_db_path = Path(__file__).resolve().parents[1] / "kotak_algo" / "instruments" / "data" / "contracts.db"
        shutil.copy(str(actual_db_path), self.temp_db_path)
        self.sandbox = BacktestSandbox(db_path=Path(self.temp_db_path))

    def tearDown(self):
        import os
        try:
            os.close(self.db_fd)
            os.unlink(self.temp_db_path)
        except Exception:
            pass

    def test_ensure_historical_table(self):
        conn = sqlite3.connect(self.temp_db_path)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='historical_ticks'")
            row = cursor.fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], "historical_ticks")
        finally:
            conn.close()

    def test_synthetic_tick_generation(self):
        # Generate ticks
        self.sandbox.generate_synthetic_ticks(date_str="2026-06-08")
        
        # Check database
        conn = sqlite3.connect(self.temp_db_path)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM historical_ticks WHERE date(timestamp) = '2026-06-08'")
            count = cursor.fetchone()[0]
            self.assertEqual(count, 376) # 376 ticks for 9:15 to 15:30
        finally:
            conn.close()

    def test_run_simulation(self):
        # Run simulation for the synthetic date
        report = self.sandbox.run_simulation(date_str="2026-06-08")
        
        self.assertIn("date", report)
        self.assertEqual(report["date"], "2026-06-08")
        self.assertIn("final_pnl", report)
        self.assertIn("sim_events", report)
        self.assertIn("executed_orders_count", report)
        self.assertIn("orders", report)
        
        # Assert strategy entries occurred
        events = report["sim_events"]
        self.assertTrue(len(events) > 0)
        
        entry_events = [e for e in events if e["event"] == "strategy_entry"]
        self.assertEqual(len(entry_events), 1)
        self.assertEqual(entry_events[0]["details"]["spot"], 24019.17)
        
        # Verify that orders were recorded
        self.assertTrue(report["executed_orders_count"] > 0)
        self.assertEqual(len(report["orders"]), report["executed_orders_count"])

if __name__ == "__main__":
    unittest.main()
