from __future__ import annotations

import asyncio
import threading
from datetime import datetime
from typing import Any

from kotak_algo.utils.logger import get_logger

try:
    from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup
except ImportError:  # pragma: no cover
    Bot = None  # type: ignore[assignment]
    InlineKeyboardButton = None  # type: ignore[assignment]
    InlineKeyboardMarkup = None  # type: ignore[assignment]


class TelegramNotifier:
    def __init__(self, config: dict, logger=None) -> None:
        self.enabled = bool(config.get("enabled"))
        self.chat_id = config.get("chat_id")
        self.bot_token = config.get("bot_token")
        self.logger = (logger or get_logger("telegram")).bind(component="telegram")
        self.bot = Bot(token=self.bot_token) if self.enabled and Bot and self.bot_token else None
        self.app = None
        self.listener = None

    def register_app(self, app) -> None:
        self.app = app

    def start_bot_listener(self) -> None:
        if self.enabled and self.bot_token and self.app:
            self.listener = TelegramBotListener(self.bot_token, self.app, self.logger)
            self.listener.start()

    def stop_bot_listener(self) -> None:
        if self.listener:
            self.listener.stop()

    def send(self, message: str, parse_mode: str | None = None, reply_markup: Any | None = None) -> None:
        self.logger.info("telegram_alert", enabled=self.enabled, message=message)
        if not self.enabled or not self.bot or not self.chat_id:
            return
        try:
            async def _send():
                await self.bot.send_message(
                    chat_id=self.chat_id,
                    text=message,
                    parse_mode=parse_mode,
                    reply_markup=reply_markup
                )
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(_send())
            except RuntimeError:
                asyncio.run(_send())
        except Exception as exc:  # pragma: no cover
            self.logger.exception("telegram_send_failed", error=str(exc))


class TelegramBotListener:
    def __init__(self, token: str, app_instance, logger) -> None:
        self.token = token
        self.app = app_instance
        self.logger = logger
        self.loop = None
        self.application = None
        self.thread = None
        self._shutdown_event = threading.Event()

    def start(self) -> None:
        self.thread = threading.Thread(target=self._run, daemon=True, name="TelegramBotListener")
        self.thread.start()

    def _run(self) -> None:
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        
        from telegram.ext import ApplicationBuilder, CallbackQueryHandler, CommandHandler
        
        self.application = ApplicationBuilder().token(self.token).build()
        self.application.add_handler(CommandHandler("start", self.cmd_start))
        self.application.add_handler(CommandHandler("status", self.cmd_status))
        self.application.add_handler(CommandHandler("kill", self.cmd_kill))
        self.application.add_handler(CallbackQueryHandler(self.handle_callback))
        
        self.loop.run_until_complete(self.application.initialize())
        self.loop.run_until_complete(self.application.start())
        self.loop.run_until_complete(self.application.updater.start_polling())
        
        self.logger.info("telegram_bot_listener_started")
        
        # Keep loop alive until shutdown is signaled
        while not self._shutdown_event.is_set():
            self.loop.run_until_complete(asyncio.sleep(0.5))
            
        # Clean shutdown
        self.loop.run_until_complete(self.application.updater.stop())
        self.loop.run_until_complete(self.application.stop())
        self.loop.run_until_complete(self.application.shutdown())
        self.loop.close()
        self.logger.info("telegram_bot_listener_stopped")

    def stop(self) -> None:
        self._shutdown_event.set()
        if self.thread:
            self.thread.join(timeout=3.0)

    def _get_summary_html_and_markup(self) -> tuple[str, InlineKeyboardMarkup]:
        pnl = self.app.position_tracker.total_pnl()
        margin_used = self.app.position_tracker.margin_used
        available_margin = self.app.position_tracker.available_margin
        net_premium = self.app.position_tracker.net_premium_received()
        
        open_positions = []
        for symbol, leg in self.app.position_tracker.legs.items():
            if leg.get("status") == "OPEN":
                open_positions.append(leg)
                
        pos_lines = []
        for leg in open_positions:
            symbol = leg["trading_symbol"]
            qty = leg["quantity"]
            side = leg.get("side", "SHORT")
            ltp = self.app.position_tracker.ltp(symbol)
            entry = leg.get("entry_price", 0.0)
            leg_pnl = (ltp - entry) * qty if side == "LONG" else (entry - ltp) * qty
            sign = "+" if leg_pnl >= 0 else ""
            pos_lines.append(f"• <code>{symbol}</code> ({side}) x{qty}\n  LTP: ₹{ltp:.2f} | PnL: {sign}₹{leg_pnl:.2f}")
            
        positions_str = "\n".join(pos_lines) if pos_lines else "No open positions."
        
        pnl_sign = "+" if pnl >= 0 else ""
        pnl_emoji = "🟢" if pnl >= 0 else "🔴"
        
        html = (
            f"📊 <b>KotakAlgo Live Metrics</b> {pnl_emoji}\n"
            f"━━━━━━━━━━━━━━━━━\n"
            f"💰 <b>Net P&L:</b> <code>{pnl_sign}₹{pnl:.2f}</code>\n"
            f"💳 <b>Margin Used:</b> ₹{margin_used:.2f}\n"
            f"🏦 <b>Available Margin:</b> ₹{available_margin:.2f}\n"
            f"📦 <b>Net Premium Recv:</b> ₹{net_premium:.2f}\n\n"
            f"📂 <b>Open Positions:</b>\n"
            f"{positions_str}\n\n"
            f"🕒 <i>Last Updated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} (IST)</i>"
        )
        
        keyboard = [
            [
                InlineKeyboardButton("🔄 Refresh P&L", callback_data="refresh"),
                InlineKeyboardButton("🚨 KILL SWITCH", callback_data="kill")
            ],
            [
                InlineKeyboardButton("📊 Dashboard", url="http://localhost:5173/")
            ]
        ]
        return html, InlineKeyboardMarkup(keyboard)

    async def cmd_start(self, update, context) -> None:
        html, markup = self._get_summary_html_and_markup()
        await update.message.reply_text(html, parse_mode="HTML", reply_markup=markup)

    async def cmd_status(self, update, context) -> None:
        html, markup = self._get_summary_html_and_markup()
        await update.message.reply_text(html, parse_mode="HTML", reply_markup=markup)

    async def cmd_kill(self, update, context) -> None:
        def _do_kill():
            self.app.risk_manager.activate_kill_switch(self.app.order_manager, reason="telegram_command")
        await asyncio.to_thread(_do_kill)
        await update.message.reply_text("🚨 <b>EMERGENCY: Kill Switch Activated via Telegram Command!</b>", parse_mode="HTML")

    async def handle_callback(self, update, context) -> None:
        query = update.callback_query
        await query.answer()
        
        if query.data == "refresh":
            html, markup = self._get_summary_html_and_markup()
            try:
                await query.edit_message_text(html, parse_mode="HTML", reply_markup=markup)
            except Exception as e:
                self.logger.debug("tg_refresh_unchanged")
        elif query.data == "kill":
            def _do_kill():
                self.app.risk_manager.activate_kill_switch(self.app.order_manager, reason="telegram_button")
            await asyncio.to_thread(_do_kill)
            try:
                await query.edit_message_text(
                    query.message.text + "\n\n🚨 <b>EMERGENCY: Kill Switch Activated via Telegram! All positions squared off.</b>",
                    parse_mode="HTML"
                )
            except Exception as e:
                self.logger.exception("tg_kill_ui_update_failed", error=str(e))
