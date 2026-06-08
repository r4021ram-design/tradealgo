from __future__ import annotations
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any
import structlog

LOGGER = structlog.get_logger("telemetry")

class TelemetryManager:
    def __init__(self, db_path: Path | None = None) -> None:
        if db_path is None:
            db_path = Path(__file__).resolve().parents[1] / "instruments" / "data" / "telemetry.db"
        self.db_path = db_path
        self._ensure_db_schema()

    def _ensure_db_schema(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        try:
            with conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS telemetry_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        strategy_name TEXT NOT NULL,
                        pnl REAL,
                        margin_used REAL,
                        details TEXT
                    )
                """)
        finally:
            conn.close()

    def log_event(
        self,
        event_type: str,
        strategy_name: str,
        details: dict[str, Any],
        pnl: float,
        margin_used: float
    ) -> None:
        timestamp = datetime.now().isoformat()
        details_str = json.dumps(details)
        
        # 1. Log structured structlog message
        LOGGER.info(
            "telemetry_event_recorded",
            timestamp=timestamp,
            event_type=event_type,
            strategy_name=strategy_name,
            pnl=pnl,
            margin_used=margin_used,
            details=details
        )
        
        # 2. Insert into SQLite
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO telemetry_logs (timestamp, event_type, strategy_name, pnl, margin_used, details)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (timestamp, event_type, strategy_name, pnl, margin_used, details_str)
                )
        except Exception as exc:
            LOGGER.error("telemetry_insert_failed", error=str(exc))
        finally:
            conn.close()

    def get_events(self, limit: int = 100) -> list[dict[str, Any]]:
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        try:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM telemetry_logs ORDER BY timestamp DESC LIMIT ?",
                (limit,)
            )
            rows = cursor.fetchall()
            return [
                {
                    "id": row["id"],
                    "timestamp": row["timestamp"],
                    "event_type": row["event_type"],
                    "strategy_name": row["strategy_name"],
                    "pnl": row["pnl"],
                    "margin_used": row["margin_used"],
                    "details": json.loads(row["details"]) if row["details"] else {}
                }
                for row in rows
            ]
        except Exception as exc:
            LOGGER.error("telemetry_select_failed", error=str(exc))
            return []
        finally:
            conn.close()
