from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List
from kotak_algo.utils.logger import get_logger

LOGGER = get_logger("event_bus")


@dataclass
class Event:
    name: str
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)


class EventBus:
    def __init__(self) -> None:
        self._handlers: Dict[str, List[Callable]] = defaultdict(list)
        self._event_history: List[Event] = []
        self._max_history = 1000

    def subscribe(self, event_name: str, handler: Callable[[Event], None]) -> None:
        self._handlers[event_name].append(handler)
        LOGGER.debug("handler_subscribed", event_name=event_name, handler=handler.__name__)

    def unsubscribe(self, event_name: str, handler: Callable[[Event], None]) -> None:
        if event_name in self._handlers:
            self._handlers[event_name].remove(handler)

    def publish(self, event: Event) -> None:
        self._event_history.append(event)
        if len(self._event_history) > self._max_history:
            self._event_history = self._event_history[-self._max_history:]

        LOGGER.debug("event_published", event_name=event.name, data=event.data)
        for handler in self._handlers.get(event.name, []):
            try:
                handler(event)
            except Exception as exc:
                LOGGER.error("event_handler_error", event=event.name, handler=handler.__name__, error=str(exc))

    def get_history(self, event_name: str | None = None, limit: int = 100) -> List[Event]:
        if event_name:
            return [e for e in self._event_history if e.name == event_name][-limit:]
        return self._event_history[-limit:]


event_bus = EventBus()


class EventNames:
    # ── Existing ──
    LEG_STOP_LOSS_TRIGGERED = "leg_stop_loss_triggered"
    COMBINED_STOP_LOSS_TRIGGERED = "combined_stop_loss_triggered"
    STRATEGY_ENTERED = "strategy_entered"
    STRATEGY_EXITED = "strategy_exited"
    DAILY_LOSS_BREACHED = "daily_loss_breached"
    ORDER_FILLED = "order_filled"
    ORDER_CANCELLED = "order_cancelled"
    MARKT_DATA_UPDATE = "market_data_update"
    POSITION_UPDATE = "position_update"

    # ── Reliability Events (new) ──
    SESSION_EXPIRED = "session_expired"
    SESSION_REAUTH_SUCCESS = "session_reauth_success"
    SESSION_REAUTH_FAILED = "session_reauth_failed"
    RECONNECT_STARTED = "reconnect_started"
    RECONNECT_SUCCEEDED = "reconnect_succeeded"
    RECONNECT_FAILED = "reconnect_failed"
    DUPLICATE_ORDER_BLOCKED = "duplicate_order_blocked"
    API_CIRCUIT_OPEN = "api_circuit_open"
    API_CIRCUIT_CLOSED = "api_circuit_closed"
    STALE_DATA_DETECTED = "stale_data_detected"
    ORDER_REJECTED = "order_rejected"
    CRITICAL_ERROR = "critical_error"