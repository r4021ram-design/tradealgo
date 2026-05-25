from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

from kotak_algo.exceptions import (
    AuthenticationError,
    SessionExpiredError,
    looks_like_session_expired,
)
from kotak_algo.utils.api_validator import check_session, validate_order_response
from kotak_algo.utils.logger import get_logger
from kotak_algo.utils.retry import CircuitBreaker, retry
from kotak_algo.utils.totp_helper import generate_totp
from kotak_algo.events import event_bus, Event, EventNames

try:
    from neo_api_client import NeoAPI
except ImportError:  # pragma: no cover - depends on external SDK
    NeoAPI = None  # type: ignore[assignment]


class NeoBrokerClient:
    """
    Hardened wrapper around the Kotak Neo SDK.

    Features:
      - Auto re-authenticate on SessionExpiredError (max 1 attempt)
      - Retry with backoff on transient errors
      - Circuit breaker to prevent hammering a dead API
      - Response validation on every call
    """

    def __init__(self, config: dict[str, Any], logger=None) -> None:
        self.config = config
        self.logger = (logger or get_logger("neo_client")).bind(component="neo_client")
        self._client = None
        self._master_cache: dict[str, Path] = {}
        self._auth_lock = threading.Lock()
        self._reauth_listeners = []
        self._circuit = CircuitBreaker(name="kotak_api", failure_threshold=5, timeout=30.0)
        self._health_thread = None
        self._should_check_health = False

    def register_reauth_listener(self, callback: Any) -> None:
        if callback not in self._reauth_listeners:
            self._reauth_listeners.append(callback)

    def start_health_check(self, interval_seconds: int = 300) -> None:
        """Start a background thread to check session health proactively."""
        self._should_check_health = True
        self._health_thread = threading.Thread(
            target=self._health_check_loop,
            args=(interval_seconds,),
            daemon=True
        )
        self._health_thread.start()
        self.logger.info("proactive_health_check_started", interval=interval_seconds)

    def _health_check_loop(self, interval: int) -> None:
        while self._should_check_health:
            time.sleep(interval)
            try:
                if not self.is_session_alive():
                    self.logger.warning("proactive_health_check_failed_re_authenticating")
                    self._re_authenticate()
                else:
                    self.logger.debug("proactive_health_check_passed")
            except Exception as e:
                self.logger.error("proactive_health_check_error", error=str(e))

    def stop_health_check(self) -> None:
        self._should_check_health = False
        if self._health_thread:
            self._health_thread.join(timeout=1)

    @property
    def client(self):
        if self._client is None:
            raise RuntimeError("Neo client not authenticated")
        return self._client

    @property
    def circuit_breaker(self) -> CircuitBreaker:
        return self._circuit

    # ── Authentication ───────────────────────────────────────────

    def authenticate(self) -> None:
        if NeoAPI is None:
            raise ImportError(
                "neo_api_client is not installed. Install v2.0.1 with "
                "pip install --force-reinstall "
                "\"git+https://github.com/Kotak-Neo/Kotak-neo-api-v2.git@v2.0.1#egg=neo_api_client\""
            )

        with self._auth_lock:
            # Double-check: was session refreshed by another thread while we waited?
            if self._client is not None:
                try:
                    if self.is_session_alive():
                        self.logger.info("session_already_refreshed_by_other_thread")
                        return
                except Exception:
                    pass

            try:
                self._client = NeoAPI(
                    environment=self.config.get("environment", "prod"),
                    access_token=None,
                    neo_fin_key=None,
                    consumer_key=self.config["consumer_key"],
                )
                
                # Handle TOTP secret cleaning and padding
                secret = self.config["totp_secret"].replace(" ", "").upper()
                # Ensure secret is properly padded for base32
                missing_padding = len(secret) % 8
                if missing_padding:
                    secret += "=" * (8 - missing_padding)
                
                totp = generate_totp(secret)
                self.logger.info("totp_login_started")
                self.client.totp_login(
                    mobile_number=self.config["mobile_number"],
                    ucc=self.config["ucc"],
                    totp=totp,
                )
                self.client.totp_validate(mpin=self.config["mpin"])
                self._circuit.reset()
                self.logger.info("authentication_completed")
            except Exception as exc:
                self.logger.error("authentication_failed", error=str(exc))
                raise AuthenticationError(
                    f"Broker authentication failed: {exc}",
                    details={"error": str(exc)},
                ) from exc

    def _re_authenticate(self) -> None:
        """Called when a session expiry is detected mid-session."""
        # Check if another thread is already re-authenticating
        if self._auth_lock.locked():
            self.logger.info("waiting_for_concurrent_re_authentication")
            with self._auth_lock:
                return # Just wait and return, next call will use new session

        self.logger.warning("session_expired_re_authenticating")
        event_bus.publish(Event(EventNames.SESSION_EXPIRED))
        try:
            self.authenticate()
            event_bus.publish(Event(EventNames.SESSION_REAUTH_SUCCESS))
            # Notify listeners (e.g. WebSocket feed) to refresh their client reference
            for listener in self._reauth_listeners:
                try:
                    listener(self.client)
                except Exception as e:
                    self.logger.error("reauth_listener_error", error=str(e))
        except Exception as exc:
            event_bus.publish(Event(EventNames.SESSION_REAUTH_FAILED, {"error": str(exc)}))
            raise

    def is_session_alive(self) -> bool:
        """Quick health check — try a lightweight API call."""
        try:
            resp = self.client.limits()
            return not looks_like_session_expired(resp)
        except Exception:
            return False

    # ── Protected call wrapper ───────────────────────────────────

    def _call(self, func_name: str, func, *args, **kwargs) -> Any:
        """
        Central wrapper for all broker API calls.

        1. Route through circuit breaker
        2. Detect session expiry → re-auth → retry once
        3. Validate response
        """
        def _invoke():
            return func(*args, **kwargs)

        try:
            response = self._circuit.call(_invoke)
        except RuntimeError:
            raise  # Circuit is OPEN — let it propagate
        except Exception as exc:
            if looks_like_session_expired(exc) or looks_like_session_expired(str(exc)):
                self._re_authenticate()
                # Retry the call once after re-auth
                response = self._circuit.call(_invoke)
            else:
                raise

        # Post-call session check
        if looks_like_session_expired(response):
            self._re_authenticate()
            response = self._circuit.call(_invoke)

        return response

    # ── Scrip Master ─────────────────────────────────────────────

    def scrip_master_path(self, exchange_segment: str) -> Path:
        if exchange_segment in self._master_cache:
            return self._master_cache[exchange_segment]

        raw_response = self._call(
            "scrip_master",
            self.client.scrip_master,
            exchange_segment=exchange_segment,
        )
        path = self._extract_path(raw_response)
        self._master_cache[exchange_segment] = path
        self.logger.info("scrip_master_cached", exchange_segment=exchange_segment, path=str(path))
        return path

    def _extract_path(self, raw_response: Any) -> Path:
        raw_path = None
        if isinstance(raw_response, str):
            raw_path = raw_response

        elif isinstance(raw_response, dict):
            for key in ("file_path", "path", "data", "message"):
                value = raw_response.get(key)
                if isinstance(value, str) and value.lower().endswith(".csv"):
                    raw_path = value
                    break

        elif isinstance(raw_response, list):
            for item in raw_response:
                if isinstance(item, str) and item.lower().endswith(".csv"):
                    raw_path = item
                    break
                if isinstance(item, dict):
                    for value in item.values():
                        if isinstance(value, str) and value.lower().endswith(".csv"):
                            raw_path = value
                            break
                    if raw_path:
                        break

        if not raw_path:
            raise ValueError(f"Could not parse scrip master response: {raw_response!r}")

        # Check if the extracted path is actually a URL
        if raw_path.startswith("http://") or raw_path.startswith("https://"):
            try:
                import requests
                self.logger.info("downloading_remote_scrip_master", url=raw_path)
                
                # Make local folder for downloaded scrip master files
                local_dir = Path("data/scrip_master")
                local_dir.mkdir(parents=True, exist_ok=True)
                
                # Extract filename from URL
                filename = raw_path.split("/")[-1]
                if not filename.endswith(".csv"):
                    filename = "scrip_master.csv"
                    
                local_path = local_dir / filename
                response = requests.get(raw_path, timeout=60)
                response.raise_for_status()
                local_path.write_bytes(response.content)
                self.logger.info("downloaded_remote_scrip_master_success", local_path=str(local_path))
                return local_path.resolve()
            except Exception as e:
                self.logger.error("failed_to_download_remote_scrip_master", url=raw_path, error=str(e))
                raise ValueError(f"Failed to download remote scrip master from URL {raw_path}: {e}") from e

        return Path(raw_path).expanduser().resolve()

    # ── Order Operations ─────────────────────────────────────────

    def place_order(self, **kwargs) -> Any:
        return self._call("place_order", self.client.place_order, **kwargs)

    def modify_order(self, **kwargs) -> Any:
        return self._call("modify_order", self.client.modify_order, **kwargs)

    def cancel_order(self, **kwargs) -> Any:
        return self._call("cancel_order", self.client.cancel_order, **kwargs)

    # ── Data Operations ──────────────────────────────────────────

    def positions(self) -> Any:
        return self._call("positions", self.client.positions)

    def order_report(self) -> Any:
        return self._call("order_report", self.client.order_report)

    def order_history(self, order_id: str) -> Any:
        return self._call("order_history", self.client.order_history, order_id=order_id)

    def trade_report(self) -> Any:
        return self._call("trade_report", self.client.trade_report)

    def holdings(self) -> Any:
        return self._call("holdings", self.client.holdings)

    def limits(self) -> Any:
        return self._call("limits", self.client.limits)

    def quotes(self, instrument_tokens: list[dict], quote_type: str = "", is_index: bool = False) -> Any:
        return self._call(
            "quotes",
            self.client.quotes,
            instrument_tokens=instrument_tokens,
            quote_type=quote_type,
            isIndex=is_index,
        )

    def search_scrip(self, exchange_segment: str, symbol: str = "", expiry: str = "", option_type: str = "", strike_price: str = "") -> Any:
        return self._call(
            "search_scrip",
            self.client.search_scrip,
            exchange_segment=exchange_segment,
            symbol=symbol,
            expiry=expiry,
            option_type=option_type,
            strike_price=strike_price,
        )
