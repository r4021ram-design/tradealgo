from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml


ENV_PATTERN = re.compile(r"^\$\{([A-Z0-9_]+)(:-([^}]*))?\}$")


def load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def load_config(config_path: Path) -> dict[str, Any]:
    load_dotenv(config_path.with_name(".env"))
    with config_path.open("r", encoding="utf-8") as handle:
        config = yaml.safe_load(handle)
    return _resolve_node(config)


def validate_config(config: dict[str, Any]) -> None:
    broker = config.get("broker", {})
    required = [
        "consumer_key",
        "mobile_number",
        "ucc",
        "mpin",
        "totp_secret",
    ]
    missing = [field for field in required if not str(broker.get(field, "")).strip()]
    if missing:
        raise ValueError(
            "Missing broker secrets: "
            + ", ".join(missing)
            + ". Set them in kotak_algo/.env or OS environment variables."
        )


def _resolve_node(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _resolve_node(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_resolve_node(item) for item in value]
    if isinstance(value, str):
        return _resolve_string(value)
    return value


def _resolve_string(value: str) -> str:
    match = ENV_PATTERN.match(value.strip())
    if not match:
        return value

    env_name = match.group(1)
    default = match.group(3) or ""
    return os.getenv(env_name, default)

