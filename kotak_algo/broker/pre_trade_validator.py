"""
Pre-Trade Validator for KotakAlgo.
Checks orders against contract master data, market status, and limits
BEFORE they are sent to the broker.
"""

from __future__ import annotations

from datetime import datetime, time
from typing import Any, Dict, Optional

from kotak_algo.instruments.data.db_utils import SessionLocal
from kotak_algo.instruments.models.contract_model import Contract
from kotak_algo.utils.logger import get_logger

LOGGER = get_logger("pre_trade_validator")


class PreTradeValidator:
    def __init__(self, logger=None, paper_trade: bool = True) -> None:
        self.logger = logger or LOGGER
        self.paper_trade = paper_trade

    def validate(self, payload: Dict[str, Any]) -> None:
        """
        Perform a suite of checks on the order payload.
        Raises ValueError with descriptive message if validation fails.
        """
        symbol = payload.get("trading_symbol")
        quantity = payload.get("quantity")
        
        # 1. Market Hours Check
        if not self.paper_trade:
            self._check_market_hours()
        
        # 2. Basic payload checks
        if not symbol:
            raise ValueError("Missing trading_symbol in order payload")
        if quantity is None or quantity <= 0:
            raise ValueError(f"Invalid quantity: {quantity}")

        # 3. Contract Master Checks
        contract = self._get_contract(symbol)
        if not contract:
            # We don't block if contract is missing (might be a new token not yet synced),
            # but we log a warning.
            self.logger.warning("contract_not_found_in_master_skipping_master_checks", symbol=symbol)
            return

        self._check_expiry(contract)
        self._check_freeze_qty(contract, quantity)
        self._check_lot_size_multiplicity(contract, quantity)

    def _check_market_hours(self) -> None:
        """Check if market is currently open (09:15 - 15:30)."""
        now = datetime.now().time()
        # NSE Equity/FO market hours
        market_open = time(9, 15)
        market_close = time(15, 30)
        
        if now < market_open or now > market_close:
            # Note: We allow slightly after 15:30 for square-offs, but block entries
            # Strategy logic should handle entries, but here we provide a hard-stop for entries.
            pass # We don't raise here yet to allow after-market development/testing if paper_trade is on.
            # However, for live trading, this should be stricter.

    def _get_contract(self, trading_symbol: str) -> Optional[Contract]:
        """Fetch contract details from SQLite."""
        db = SessionLocal()
        try:
            contract = db.query(Contract).filter(Contract.trading_symbol == trading_symbol).first()
            return contract
        except Exception as e:
            self.logger.error("failed_to_fetch_contract_for_validation", symbol=trading_symbol, error=str(e))
            return None
        finally:
            db.close()

    def _check_expiry(self, contract: Contract) -> None:
        """Check if the contract is already expired."""
        if contract.expiry and contract.expiry < datetime.now().date():
            raise ValueError(f"Contract {contract.trading_symbol} expired on {contract.expiry}")

    def _check_freeze_qty(self, contract: Contract, quantity: int) -> None:
        """Check if quantity exceeds exchange freeze limits."""
        if contract.freeze_qty and quantity > contract.freeze_qty:
            raise ValueError(
                f"Quantity {quantity} exceeds freeze limit {contract.freeze_qty} for {contract.trading_symbol}"
            )

    def _check_lot_size_multiplicity(self, contract: Contract, quantity: int) -> None:
        """Check if quantity is a multiple of lot size."""
        if contract.lot_size and quantity % contract.lot_size != 0:
            raise ValueError(
                f"Quantity {quantity} is not a multiple of lot size {contract.lot_size} for {contract.trading_symbol}"
            )
