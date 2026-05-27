"""
Validate every response from the Kotak Neo API before it reaches
the trading engine.  Any invalid response raises a typed exception
instead of silently propagating garbage data.
"""

from __future__ import annotations

import math
from typing import Any

from kotak_algo.exceptions import (
    APIResponseError,
    InvalidMarketDataError,
    OrderRejectedError,
    SessionExpiredError,
    looks_like_session_expired,
)
from kotak_algo.utils.logger import get_logger

LOGGER = get_logger("api_validator")

# Maximum single-tick price change (%) before we flag it as suspicious
MAX_TICK_JUMP_PCT = 20.0


# ── Order Response ───────────────────────────────────────────────

def validate_order_response(response: Any, *, context: str = "") -> str:
    """
    Validate a place_order / modify_order response.

    Returns the order_id on success.
    Raises SessionExpiredError, OrderRejectedError, or APIResponseError.
    """
    if looks_like_session_expired(response):
        raise SessionExpiredError(
            f"Session expired during {context or 'order call'}",
            details={"raw": repr(response)[:300]},
        )

    # Check for explicit error fields
    if isinstance(response, dict):
        stat = str(response.get("stat", "")).lower()
        error_msg = str(response.get("errMsg") or response.get("error") or response.get("message", "")).lower()

        if stat in ("not_ok", "error") or "rejected" in error_msg:
            # Categorize the rejection
            if any(s in error_msg for s in ("margin", "insufficient", "balance")):
                reason = f"Margin shortfall: {error_msg}"
            elif any(s in error_msg for s in ("rms", "limit", "exposure")):
                reason = f"RMS Rejection: {error_msg}"
            elif any(s in error_msg for s in ("circuit", "range", "limit")):
                reason = f"Price out of range/Circuit: {error_msg}"
            elif "freeze" in error_msg:
                reason = f"Freeze quantity exceeded: {error_msg}"
            else:
                reason = f"Order rejected: {error_msg}"
                
            raise OrderRejectedError(
                reason,
                order_payload=response,
            )

        # Extract order id
        for key in ("nOrdNo", "order_id", "orderId"):
            val = response.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()

        nested = response.get("data")
        if isinstance(nested, dict):
            for key in ("nOrdNo", "order_id", "orderId"):
                val = nested.get(key)
                if isinstance(val, str) and val.strip():
                    return val.strip()

    if isinstance(response, str) and response.strip():
        return response.strip()

    raise APIResponseError(
        f"Cannot extract order_id from {context or 'order'} response",
        raw_response=response,
    )


# ── Positions Response ───────────────────────────────────────────

def validate_positions_response(response: Any) -> list[dict]:
    """
    Ensure the positions response is a list of dicts.
    Returns the validated list (may be empty).
    """
    if looks_like_session_expired(response):
        raise SessionExpiredError("Session expired during positions fetch")

    if response is None:
        return []

    if isinstance(response, list):
        return response

    if isinstance(response, dict):
        # Some brokers wrap in {"data": [...]} or {"positions": [...]}
        inner = response.get("data") or response.get("positions")
        if isinstance(inner, list):
            return inner

        # Check for explicit error messages
        err_msg = (
            response.get("Error Message")
            or response.get("errorMessage")
            or response.get("error")
            or response.get("errMsg")
            or response.get("message")
        )
        
        stat = str(response.get("stat", "")).lower()
        
        # If there is a stat = "ok" and data is empty/missing, it means no positions
        if stat in ("ok", "success") and ("data" in response or "positions" in response) and not inner:
            return []

        # If it's a known error indicating no positions or empty list
        if err_msg:
            err_lower = str(err_msg).lower()
            if any(
                pat in err_lower
                for pat in (
                    "no position",
                    "no data",
                    "no record",
                    "empty",
                    "no transaction",
                    "no active position",
                )
            ):
                LOGGER.info("positions_empty", message=err_msg)
                return []
            
            # If there's an error message but it's not benign
            raise APIResponseError(f"Positions API returned error: {err_msg}", raw_response=response)

        if stat in ("not_ok", "error"):
            err_desc = err_msg or "Unknown error"
            LOGGER.warning("positions_response_error", error=err_desc)
            return []

        # If it is a dict but has a single key or doesn't have data, it could be malformed
        raise APIResponseError("Positions dictionary response missing list data", raw_response=response)

    raise APIResponseError("Unexpected positions response type", raw_response=response)


