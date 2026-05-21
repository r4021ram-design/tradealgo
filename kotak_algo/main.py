from __future__ import annotations

import signal
import sys
import time
from pathlib import Path

from kotak_algo.broker.neo_client import NeoBrokerClient
from kotak_algo.broker.order_manager import OrderManager
from kotak_algo.broker.websocket_feed import WebSocketFeed
from kotak_algo.core.position_tracker import PositionTracker
from kotak_algo.core.nse_reference import NSEReferenceUpdater
from kotak_algo.core.risk_manager import RiskManager
from kotak_algo.core.scheduler import TimeScheduler
from kotak_algo.core.strike_selector import StrikeSelector
from kotak_algo.strategies.straddle import StraddleStrategy
from kotak_algo.strategies.strangle import StrangleStrategy
from kotak_algo.utils.config_loader import load_config
from kotak_algo.config_models import AppConfig
from kotak_algo.utils.logger import get_logger
from kotak_algo.utils.telegram_notifier import TelegramNotifier
from kotak_algo.events import event_bus, Event, EventNames
from kotak_algo.exceptions import AlgoError


LOGGER = get_logger("main")


class AlgoApp:
    def __init__(self, config_path: Path, use_di: bool = False) -> None:
        raw_config = load_config(config_path)
        self.config = AppConfig.model_validate(raw_config).model_dump()

        self.logger = LOGGER.bind(component="algo_app")
        self.notifier = TelegramNotifier(self.config["broker"].get("telegram", {}))
        self.broker = NeoBrokerClient(self.config["broker"], logger=self.logger)
        self.position_tracker = PositionTracker(
            client_provider=self.broker,
            poll_interval=self.config["risk"].get("position_poll_interval_seconds", 5),
            logger=self.logger,
        )
        self.websocket = WebSocketFeed(
            broker=self.broker,
            position_tracker=self.position_tracker,
            logger=self.logger,
        )
        self.risk_manager = RiskManager(
            risk_config=self.config["risk"],
            position_tracker=self.position_tracker,
            notifier=self.notifier,
            logger=self.logger,
        )
        self.order_manager = OrderManager(
            broker=self.broker,
            position_tracker=self.position_tracker,
            risk_manager=self.risk_manager,
            notifier=self.notifier,
            logger=self.logger,
            paper_trade=self.config["risk"].get("paper_trade", True),
            reprice_interval=self.config["risk"].get("reprice_interval_seconds", 30),
            max_reprice_attempts=self.config["risk"].get("max_reprice_attempts", 3),
        )
        self.scheduler = TimeScheduler(logger=self.logger)
        self.strike_selector = StrikeSelector(self.broker, logger=self.logger)
        self.nse_reference = NSEReferenceUpdater(
            broker=self.broker,
            config=self.config.get("nse_reference", {}),
            logger=self.logger,
        )
        self.strategies = []
        self._shutdown_requested = False

    def build_strategies(self) -> None:
        strategies = self.config.get("strategies", {})
        if strategies.get("straddle", {}).get("enabled", True):
            self.strategies.append(
                StraddleStrategy(
                    name="straddle",
                    config=strategies["straddle"],
                    scheduler=self.scheduler,
                    strike_selector=self.strike_selector,
                    order_manager=self.order_manager,
                    position_tracker=self.position_tracker,
                    risk_manager=self.risk_manager,
                    notifier=self.notifier,
                    logger=self.logger,
                )
            )
        if strategies.get("strangle", {}).get("enabled", True):
            self.strategies.append(
                StrangleStrategy(
                    name="strangle",
                    config=strategies["strangle"],
                    scheduler=self.scheduler,
                    strike_selector=self.strike_selector,
                    order_manager=self.order_manager,
                    position_tracker=self.position_tracker,
                    risk_manager=self.risk_manager,
                    notifier=self.notifier,
                    logger=self.logger,
                )
            )

    def start(self) -> None:
        self.logger.info("app_starting")
        self.broker.authenticate()
        # Start proactive session health check every 5 minutes
        self.broker.start_health_check(interval_seconds=300)
        self._refresh_nse_reference(force=True)
        self.position_tracker.start()
        self.websocket.start()
        self.build_strategies()

        # --- Strategy Recovery & Subscription ---
        self.logger.info("waiting_for_sync_for_recovery")
        time.sleep(3) 
        
        for strategy in self.strategies:
            self._recover_strategy(strategy)
            tokens = strategy.prepare()
            if tokens:
                self.websocket.subscribe(tokens)

        while not self._shutdown_requested:
            try:
                self._tick()
                time.sleep(1)
            except KeyboardInterrupt:
                self.logger.warning("keyboard_interrupt")
                self.shutdown()
            except AlgoError as exc:
                self.logger.error("algo_error_in_main_loop", error=exc.code, message=str(exc), recoverable=exc.is_recoverable)
                self.notifier.send(f"⚠️ {exc.code}: {exc}")
                if not exc.is_recoverable:
                    self.logger.critical("non_recoverable_error_shutting_down")
                    self.shutdown(reason=f"unrecoverable_{exc.code.lower()}")
                else:
                    time.sleep(5)
            except Exception as exc:  # pragma: no cover - top level safety
                self.logger.exception("unexpected_main_loop_error", error=str(exc))
                self.notifier.send(f"🚨 Unexpected loop error: {exc}")
                time.sleep(5)

    def _recover_strategy(self, strategy: Any) -> None:
        """Attempt to re-attach strategy to existing broker positions."""
        is_recovered = False
        for symbol, leg in self.position_tracker.legs.items():
            if leg.get("status") == "OPEN":
                tag = str(leg.get("tag", "")).lower()
                if strategy.name.lower() in tag:
                    if leg not in strategy.legs:
                        strategy.legs.append(leg)
                    is_recovered = True
        
        if is_recovered:
            from kotak_algo.strategies.base_strategy import StrategyState
            strategy._state = StrategyState.IN_TRADE
            self.logger.info("strategy_recovered", strategy=strategy.name)
            self.notifier.send(f"🔄 {strategy.name} recovered from existing positions.")

    def _tick(self) -> None:
        self._refresh_nse_reference()

        if self.risk_manager.daily_loss_breached():
            self.logger.warning("daily_loss_breached")
            self.shutdown(reason="max_daily_loss_breached")
            return

        self.risk_manager.enforce_leg_stop_losses(self.order_manager)
        self.risk_manager.enforce_combined_stop_loss(self.order_manager)

        for strategy in self.strategies:
            if strategy.should_enter():
                strategy.execute()
            elif strategy.should_exit():
                strategy.square_off(reason="target_exit_time_reached")

        self._check_strategies_health()

    def _check_strategies_health(self) -> None:
        """Watchdog to ensure strategies aren't stuck in ENTERING or EXITING states."""
        for strategy in self.strategies:
            # We skip IDLE/DONE/IN_TRADE as those are stable states
            from kotak_algo.strategies.base_strategy import StrategyState
            if strategy.state in (StrategyState.ENTERING, StrategyState.EXITING):
                # Log a warning if a strategy is stuck in a transition
                self.logger.warning("strategy_in_transition", strategy=strategy.name, state=strategy.state.value)

        if self.scheduler.is_hard_exit_due():
            self.shutdown(reason="hard_exit_time")

    def _refresh_nse_reference(self, force: bool = False) -> None:
        if not self.config.get("nse_reference", {}).get("enabled", True):
            return
        if not force and not self.nse_reference.should_refresh():
            return
        try:
            metadata_path = self.nse_reference.refresh()
            self.logger.info("nse_reference_metadata_ready", path=str(metadata_path))
        except Exception as exc:
            self.logger.exception("nse_reference_refresh_failed", error=str(exc))
            self.notifier.send(f"NSE reference refresh failed: {exc}")

    def shutdown(self, reason: str = "manual_shutdown") -> None:
        if self._shutdown_requested:
            return

        self._shutdown_requested = True
        self.logger.info("shutdown_started", reason=reason)
        self.notifier.send(f"Shutdown initiated: {reason}")

        for strategy in self.strategies:
            strategy.cancel_pending()
            strategy.square_off(reason)

        self.order_manager.cancel_all_pending()
        self.position_tracker.save_snapshot()
        self.position_tracker.stop()
        self.websocket.stop()
        self.broker.stop_health_check()
        self.logger.info("shutdown_completed", reason=reason)


def _install_signal_handlers(app: AlgoApp) -> None:
    def _handler(signum, _frame) -> None:
        LOGGER.info("signal_received", signal=signum)
        app.shutdown(reason=f"signal_{signum}")

    signal.signal(signal.SIGINT, _handler)
    signal.signal(signal.SIGTERM, _handler)


def main() -> int:
    config_path = Path(__file__).with_name("config.yaml")
    app = AlgoApp(config_path)
    _install_signal_handlers(app)
    app.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
