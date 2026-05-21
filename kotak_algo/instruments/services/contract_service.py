from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from kotak_algo.instruments.models.contract_model import Contract
from datetime import date

class ContractService:
    def __init__(self, db: Session):
        self.db = db

    def get_contracts(self, symbol: str = None, expiry: date = None, instrument_type: str = None) -> List[Contract]:
        query = self.db.query(Contract)
        if symbol:
            query = query.filter(Contract.symbol == symbol.upper())
        if expiry:
            query = query.filter(Contract.expiry == expiry)
        if instrument_type:
            query = query.filter(Contract.instrument_type == instrument_type)
        return query.all()

    def search_contracts(self, query_str: str, limit: int = 50) -> List[Contract]:
        return self.db.query(Contract).filter(
            or_(
                Contract.trading_symbol.ilike(f"%{query_str}%"),
                Contract.symbol.ilike(f"%{query_str}%")
            )
        ).limit(limit).all()

    def get_active_contracts(self) -> List[Contract]:
        return self.db.query(Contract).filter(Contract.contract_status == "ACTIVE").all()

    def get_expiry_dates(self, symbol: str) -> List[date]:
        results = self.db.query(Contract.expiry).filter(Contract.symbol == symbol.upper()).distinct().all()
        return sorted([r[0] for r in results if r[0]])

    def get_strikes(self, symbol: str, expiry: date) -> List[float]:
        results = self.db.query(Contract.strike).filter(
            and_(Contract.symbol == symbol.upper(), Contract.expiry == expiry)
        ).distinct().all()
        return sorted([r[0] for r in results if r[0]])

    def get_lot_size(self, symbol: str) -> Optional[int]:
        contract = self.db.query(Contract).filter(Contract.symbol == symbol.upper()).first()
        return contract.lot_size if contract else None
        
    def get_atm_strike(self, symbol: str, spot_price: float, step: float = 50) -> float:
        return round(spot_price / step) * step

    def get_otm_strikes(self, symbol: str, expiry: date, spot_price: float, count: int = 10) -> Dict[str, List[float]]:
        strikes = self.get_strikes(symbol, expiry)
        atm = self.get_atm_strike(symbol, spot_price)
        
        ce_otm = [s for s in strikes if s > atm][:count]
        pe_otm = [s for s in strikes if s < atm][-count:]
        
        return {"ce": ce_otm, "pe": pe_otm}

    def get_itm_strikes(self, symbol: str, expiry: date, spot_price: float, count: int = 10) -> Dict[str, List[float]]:
        strikes = self.get_strikes(symbol, expiry)
        atm = self.get_atm_strike(symbol, spot_price)
        
        ce_itm = [s for s in strikes if s < atm][-count:]
        pe_itm = [s for s in strikes if s > atm][:count]
        
        return {"ce": ce_itm, "pe": pe_itm}
