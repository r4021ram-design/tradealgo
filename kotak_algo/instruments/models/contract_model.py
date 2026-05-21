from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Date, Index
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class Contract(Base):
    __tablename__ = "contracts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    exchange = Column(String(10), default="NSE")
    segment = Column(String(10), default="FO")
    symbol = Column(String(20), index=True) # e.g., NIFTY
    trading_symbol = Column(String(80), index=True)  # e.g., BANKNIFTY26JUN65400CE
    underlying = Column(String(20))
    expiry = Column(Date, index=True)
    strike = Column(Float, index=True)
    option_type = Column(String(2)) # CE, PE, or XX for futures
    instrument_type = Column(String(10)) # OPTIDX, OPTSTK, FUTIDX, FUTSTK
    lot_size = Column(Integer)
    tick_size = Column(Float, default=0.05)
    freeze_qty = Column(Integer)
    token = Column(String(20), index=True)
    weekly_monthly_flag = Column(String(10)) # WEEKLY, MONTHLY
    contract_status = Column(String(10), default="ACTIVE")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index('idx_symbol_expiry_strike', 'symbol', 'expiry', 'strike'),
    )

class ExpiryCalendar(Base):
    __tablename__ = "expiry_calendar"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(20), index=True)
    expiry_date = Column(Date, index=True)
    expiry_type = Column(String(10)) # WEEKLY, MONTHLY
    is_holiday_adjusted = Column(Boolean, default=False)

class LotHistory(Base):
    __tablename__ = "lot_history"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(20), index=True)
    lot_size = Column(Integer)
    effective_from = Column(Date)

class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(Integer, primary_key=True)
    sync_type = Column(String(20)) # DAILY, STARTUP, EXPIRY
    status = Column(String(10)) # SUCCESS, FAILED
    message = Column(String(255))
    timestamp = Column(DateTime, default=datetime.utcnow)
