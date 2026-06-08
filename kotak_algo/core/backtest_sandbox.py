from __future__ import annotations
import sqlite3
import json
import uuid
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock
import structlog

from kotak_algo.core.greeks_engine import black_scholes_price
from kotak_algo.core.position_tracker import PositionTracker
from kotak_algo.broker.order_manager import OrderManager
from kotak_algo.core.risk_manager import RiskManager
from kotak_algo.core.scheduler import TimeScheduler
from kotak_algo.core.strike_selector import StrikeSelector
from kotak_algo.strategies.straddle import StraddleStrategy
from kotak_algo.strategies.base_strategy import StrategyState
from kotak_algo.core.telemetry import TelemetryManager

LOGGER = structlog.get_logger("backtest_sandbox")

class BacktestSandbox:
    def __init__(self, db_path: Path | None = None) -> None:
        if db_path is None:
            db_path = Path(__file__).resolve().parents[1] / "instruments" / "data" / "contracts.db"
        self.db_path = db_path
        self._ensure_historical_table()

    def _ensure_historical_table(self) -> None:
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        try:
            with conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS historical_ticks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp TEXT NOT NULL,
                        symbol TEXT NOT NULL,
                        ltp REAL NOT NULL
                    )
                """)
        finally:
            conn.close()

    def generate_synthetic_ticks(self, date_str: str = "2026-06-08") -> None:
        """
        Populate historical_ticks table with NIFTY spot ticks for the target date if empty.
        The path is designed to:
          - Start at 24000.
          - Climb to 24230 (breaches +150 threshold to trigger roll up PE to 24200).
          - Drop to 23820 (breaches -150 threshold to trigger roll down CE to 23800).
          - End at 23900.
        """
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM historical_ticks WHERE date(timestamp) = ?", (date_str,))
            if cursor.fetchone()[0] > 0:
                LOGGER.info("ticks_already_exist_skipping_generation", date=date_str)
                return

            ticks = []
            start_time = datetime.strptime(f"{date_str} 09:15:00", "%Y-%m-%d %H:%M:%S")
            
            # Total minutes = 376 (from 09:15 to 15:30)
            total_minutes = 376
            for m in range(total_minutes):
                curr_time = start_time + timedelta(minutes=m)
                time_str = curr_time.strftime("%Y-%m-%d %H:%M:%S")
                
                # Generate custom path
                if m < 120:
                    # Climb from 24000 to 24230
                    spot = 24000.0 + (230.0 / 120.0) * m
                elif m < 270:
                    # Fall from 24230 to 23820
                    spot = 24230.0 - (410.0 / 150.0) * (m - 120)
                else:
                    # Rise from 23820 to 23900
                    spot = 23820.0 + (80.0 / (total_minutes - 1 - 270)) * (m - 270)
                
                ticks.append((time_str, "NIFTY", round(spot, 2)))

            with conn:
                conn.executemany(
                    "INSERT INTO historical_ticks (timestamp, symbol, ltp) VALUES (?, ?, ?)",
                    ticks
                )
            LOGGER.info("synthetic_ticks_generated", count=len(ticks), date=date_str)
        finally:
            conn.close()

    def run_simulation(self, date_str: str = "2026-06-08") -> dict[str, Any]:
        self.generate_synthetic_ticks(date_str)
        
        # 1. Fetch historical ticks
        conn = sqlite3.connect(str(self.db_path))
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT timestamp, ltp FROM historical_ticks WHERE date(timestamp) = ? ORDER BY timestamp ASC",
                (date_str,)
            )
            tick_rows = cursor.fetchall()
        finally:
            conn.close()

        if not tick_rows:
            return {"error": f"No tick data found for date {date_str}"}

        # 2. Mock broker and initialize services
        broker = MagicMock()
        # Mock quotes return value to prevent SDK connection attempts
        broker.quotes.return_value = []
        
        # Helper to load rows from contracts.db
        def mock_load_rows(exch):
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM contracts")
                db_rows = [dict(r) for r in cursor.fetchall()]
                normalized = []
                for row in db_rows:
                    normalized.append({
                        **row,
                        "pSymbol": str(row.get("symbol", "")),
                        "pSymbolName": str(row.get("symbol", "")),
                        "pInstType": str(row.get("instrument_type", "")),
                        "pExchSeg": str(row.get("segment", "")),
                        "pExpDt": str(row.get("expiry", "")),
                        "pOptTp": str(row.get("option_type", "")),
                        "pStrkPrc": str(row.get("strike", "")),
                        "pTrdSymbol": str(row.get("trading_symbol", "")),
                        "lotSize": str(row.get("lot_size", "0")),
                        "token": str(row.get("token", ""))
                    })
                return normalized
            finally:
                conn.close()

        position_tracker = PositionTracker(client_provider=broker)
        position_tracker.paper_trade = True
        position_tracker.start = MagicMock() # Do not run live background thread

        strike_selector = StrikeSelector(broker, position_tracker=position_tracker, logger=None)
        strike_selector._load_rows = mock_load_rows

        telemetry_manager = TelemetryManager()

        risk_manager = RiskManager(
            risk_config={"paper_trade": True, "combined_sl_pct": 500, "max_daily_loss": 5000, "max_open_strategies": 1},
            position_tracker=position_tracker,
            notifier=MagicMock(),
            telemetry_manager=telemetry_manager
        )

        order_manager = OrderManager(
            broker=broker,
            position_tracker=position_tracker,
            risk_manager=risk_manager,
            notifier=MagicMock(),
            paper_trade=True
        )

        scheduler = TimeScheduler()
        
        # Straddle Config
        strategy_config = {
            "underlying": "NIFTY",
            "exchange_segment": "nse_fo",
            "product": "NRML",
            "lots": 1,
            "lot_size": 65,
            "strike_gap": 100,
            "adjustment_threshold_multiplier": 1.5,
            "sl_multiplier": 2.0,
            "entry_times": ["09:25"],
            "exit_time": "15:15",
            "instrument_type": "OPTIDX"
        }

        strategy = StraddleStrategy(
            name="straddle",
            config=strategy_config,
            scheduler=scheduler,
            strike_selector=strike_selector,
            order_manager=order_manager,
            position_tracker=position_tracker,
            risk_manager=risk_manager,
            notifier=MagicMock(),
            telemetry_manager=telemetry_manager
        )

        # Fetch all NIFTY option contracts once
        conn = sqlite3.connect(str(self.db_path))
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT trading_symbol, strike, expiry, option_type FROM contracts WHERE symbol = 'NIFTY' AND option_type IN ('CE', 'PE')"
            )
            nifty_contracts = cursor.fetchall()
        finally:
            conn.close()

        # 3. Simulated Tick Driver loop
        # We drive the simulation minute-by-minute
        sim_events = []
        
        for timestamp_str, spot_price in tick_rows:
            sim_datetime = datetime.strptime(timestamp_str, "%Y-%m-%d %H:%M:%S")
            time_only_str = sim_datetime.strftime("%H:%M")
            
            # Update position tracker spot price
            position_tracker.market_data["NIFTY"] = {"ltp": spot_price, "bid": spot_price, "ask": spot_price}
            
            # Dynamic option pricing via Black-Scholes for all NIFTY contracts
            for symbol, strike, expiry_date, opt_type in nifty_contracts:
                # Compute DTE in years
                expiry_datetime = datetime.strptime(f"{expiry_date} 15:30:00", "%Y-%m-%d %H:%M:%S")
                seconds_left = (expiry_datetime - sim_datetime).total_seconds()
                dte_years = max(0.0, seconds_left / (365.0 * 24.0 * 3600.0))
                
                # Black-Scholes LTP (Sigma = 16%, r = 5.25%)
                option_ltp = black_scholes_price(
                    S=spot_price,
                    K=float(strike),
                    T=dte_years,
                    r=0.0525,
                    sigma=0.16,
                    option_type=opt_type
                )
                position_tracker.market_data[symbol] = {
                    "ltp": round(option_ltp, 2),
                    "bid": round(option_ltp, 2),
                    "ask": round(option_ltp, 2)
                }

            # Mock scheduler properties for time matching
            scheduler.is_entry_allowed = MagicMock(return_value=True)
            scheduler.match_entry_time = MagicMock(side_effect=lambda entry_times: time_only_str if time_only_str in entry_times else None)
            scheduler.is_exit_time = MagicMock(side_effect=lambda exit_time: time_only_str >= exit_time)

            # Run Strategy checks
            if strategy.should_enter():
                strategy.execute()
                sim_events.append({
                    "timestamp": timestamp_str,
                    "event": "strategy_entry",
                    "details": {"spot": spot_price, "legs": [l["trading_symbol"] for l in strategy.legs]}
                })
            elif strategy.should_exit():
                strategy.square_off(reason="target_exit_time_reached")
                sim_events.append({
                    "timestamp": timestamp_str,
                    "event": "strategy_exit",
                    "details": {"spot": spot_price}
                })
            elif strategy.state.value == "IN_TRADE":
                # Check for adjustments
                old_legs_count = len(strategy.legs)
                old_legs_symbols = [l["trading_symbol"] for l in strategy.legs]
                strategy.adjust()
                new_legs_symbols = [l["trading_symbol"] for l in strategy.legs]
                
                # Check if legs list changed (which indicates rebalance)
                if old_legs_symbols != new_legs_symbols:
                    sim_events.append({
                        "timestamp": timestamp_str,
                        "event": "rebalance",
                        "details": {
                            "spot": spot_price,
                            "exited": list(set(old_legs_symbols) - set(new_legs_symbols)),
                            "entered": list(set(new_legs_symbols) - set(old_legs_symbols))
                        }
                    })

            # Check Risk stop losses
            risk_manager.enforce_leg_stop_losses(order_manager)
            risk_manager.enforce_combined_stop_loss(order_manager)

        # 4. Generate Final Simulation Report
        pnl = position_tracker.total_pnl()
        executed_orders = list(order_manager.pending_orders.values())
        
        return {
            "date": date_str,
            "final_pnl": round(pnl, 2),
            "sim_events": sim_events,
            "executed_orders_count": len(executed_orders),
            "orders": [
                {
                    "order_id": o["order_id"],
                    "trading_symbol": o["trading_symbol"],
                    "transaction_type": o["transaction_type"],
                    "fill_price": o["fill_price"],
                    "quantity": o["quantity"]
                }
                for o in executed_orders
            ]
        }

    def _get_contract_details(self, trading_symbol: str) -> dict | None:
        conn = sqlite3.connect(str(self.db_path))
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT strike, expiry, option_type FROM contracts WHERE trading_symbol = ?",
                (trading_symbol,)
            )
            row = cursor.fetchone()
            if row:
                return {
                    "strike": float(row[0]),
                    "expiry": row[1],
                    "option_type": row[2]
                }
            return None
        finally:
            conn.close()