# ── Cancellation Response ────────────────────────────────────────

def validate_cancel_response(response: Any, *, context: str = "") -> str:
    """
    Validate a cancel_order response.

    Returns the order_id/status on success.
    Raises SessionExpiredError, OrderRejectedError, or APIResponseError.
    """
    if looks_like_session_expired(response):
        raise SessionExpiredError(
            f"Session expired during {context or 'cancel call'}",
            details={"raw": repr(response)[:300]},
        )

    # Check for explicit error fields
    if isinstance(response, dict):
        stat = str(response.get("stat", "")).lower()
        error_msg = str(
            response.get("errMsg")
            or response.get("error")
            or response.get("message")
            or response.get("Error Message")
            or ""
        ).lower()

        # If it failed/was rejected
        if stat in ("not_ok", "error") or "rejected" in error_msg:
            # Benign rejection cases (e.g. order is already filled or cancelled)
            if any(s in error_msg for s in ("already filled", "already cancelled", "not pending", "completed")):
                LOGGER.info("order_cancel_benign_failure", error=error_msg)
                # Return the order_id if present, or "benign_failure"
                for key in ("nOrdNo", "order_id", "orderId"):
                    val = response.get(key)
                    if isinstance(val, str) and val.strip():
                        return val.strip()
                return "benign_failure"
            
            raise OrderRejectedError(
                f"Cancel order rejected: {error_msg}",
                order_payload=response,
            )

        # Extract order id
        for key in ("nOrdNo", "order_id", "orderId"):
            val = response.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()

        nested = response.get("data")
        if isinstance(nested, dict):
            for key in ("nOrdNo", "order_id", "orderId"):
                val = nested.get(key)
                if isinstance(val, str) and val.strip():
                    return val.strip()

    if isinstance(response, str) and response.strip():
        return response.strip()

    raise APIResponseError(
        f"Cannot extract order_id/status from {context or 'cancel'} response",
        raw_response=response,
    )


# ── Market Data Tick ─────────────────────────────────────────────

def validate_tick(
    ltp: float,
    bid: float | None = None,
    ask: float | None = None,
    prev_ltp: float | None = None,
    symbol: str = "",
) -> bool:
    """
    Validate a single market data tick.

    Returns True if valid, raises InvalidMarketDataError if not.
    """
    # NaN / Inf check
    if math.isnan(ltp) or math.isinf(ltp):
        raise InvalidMarketDataError(
            f"NaN/Inf LTP for {symbol}",
            details={"ltp": ltp, "symbol": symbol},
        )

    # Negative / zero price
    if ltp <= 0:
        raise InvalidMarketDataError(
            f"Non-positive LTP {ltp} for {symbol}",
            details={"ltp": ltp, "symbol": symbol},
        )

    # Bid/Ask sanity
    if bid is not None and ask is not None:
        if bid > ask and bid > 0 and ask > 0:
            LOGGER.warning("bid_exceeds_ask", symbol=symbol, bid=bid, ask=ask)

    # Large jump detection
    if prev_ltp and prev_ltp > 0:
        pct_change = abs(ltp - prev_ltp) / prev_ltp * 100
        if pct_change > MAX_TICK_JUMP_PCT:
            LOGGER.warning(
                "large_tick_jump",
                symbol=symbol,
                prev_ltp=prev_ltp,
                ltp=ltp,
                pct_change=round(pct_change, 2),
            )
            # We warn but don't reject — large jumps happen on gap opens

    return True


# ── Generic Response Check ───────────────────────────────────────

def check_session(response: Any, context: str = "") -> None:
    """Raise SessionExpiredError if the response looks like an expired session."""
    if looks_like_session_expired(response):
        raise SessionExpiredError(
            f"Session expired during {context}",
            details={"raw": repr(response)[:300]},
        )
