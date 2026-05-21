from __future__ import annotations

from datetime import datetime, time

from kotak_algo.utils.logger import get_logger


class TimeScheduler:
    def __init__(self, logger=None) -> None:
        self.logger = logger or get_logger("scheduler")
        self.entry_windows = [
            (time(9, 20), time(9, 30)),
            (time(13, 0), time(13, 15)),
        ]
        self.no_entry_after = time(14, 30)
        self.hard_exit = time(15, 15)

    def now(self) -> datetime:
        return datetime.now()

    def is_entry_allowed(self) -> bool:
        current = self.now().time()
        if current >= self.no_entry_after:
            return False
        return any(start <= current <= end for start, end in self.entry_windows)

    def match_entry_time(self, configured_times: list[str]) -> str | None:
        current = self.now().strftime("%H:%M")
        return current if current in configured_times else None

    def is_exit_time(self, configured_exit_time: str) -> bool:
        current = self.now().strftime("%H:%M")
        return current >= configured_exit_time

    def is_hard_exit_due(self) -> bool:
        return self.now().time() >= self.hard_exit

