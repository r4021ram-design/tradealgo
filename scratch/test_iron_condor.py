import unittest
from unittest.mock import MagicMock, call
from pathlib import Path
import sys
import csv

# Add root folder to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from kotak_algo.core.strike_selector import StrikeSelector
from kotak_algo.strategies.iron_condor import IronCondorStrategy
from kotak_algo.strategies.base_strategy import StrategyState
from kotak_algo.core.position_tracker import PositionTracker
from kotak_algo.broker.order_manager import OrderManager

def create_mock_scrip_master(dest_path: Path):
    fieldnames = [
        "pSymbolName", "pExpDt", "pStrkPrc", "token", "pOptTp", 
        "lotSize", "pTrdSymbol", "pInstType", "pExchSeg", "ltp"
    ]
    rows = [
        {"pSymbolName": "NIFTY", "pExpDt": "09-Jun-2026", "pStrkPrc": "24000.0", "token": "t_atm_ce", "pOptTp": "CE", "lotSize": "65", "pTrdSymbol": "NIFTY2660924000CE", "pInstType": "OPTIDX", "pExchSeg": "nse_fo", "ltp": "0.0"},
        {"pSymbolName": "NIFTY", "pExpDt": "09-Jun-2026", "pStrkPrc": "24000.0", "token": "t_atm_pe", "pOptTp": "PE", "lotSize": "65", "pTrdSymbol": "NIFTY2660924000PE", "pInstType": "OPTIDX", "pExchSeg": "nse_fo", "ltp": "0.0"},
        
        {"pSymbolName": "NIFTY", "pExpDt": "09-Jun-2026", "pStrkPrc": "24200.0", "token": "t_short_ce", "pOptTp": "CE", "lotSize": "65", "pTrdSymbol": "NIFTY2660924200CE", "pInstType": "OPTIDX", "pExchSeg": "nse_fo", "ltp": "0.0"},
        {"pSymbolName": "NIFTY", "pExpDt": "09-Jun-2026", "pStrkPrc": "24300.0", "token": "t_long_ce", "pOptTp": "CE", "lotSize": "65", "pTrdSymbol": "NIFTY2660924300CE", "pInstType": "OPTIDX", "pExchSeg": "nse_fo", "ltp": "0.0"},
        
        {"pSymbolName": "NIFTY", "pExpDt": "09-Jun-2026", "pStrkPrc": "23800.0", "token": "t_short_pe", "pOptTp": "PE", "lotSize": "65", "pTrdSymbol": "NIFTY2660923800PE", "pInstType": "OPTIDX", "pExchSeg": "nse_fo", "ltp": "0.0"},
        {"pSymbolName": "NIFTY", "pExpDt": "09-Jun-2026", "pStrkPrc": "23700.0", "token": "t_long_pe", "pOptTp": "PE", "lotSize": "65", "pTrdSymbol": "NIFTY2660923700PE", "pInstType": "OPTIDX", "pExchSeg": "nse_fo", "ltp": "0.0"},
        
        # Futures row for spot fallback
        {"pSymbolName": "NIFTY", "pExpDt": "09-Jun-2026", "pStrkPrc": "0.0", "token": "t_fut", "pOptTp": "XX", "lotSize": "65", "pTrdSymbol": "NIFTY26JUNFUT", "pInstType": "FUTIDX", "pExchSeg": "nse_fo", "ltp": "23985.0"},
    ]
    with dest_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

