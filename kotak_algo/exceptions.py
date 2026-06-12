"""
Centralized exception hierarchy for the KotakAlgo trading engine.

Every exception carries structured context so that callers can
make recovery decisions without parsing string messages.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict


class ErrorCode:
    AUTH_ERROR = "AUTH_ERROR"
    ORDER_ERROR = "ORDER_ERROR"
    RMS_ERROR = "RMS_ERROR"
    NETWORK_ERROR = "NETWORK_ERROR"
    NSE_DATA_ERROR = "NSE_DATA_ERROR"
    WEBSOCKET_ERROR = "WEBSOCKET_ERROR"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    STRATEGY_ERROR = "STRATEGY_ERROR"
    RISK_ERROR = "RISK_ERROR"
    ALGO_ERROR = "ALGO_ERROR"


class AlgoError(Exception):
    """Base exception for all KotakAlgo errors."""

    code: str = ErrorCode.ALGO_ERROR
    is_recoverable: bool = True

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        details: Dict[str, Any] | None = None,
        is_recoverable: bool | None = None,
    ) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code
        if is_recoverable is not None:
            self.is_recoverable = is_recoverable
        self.details: Dict[str, Any] = details or {}
        self.timestamp: datetime = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "error": self.code,
            "message": str(self),
            "details": self.details,
            "recoverable": self.is_recoverable,
            "timestamp": self.timestamp.isoformat(),
        }


# ── Broker Errors ────────────────────────────────────────────────

class BrokerError(AlgoError):
    """Base for all broker-related errors."""
    code = ErrorCode.ORDER_ERROR


class AuthenticationError(BrokerError):
    """Login / TOTP / MPIN failures."""
    code = ErrorCode.AUTH_ERROR
    is_recoverable = True  # Can retry with fresh TOTP


class SessionExpiredError(BrokerError):
    """Token/session has expired (401/403 or 'Invalid Token')."""
    code = ErrorCode.AUTH_ERROR
    is_recoverable = True  # Re-authenticate and retry


class OrderRejectedError(BrokerError):
    """Exchange or broker rejected the order."""
    code = ErrorCode.ORDER_ERROR
    is_recoverable = False

    def __init__(self, message: str, *, order_payload: Dict[str, Any] | None = None, **kw):
        super().__init__(message, **kw)
        self.details["order_payload"] = order_payload


class DuplicateOrderError(BrokerError):
    """Same symbol+side+qty placed within the cooldown window."""
    code = ErrorCode.VALIDATION_ERROR
    is_recoverable = False


class APIResponseError(BrokerError):
    """Unexpected / malformed API response from the broker."""
    code = "API_RESPONSE_ERROR"
    is_recoverable = True

    def __init__(self, message: str, *, raw_response: Any = None, **kw):
        super().__init__(message, **kw)
        self.details["raw_response"] = repr(raw_response)[:500]


# ── Data Errors ──────────────────────────────────────────────────

class DataError(AlgoError):
    """Base for market-data problems."""
    code = ErrorCode.NSE_DATA_ERROR


class InvalidMarketDataError(DataError):
    """Tick with NaN, negative, or zero price."""
    code = "INVALID_MARKET_DATA"
    is_recoverable = True


class StaleDataError(DataError):
    """No tick received for a symbol beyond the threshold."""
    code = "STALE_DATA"
    is_recoverable = True


# ── Risk Errors ──────────────────────────────────────────────────

class RiskError(AlgoError):
    """Base for risk-engine violations."""
    code = ErrorCode.RISK_ERROR
    is_recoverable = False


class DailyLossBreachedError(RiskError):
    code = "DAILY_LOSS_BREACHED"


class MaxPositionsError(RiskError):
    code = "MAX_POSITIONS"


# ── WebSocket Errors ─────────────────────────────────────────────

class WebSocketError(AlgoError):
    """Base for feed connection issues."""
    code = ErrorCode.WEBSOCKET_ERROR


class ConnectionLostError(WebSocketError):
    code = "CONNECTION_LOST"
    is_recoverable = True


class ReconnectFailedError(WebSocketError):
    """Exhausted all reconnection attempts."""
    code = "RECONNECT_FAILED"
    is_recoverable = False


# ── Sentinel strings returned by Kotak Neo on expired sessions ──

SESSION_EXPIRED_SIGNALS = frozenset({
    "invalid token",
    "session expired",
    "token expired",
    "unauthorized",
    "not logged in",
    "login required",
    "complete the 2fa",
    "2fa process",
    "401",
    "403",
    "access denied",
})


def looks_like_session_expired(response: Any) -> bool:
    """Heuristic check: does the API response hint at an expired session?"""
    if response is None:
        return False

    # If it is a dictionary, inspect common error keys first
    if isinstance(response, dict):
        err_fields = [
            response.get("Error Message"),
            response.get("errorMessage"),
            response.get("error"),
            response.get("errMsg"),
            response.get("message"),
            response.get("detail"),
        ]
        fault = response.get("fault")
        if isinstance(fault, dict):
            err_fields.append(fault.get("code"))
            err_fields.append(fault.get("message"))
            err_fields.append(fault.get("description"))

        for val in err_fields:
            if val is not None:
                try:
                    val_str = str(val)
                    if val_str:
                        val_str = val_str.lower()
                        if any(sig in val_str for sig in SESSION_EXPIRED_SIGNALS):
                            return True
                except Exception:
                    pass
        return False

    # If it is a list, check individual items recursively instead of stringifying the entire list
    if isinstance(response, list):
        return any(looks_like_session_expired(item) for item in response)

    text = str(response).lower()
    # If the text is long, don't do a broad check for "401" or "403" to avoid false positives in data payloads
    if len(text) > 500:
        safe_signals = SESSION_EXPIRED_SIGNALS - {"401", "403"}
        return any(sig in text for sig in safe_signals)

    return any(sig in text for sig in SESSION_EXPIRED_SIGNALS)
