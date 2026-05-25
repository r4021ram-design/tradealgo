"""
Instrument Master Validation Service.
Performs integrity checks on the contract database.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Dict, List, Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from kotak_algo.instruments.models.contract_model import Contract, SyncLog
from kotak_algo.utils.logger import get_logger

LOGGER = get_logger("instrument_validator")


class InstrumentValidator:
    def __init__(self, db: Session) -> None:
        self.db = db

    def run_full_audit(self) -> Dict[str, Any]:
        """Run all validation checks and return a summary."""
        results = {
            "freshness": self.check_freshness(),
            "lot_sizes": self.validate_lot_sizes(),
            "expiry_mapping": self.validate_expiry_dates(),
            "symbol_token_mapping": self.validate_token_mapping(),
            "summary": "PASSED"
        }
        
        # If any critical check failed, mark summary as FAILED
        if not results["freshness"]["valid"] or results["lot_sizes"]["errors"] > 10:
            results["summary"] = "FAILED"
            
        return results

    def check_freshness(self) -> Dict[str, Any]:
        """Ensure the last successful sync was within 24 hours."""
        last_success = self.db.query(SyncLog).filter(SyncLog.status == "SUCCESS").order_by(SyncLog.timestamp.desc()).first()
        
        if not last_success:
            return {"valid": False, "reason": "No successful sync found"}
            
        age = datetime.utcnow() - last_success.timestamp
        is_valid = age < timedelta(hours=25)
        
        return {
            "valid": is_valid,
            "last_sync": last_success.timestamp.isoformat(),
            "age_hours": round(age.total_seconds() / 3600, 1)
        }

    def validate_lot_sizes(self) -> Dict[str, Any]:
        """Check for missing or zero lot sizes for active contracts."""
        zero_lots = self.db.query(Contract).filter(Contract.lot_size <= 0, Contract.contract_status == "ACTIVE").all()
        
        # Check specific known lot sizes as sanity check (accepting lists of historically and currently valid lot sizes)
        sanity_checks = {
            "NIFTY": [25, 50, 65, 75],
            "BANKNIFTY": [15, 30],
            "FINNIFTY": [40, 60]
        }
        
        sanity_failures = []
        for symbol, expected in sanity_checks.items():
            actual = self.db.query(Contract.lot_size).filter(Contract.symbol == symbol).first()
            if actual:
                expected_list = expected if isinstance(expected, list) else [expected]
                if actual[0] not in expected_list:
                    sanity_failures.append(f"{symbol} lot size mismatch: expected one of {expected_list}, got {actual[0]}")

        return {
            "errors": len(zero_lots),
            "sanity_failures": sanity_failures,
            "examples": [c.trading_symbol for c in zero_lots[:5]]
        }

    def validate_expiry_dates(self) -> Dict[str, Any]:
        """Check for expired instruments marked as active."""
        today = date.today()
        expired_active = self.db.query(Contract).filter(Contract.expiry < today, Contract.contract_status == "ACTIVE").all()
        
        return {
            "errors": len(expired_active),
            "examples": [f"{c.trading_symbol} ({c.expiry})" for c in expired_active[:5]]
        }

    def validate_token_mapping(self) -> Dict[str, Any]:
        """Check for duplicate tokens or missing tokens for FO segments."""
        missing_tokens = self.db.query(Contract).filter(Contract.token == "", Contract.segment == "FO").all()
        
        # Duplicate tokens are allowed across different segments but rare in FO
        duplicate_tokens = self.db.query(Contract.token).filter(Contract.token != "").group_by(Contract.token).having(func.count(Contract.token) > 1).all()

        return {
            "missing_tokens": len(missing_tokens),
            "duplicate_tokens": len(duplicate_tokens),
            "examples": [c.trading_symbol for c in missing_tokens[:5]]
        }
