from pathlib import Path
from typing import Any

from punq import Container

from kotak_algo.broker.neo_client import NeoBrokerClient
from kotak_algo.broker.order_manager import OrderManager
from kotak_algo.broker.websocket_feed import WebSocketFeed
from kotak_algo.core.nse_reference import NSEReferenceUpdater
from kotak_algo.core.position_tracker import PositionTracker
from kotak_algo.core.risk_manager import RiskManager
from kotak_algo.core.scheduler import TimeScheduler
from kotak_algo.core.strike_selector import StrikeSelector
from kotak_algo.utils.config_loader import load_config
from kotak_algo.utils.logger import get_logger
from kotak_algo.utils.telegram_notifier import TelegramNotifier


def create_container(config_path: Path) -> Container:
    container = Container()

    config = load_config(config_path)
    logger = get_logger("container").bind(component="container")

    container.register(config, instance=config)
    container.register(logger, instance=logger)

    notifier = TelegramNotifier(config["broker"].get("telegram", {}))
    container.register(TelegramNotifier, instance=notifier)

    broker = NeoBrokerClient(config["broker"], logger=logger)
    container.register(NeoBrokerClient, instance=broker)

    position_tracker = PositionTracker(
        client_provider=broker,
        poll_interval=config["risk"].get("position_poll_interval_seconds", 5),
        logger=logger,
    )
    container.register(PositionTracker, instance=position_tracker)

    websocket = WebSocketFeed(
        broker=broker,
        position_tracker=position_tracker,
        logger=logger,
    )
    container.register(WebSocketFeed, instance=websocket)

    risk_manager = RiskManager(
        risk_config=config["risk"],
        position_tracker=position_tracker,
        notifier=notifier,
        logger=logger,
    )
    container.register(RiskManager, instance=risk_manager)

    order_manager = OrderManager(
        broker=broker,
        position_tracker=position_tracker,
        risk_manager=risk_manager,
        notifier=notifier,
        logger=logger,
        paper_trade=config["risk"].get("paper_trade", True),
        reprice_interval=config["risk"].get("reprice_interval_seconds", 30),
        max_reprice_attempts=config["risk"].get("max_reprice_attempts", 3),
    )
    container.register(OrderManager, instance=order_manager)

    scheduler = TimeScheduler(logger=logger)
    container.register(TimeScheduler, instance=scheduler)

    strike_selector = StrikeSelector(broker, position_tracker=position_tracker, logger=logger)
    container.register(StrikeSelector, instance=strike_selector)

    nse_reference = NSEReferenceUpdater(
        broker=broker,
        config=config.get("nse_reference", {}),
        logger=logger,
    )
    container.register(NSEReferenceUpdater, instance=nse_reference)

    return container


def get_from_container(container: Container, klass: type) -> Any:
    return container.resolve(klass)