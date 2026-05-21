"""
Retry decorator and Circuit Breaker for broker API resilience.

Usage:
    @retry(max_attempts=3, backoff=2.0, retryable=(ConnectionError, TimeoutError))
    def call_broker():
        ...

    breaker = CircuitBreaker(name="kotak_api")
    result = breaker.call(lambda: broker.place_order(**payload))
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta
from enum import Enum
from functools import wraps
from typing import Any, Callable, Tuple, Type, TypeVar

from kotak_algo.utils.logger import get_logger

LOGGER = get_logger("retry")

T = TypeVar("T")


# ── Retry Decorator ──────────────────────────────────────────────

def retry(
    max_attempts: int = 3,
    backoff: float = 2.0,
    max_delay: float = 30.0,
    retryable: Tuple[Type[Exception], ...] = (Exception,),
    on_retry: Callable[[int, Exception], None] | None = None,
):
    """
    Retry with exponential backoff.

    Parameters
    ----------
    max_attempts : total calls (1 = no retry)
    backoff      : multiplier for each successive wait
    max_delay    : cap on the sleep time
    retryable    : exception types that trigger a retry
    on_retry     : optional callback(attempt, exception) before sleeping
    """

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            last_exc: Exception | None = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except retryable as exc:
                    last_exc = exc
                    if attempt == max_attempts:
                        LOGGER.error(
                            "retry_exhausted",
                            func=func.__qualname__,
                            attempts=max_attempts,
                            error=str(exc),
                        )
                        raise
                    delay = min(backoff ** (attempt - 1), max_delay)
                    LOGGER.warning(
                        "retrying",
                        func=func.__qualname__,
                        attempt=attempt,
                        max_attempts=max_attempts,
                        delay=delay,
                        error=str(exc),
                    )
                    if on_retry:
                        on_retry(attempt, exc)
                    time.sleep(delay)
            raise last_exc  # type: ignore[misc]  # unreachable but keeps mypy happy

        return wrapper

    return decorator


# ── Circuit Breaker ──────────────────────────────────────────────

class CircuitState(Enum):
    CLOSED = "closed"        # Normal — requests pass through
    OPEN = "open"            # Failing — reject immediately
    HALF_OPEN = "half_open"  # Testing — allow one probe request


class CircuitBreaker:
    """
    Wraps an external service call to prevent cascading failures.

    - After *failure_threshold* consecutive failures → OPEN (reject all)
    - After *timeout* seconds → HALF_OPEN (allow one probe)
    - If probe succeeds *success_threshold* times → CLOSED
    """

    def __init__(
        self,
        name: str = "circuit",
        failure_threshold: int = 5,
        timeout: float = 30.0,
        success_threshold: int = 2,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.timeout = timedelta(seconds=timeout)
        self.success_threshold = success_threshold

        self._lock = threading.Lock()
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time: datetime | None = None

    @property
    def state(self) -> CircuitState:
        with self._lock:
            if self._state == CircuitState.OPEN and self._last_failure_time:
                if datetime.now() - self._last_failure_time > self.timeout:
                    self._state = CircuitState.HALF_OPEN
                    self._success_count = 0
                    LOGGER.info("circuit_half_open", name=self.name)
            return self._state

    def call(self, func: Callable[[], T]) -> T:
        current = self.state

        if current == CircuitState.OPEN:
            LOGGER.warning("circuit_open_rejecting", name=self.name)
            raise RuntimeError(
                f"Circuit breaker '{self.name}' is OPEN — broker API unavailable"
            )

        try:
            result = func()
            self._on_success()
            return result
        except Exception as exc:
            self._on_failure()
            raise

    def _on_success(self) -> None:
        with self._lock:
            self._failure_count = 0
            if self._state == CircuitState.HALF_OPEN:
                self._success_count += 1
                if self._success_count >= self.success_threshold:
                    self._state = CircuitState.CLOSED
                    self._success_count = 0
                    LOGGER.info("circuit_closed", name=self.name)

    def _on_failure(self) -> None:
        with self._lock:
            self._failure_count += 1
            self._last_failure_time = datetime.now()
            if self._failure_count >= self.failure_threshold:
                self._state = CircuitState.OPEN
                LOGGER.error(
                    "circuit_opened",
                    name=self.name,
                    failures=self._failure_count,
                )

    def reset(self) -> None:
        """Force-reset to CLOSED (e.g. after successful re-authentication)."""
        with self._lock:
            self._state = CircuitState.CLOSED
            self._failure_count = 0
            self._success_count = 0
            LOGGER.info("circuit_force_reset", name=self.name)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "state": self.state.value,
            "failure_count": self._failure_count,
            "last_failure": self._last_failure_time.isoformat() if self._last_failure_time else None,
        }