class TestIronCondorStrategy(unittest.TestCase):
    def setUp(self):
        self.csv_path = Path(__file__).parent / "mock_scrip_master.csv"
        create_mock_scrip_master(self.csv_path)

        self.broker = MagicMock()
        self.broker.scrip_master_path.return_value = self.csv_path
        
        # Mock broker spot index quotes
        self.broker.quotes.return_value = [
            {"instrument_token": "26000", "last_traded_price": 23985.0}
        ]

        self.position_tracker = PositionTracker(client_provider=self.broker)
        self.position_tracker.paper_trade = True

        self.risk_manager = MagicMock()
        self.risk_manager.can_open_strategy.return_value = True

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

        self.strike_selector = StrikeSelector(
            broker=self.broker,
            position_tracker=self.position_tracker,
            logger=self.logger
        )

    def tearDown(self):
        if self.csv_path.exists():
            self.csv_path.unlink()

    def test_strike_selection_iron_condor(self):
        # Spot: 23985 -> ATM: 24000 (with strike_gap=50)
        # strangle_gap: 200, condor_gap: 100
        # short_ce = 24200, long_ce = 24300
        # short_pe = 23800, long_pe = 23700
        res = self.strike_selector.select_iron_condor(
            underlying="NIFTY",
            exchange_segment="nse_fo",
            strike_gap=50,
            strangle_gap=200,
            condor_gap=100,
            instrument_type="OPTIDX"
        )
        self.assertEqual(res["atm"], 24000)
        self.assertEqual(res["short_ce"]["strike"], 24200.0)
        self.assertEqual(res["short_ce"]["instrument_token"], "t_short_ce")
        self.assertEqual(res["long_ce"]["strike"], 24300.0)
        self.assertEqual(res["long_ce"]["instrument_token"], "t_long_ce")
        self.assertEqual(res["short_pe"]["strike"], 23800.0)
        self.assertEqual(res["short_pe"]["instrument_token"], "t_short_pe")
        self.assertEqual(res["long_pe"]["strike"], 23700.0)
        self.assertEqual(res["long_pe"]["instrument_token"], "t_long_pe")

    def test_sequential_entry_execution(self):
        # Mock tracker ltp/mid_price to return 100 for simplicity
        self.position_tracker.mid_price = MagicMock(return_value=100.0)
        self.position_tracker.ltp = MagicMock(return_value=100.0)

        placed_legs = []
        original_place_entry_order = self.order_manager.place_entry_order

        def mock_place_entry_order(leg, transaction_type="S"):
            placed_legs.append((leg["trading_symbol"], transaction_type))
            return original_place_entry_order(leg, transaction_type)

        self.order_manager.place_entry_order = mock_place_entry_order

        strategy = IronCondorStrategy(
            name="test_condor",
            config={
                "underlying": "NIFTY",
                "exchange_segment": "nse_fo",
                "product": "NRML",
                "lots": 1,
                "lot_size": 65,
                "strike_gap": 50,
                "strangle_gap": 200,
                "condor_gap": 100,
                "sl_multiplier": 2.0,
                "entry_times": ["09:25"],
                "exit_time": "15:15",
                "instrument_type": "OPTIDX"
            },
            scheduler=self.scheduler,
            strike_selector=self.strike_selector,
            order_manager=self.order_manager,
            position_tracker=self.position_tracker,
            risk_manager=self.risk_manager,
            notifier=self.notifier,
            logger=self.logger
        )

        strategy.execute()

        # Check execution sequence: Long/Buy legs must execute before Short/Sell legs
        # Long/Buy legs are NIFTY2660924300CE (long_ce) and NIFTY2660923700PE (long_pe)
        # Short/Sell legs are NIFTY2660924200CE (short_ce) and NIFTY2660923800PE (short_pe)
        self.assertEqual(len(placed_legs), 4)
        
        # Verify first 2 placed legs are Buy ('B')
        self.assertEqual(placed_legs[0][1], "B")
        self.assertEqual(placed_legs[1][1], "B")
        self.assertIn(placed_legs[0][0], ("NIFTY2660924300CE", "NIFTY2660923700PE"))
        self.assertIn(placed_legs[1][0], ("NIFTY2660924300CE", "NIFTY2660923700PE"))

        # Verify next 2 placed legs are Sell ('S')
        self.assertEqual(placed_legs[2][1], "S")
        self.assertEqual(placed_legs[3][1], "S")
        self.assertIn(placed_legs[2][0], ("NIFTY2660924200CE", "NIFTY2660923800PE"))
        self.assertIn(placed_legs[3][0], ("NIFTY2660924200CE", "NIFTY2660923800PE"))

        # Verify stop loss levels:
        # Long CE/PE (Entry price=100): SL = 100 / 2.0 = 50.0
        # Short CE/PE (Entry price=100): SL = 100 * 2.0 = 200.0
        long_ce_leg = [l for l in strategy.legs if l["tag"].endswith("long_ce")][0]
        self.assertEqual(long_ce_leg["sl_level"], 50.0)
        
        short_ce_leg = [l for l in strategy.legs if l["tag"].endswith("short_ce")][0]
        self.assertEqual(short_ce_leg["sl_level"], 200.0)

        # Verify Net Premium calculation:
        # Sell legs received: 100.0 + 100.0 = 200.0
        # Buy legs paid: 100.0 + 100.0 = 200.0
        # Net premium: 200.0 (received) - 200.0 (paid) = 0.0
        self.assertEqual(self.position_tracker.strategy_net_premium["test_condor"], 0.0)

    def test_sequential_exit_execution(self):
        # Setup pre-existing strategy legs inside position tracker
        self.position_tracker.legs = {
            "NIFTY2660924300CE": {"trading_symbol": "NIFTY2660924300CE", "status": "OPEN", "transaction_type": "B", "tag": "test_condor-long_ce"},
            "NIFTY2660923700PE": {"trading_symbol": "NIFTY2660923700PE", "status": "OPEN", "transaction_type": "B", "tag": "test_condor-long_pe"},
            "NIFTY2660924200CE": {"trading_symbol": "NIFTY2660924200CE", "status": "OPEN", "transaction_type": "S", "tag": "test_condor-short_ce"},
            "NIFTY2660923800PE": {"trading_symbol": "NIFTY2660923800PE", "status": "OPEN", "transaction_type": "S", "tag": "test_condor-short_pe"},
        }

        exited_legs = []
        self.order_manager.market_exit = MagicMock(side_effect=lambda leg, reason: exited_legs.append(leg["trading_symbol"]))

        strategy = IronCondorStrategy(
            name="test_condor",
            config={
                "underlying": "NIFTY",
                "exchange_segment": "nse_fo",
                "product": "NRML",
                "lots": 1,
                "lot_size": 65,
                "strike_gap": 50,
                "strangle_gap": 200,
                "condor_gap": 100,
                "sl_multiplier": 2.0,
                "entry_times": ["09:25"],
                "exit_time": "15:15",
                "instrument_type": "OPTIDX"
            },
            scheduler=self.scheduler,
            strike_selector=self.strike_selector,
            order_manager=self.order_manager,
            position_tracker=self.position_tracker,
            risk_manager=self.risk_manager,
            notifier=self.notifier,
            logger=self.logger
        )
        
        # Manually attach legs so strategy knows they exist
        strategy.legs = [
            {"trading_symbol": "NIFTY2660924300CE", "transaction_type": "B", "tag": "test_condor-long_ce"},
            {"trading_symbol": "NIFTY2660923700PE", "transaction_type": "B", "tag": "test_condor-long_pe"},
            {"trading_symbol": "NIFTY2660924200CE", "transaction_type": "S", "tag": "test_condor-short_ce"},
            {"trading_symbol": "NIFTY2660923800PE", "transaction_type": "S", "tag": "test_condor-short_pe"},
        ]
        strategy._state = StrategyState.IN_TRADE

        # Perform strategy square_off
        strategy.square_off(reason="test_exit")

        # Verify exit order: Short/Sell legs must be exited first, then Long/Buy legs second
        self.assertEqual(len(exited_legs), 4)
        
        # Verify first 2 exited legs are the Sell/Short ones
        self.assertIn(exited_legs[0], ("NIFTY2660924200CE", "NIFTY2660923800PE"))
        self.assertIn(exited_legs[1], ("NIFTY2660924200CE", "NIFTY2660923800PE"))

        # Verify last 2 exited legs are the Buy/Long ones
        self.assertIn(exited_legs[2], ("NIFTY2660924300CE", "NIFTY2660923700PE"))
        self.assertIn(exited_legs[3], ("NIFTY2660924300CE", "NIFTY2660923700PE"))

if __name__ == "__main__":
    unittest.main()
