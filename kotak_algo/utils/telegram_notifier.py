from __future__ import annotations

import asyncio

from kotak_algo.utils.logger import get_logger

try:
    from telegram import Bot
except ImportError:  # pragma: no cover - optional dependency
    Bot = None  # type: ignore[assignment]


class TelegramNotifier:
    def __init__(self, config: dict, logger=None) -> None:
        self.enabled = bool(config.get("enabled"))
        self.chat_id = config.get("chat_id")
        self.logger = (logger or get_logger("telegram")).bind(component="telegram")
        self.bot = Bot(token=config.get("bot_token")) if self.enabled and Bot else None

    def send(self, message: str) -> None:
        self.logger.info("telegram_alert", enabled=self.enabled, message=message)
        if not self.enabled or not self.bot or not self.chat_id:
            return
        try:
            asyncio.run(self.bot.send_message(chat_id=self.chat_id, text=message))
        except RuntimeError:
            loop = asyncio.get_event_loop()
            loop.create_task(self.bot.send_message(chat_id=self.chat_id, text=message))
        except Exception as exc:  # pragma: no cover - network/runtime dependent
            self.logger.exception("telegram_send_failed", error=str(exc))

