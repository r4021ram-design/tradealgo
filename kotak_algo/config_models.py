from typing import Optional
from pydantic import BaseModel, Field, field_validator


class TelegramConfig(BaseModel):
    enabled: bool = False
    bot_token: Optional[str] = None
    chat_id: Optional[str] = None


class BrokerConfig(BaseModel):
    consumer_key: str
    mobile_number: str
    ucc: str
    mpin: str
    totp_secret: str
    environment: str = "prod"
    telegram: TelegramConfig = Field(default_factory=TelegramConfig)


class StrategyConfig(BaseModel):
    enabled: bool = True
    underlying: str
    exchange_segment: str
    product: str
    lots: int
    lot_size: int
    strike_gap: int
    sl_multiplier: float
    target_pct: float
    entry_times: list[str]
    exit_time: str
    instrument_type: Optional[str] = None
    strangle_gap: Optional[int] = None


class RiskConfig(BaseModel):
    max_daily_loss: float
    combined_sl_pct: float
    max_open_strategies: int = 2
    paper_trade: bool = True
    max_reprice_attempts: int = 3
    reprice_interval_seconds: int = 30
    position_poll_interval_seconds: int = 5


class NSEReferenceConfig(BaseModel):
    enabled: bool = True
    refresh_time: str = "08:45"
    archive_dir: str = "data/nse"
    urls: Optional[dict[str, str]] = None


class AppConfig(BaseModel):
    broker: BrokerConfig
    strategies: dict[str, StrategyConfig] = {}
    risk: RiskConfig
    nse_reference: NSEReferenceConfig = Field(default_factory=NSEReferenceConfig)

    @field_validator("strategies")
    @classmethod
    def validate_strategies(cls, v):
        if not v:
            raise ValueError("At least one strategy must be configured")
        return v