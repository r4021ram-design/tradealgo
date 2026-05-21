"""
Structured JSON logger with file rotation.

Logs are written to:
  - stdout (JSON, all levels)
  - kotak_algo/logs/algo_YYYYMMDD.log   (all levels)
  - kotak_algo/logs/errors_YYYYMMDD.log (ERROR+ only)

Logs older than 30 days are auto-deleted on startup.
"""

from __future__ import annotations

import glob
import logging
import os
import sys
import uuid
from datetime import datetime, timedelta
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

import structlog


# ── Globals set once on first call ──
_configured = False
_session_id = uuid.uuid4().hex[:8]
_trading_day = datetime.now().strftime("%Y-%m-%d")
_log_dir: Path | None = None


def _ensure_log_dir() -> Path:
    global _log_dir
    if _log_dir is None:
        _log_dir = Path(__file__).resolve().parents[1] / "logs"
        _log_dir.mkdir(parents=True, exist_ok=True)
    return _log_dir


def _purge_old_logs(max_age_days: int = 30) -> None:
    """Delete log files older than *max_age_days*."""
    log_dir = _ensure_log_dir()
    cutoff = datetime.now() - timedelta(days=max_age_days)
    for pattern in ("algo_*.log*", "errors_*.log*"):
        for path in glob.glob(str(log_dir / pattern)):
            try:
                mtime = datetime.fromtimestamp(os.path.getmtime(path))
                if mtime < cutoff:
                    os.remove(path)
            except OSError:
                pass


def _add_context(logger, method_name, event_dict):
    """Inject session_id and trading_day into every log entry."""
    event_dict["session_id"] = _session_id
    event_dict["trading_day"] = _trading_day
    return event_dict


def get_logger(name: str):
    global _configured

    if not _configured:
        _configured = True

        log_dir = _ensure_log_dir()
        _purge_old_logs()

        # ── stdlib root logger ──
        root = logging.getLogger()
        root.setLevel(logging.DEBUG)

        # Console handler (INFO+)
        console = logging.StreamHandler(sys.stdout)
        console.setLevel(logging.INFO)
        console.setFormatter(logging.Formatter("%(message)s"))
        root.addHandler(console)

        # Daily rotating file handler — all levels
        today = datetime.now().strftime("%Y%m%d")
        all_handler = TimedRotatingFileHandler(
            filename=str(log_dir / f"algo_{today}.log"),
            when="midnight",
            interval=1,
            backupCount=30,
            encoding="utf-8",
        )
        all_handler.setLevel(logging.DEBUG)
        all_handler.setFormatter(logging.Formatter("%(message)s"))
        root.addHandler(all_handler)

        # Error-only file handler
        err_handler = TimedRotatingFileHandler(
            filename=str(log_dir / f"errors_{today}.log"),
            when="midnight",
            interval=1,
            backupCount=30,
            encoding="utf-8",
        )
        err_handler.setLevel(logging.ERROR)
        err_handler.setFormatter(logging.Formatter("%(message)s"))
        root.addHandler(err_handler)

        # ── structlog configuration ──
        shared_processors = [
            structlog.contextvars.merge_contextvars,
            _add_context,
            structlog.processors.TimeStamper(fmt="iso", utc=False),
            structlog.stdlib.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
        ]

        structlog.configure(
            processors=shared_processors + [structlog.processors.JSONRenderer()],
            logger_factory=structlog.stdlib.LoggerFactory(),
            wrapper_class=structlog.stdlib.BoundLogger,
            cache_logger_on_first_use=True,
        )

    return structlog.get_logger(name)
