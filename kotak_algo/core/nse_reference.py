from __future__ import annotations

import csv
import gzip
import json
import shutil
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from kotak_algo.utils.logger import get_logger


class NSEReferenceUpdater:
    def __init__(self, broker, config: dict[str, Any], logger=None) -> None:
        self.broker = broker
        self.config = config
        self.logger = (logger or get_logger("nse_reference")).bind(component="nse_reference")
        archive_dir = config.get("archive_dir", "data/nse")
        self.archive_dir = Path(__file__).resolve().parents[1] / archive_dir
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        self.urls = config.get("urls", {})
        self._last_refresh_date: str | None = None

    def should_refresh(self, now: datetime | None = None) -> bool:
        if not self.config.get("enabled", True):
            return False
        now = now or datetime.now()
        refresh_time = self.config.get("refresh_time", "08:45")
        if now.strftime("%Y-%m-%d") == self._last_refresh_date:
            return False
        return now.strftime("%H:%M") >= refresh_time

    def refresh(self) -> Path:
        today_dir = self.archive_dir / datetime.now().strftime("%Y%m%d")
        today_dir.mkdir(parents=True, exist_ok=True)
        downloaded_files: dict[str, Path] = {}

        for name, url in self.urls.items():
            destination = today_dir / Path(url).name
            self._download(url, destination)
            downloaded_files[name] = destination

        metadata = self._build_metadata(downloaded_files)
        metadata_path = today_dir / "metadata.json"
        metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

        latest_path = self.archive_dir / "metadata-latest.json"
        latest_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        self._last_refresh_date = datetime.now().strftime("%Y-%m-%d")
        self.logger.info("nse_reference_refreshed", metadata_path=str(metadata_path), latest_path=str(latest_path))
        return metadata_path

    def _download(self, url: str, destination: Path) -> None:
        self.logger.info("nse_reference_download_started", url=url, destination=str(destination))
        request = Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "*/*",
            },
        )
        with urlopen(request, timeout=30) as response, destination.open("wb") as handle:
            shutil.copyfileobj(response, handle)
        self.logger.info("nse_reference_download_completed", url=url, destination=str(destination))

    def _build_metadata(self, downloaded_files: dict[str, Path]) -> dict[str, Any]:
        equity_rows = self._read_csv(downloaded_files["equity_securities"])
        lot_rows = self._read_csv(downloaded_files["fo_lot_size"])
        qty_freeze_rows = self._read_csv(downloaded_files["fo_qty_freeze"])
        symbol_change_rows = self._read_csv(downloaded_files["symbol_changes"])
        company_change_rows = self._read_csv(downloaded_files["company_name_changes"])
        kotak_rows = self._load_kotak_master("nse_fo")

        lot_by_symbol = self._index_by_symbol(lot_rows)
        qty_freeze_by_symbol = self._index_by_symbol(qty_freeze_rows)
        equity_by_symbol = self._index_by_symbol(equity_rows)
        symbol_changes = self._index_change_rows(symbol_change_rows)
        company_changes = self._index_change_rows(company_change_rows)

        derivatives = self._build_derivatives_metadata(
            kotak_rows=kotak_rows,
            lot_by_symbol=lot_by_symbol,
            qty_freeze_by_symbol=qty_freeze_by_symbol,
            equity_by_symbol=equity_by_symbol,
            symbol_changes=symbol_changes,
            company_changes=company_changes,
        )
        equities = self._build_equities_metadata(
            equity_by_symbol=equity_by_symbol,
            symbol_changes=symbol_changes,
            company_changes=company_changes,
        )

        return {
            "generated_at": datetime.now().isoformat(),
            "source_files": {name: str(path) for name, path in downloaded_files.items()},
            "derivatives_underlyings": derivatives,
            "equities": equities,
        }

    def _build_derivatives_metadata(
        self,
        kotak_rows: list[dict[str, str]],
        lot_by_symbol: dict[str, dict[str, str]],
        qty_freeze_by_symbol: dict[str, dict[str, str]],
        equity_by_symbol: dict[str, dict[str, str]],
        symbol_changes: dict[str, list[dict[str, str]]],
        company_changes: dict[str, list[dict[str, str]]],
    ) -> dict[str, Any]:
        grouped: dict[str, dict[str, Any]] = {}

        for row in kotak_rows:
            underlying = self._first_non_empty(row, ["pSymbol", "symbol"])
            if not underlying:
                continue

            instrument_type = self._first_non_empty(row, ["pInstType"])
            if instrument_type not in {"OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"}:
                continue

            entry = grouped.setdefault(
                underlying,
                {
                    "underlying": underlying,
                    "instrument_types": set(),
                    "contract_size": None,
                    "quantity_freeze": None,
                    "exchange_segment": self._first_non_empty(row, ["pExchSeg"]),
                    "security_name": "",
                    "series": "",
                    "expiries": set(),
                    "contracts": [],
                    "symbol_changes": symbol_changes.get(underlying, []),
                    "company_name_changes": company_changes.get(underlying, []),
                },
            )

            entry["instrument_types"].add(instrument_type)
            expiry = self._first_non_empty(row, ["pExpDt"])
            if expiry:
                entry["expiries"].add(expiry)

            equity_row = equity_by_symbol.get(underlying, {})
            if not entry["security_name"]:
                entry["security_name"] = self._first_non_empty(equity_row, ["NAME OF COMPANY", "Security Name", "security_name"])
            if not entry["series"]:
                entry["series"] = self._first_non_empty(equity_row, [" SERIES", "Series", "series"])

            lot_row = lot_by_symbol.get(underlying, {})
            if entry["contract_size"] is None:
                entry["contract_size"] = self._extract_numeric_field(
                    lot_row,
                    candidates=["LOT_SIZE", "MARKET LOT", "LOT SIZE", "Lotsize", "lot_size"],
                    fallback=self._first_non_empty(row, ["lotSize"]),
                )

            qty_row = qty_freeze_by_symbol.get(underlying, {})
            if entry["quantity_freeze"] is None:
                entry["quantity_freeze"] = self._extract_numeric_field(
                    qty_row,
                    candidates=["QUANTITY FREEZE", "FREEZE_QTY", "quantity_freeze"],
                )

            contract = {
                "trading_symbol": self._first_non_empty(row, ["pTrdSymbol"]),
                "token": self._first_non_empty(row, ["token"]),
                "instrument_type": instrument_type,
                "expiry": expiry,
                "option_type": self._first_non_empty(row, ["pOptTp"]),
                "strike_price": self._to_float(self._first_non_empty(row, ["pStrkPrc"])),
                "contract_size": self._extract_numeric_field(
                    lot_row,
                    candidates=["LOT_SIZE", "MARKET LOT", "LOT SIZE", "Lotsize", "lot_size"],
                    fallback=self._first_non_empty(row, ["lotSize"]),
                ),
            }
            entry["contracts"].append(contract)

        normalized: dict[str, Any] = {}
        for symbol, entry in grouped.items():
            normalized[symbol] = {
                "underlying": entry["underlying"],
                "instrument_types": sorted(entry["instrument_types"]),
                "contract_size": entry["contract_size"],
                "quantity_freeze": entry["quantity_freeze"],
                "exchange_segment": entry["exchange_segment"],
                "security_name": entry["security_name"],
                "series": entry["series"],
                "expiries": sorted(entry["expiries"], key=self._sort_expiry),
                "contracts": sorted(
                    entry["contracts"],
                    key=lambda item: (
                        self._sort_expiry(item.get("expiry", "")),
                        item.get("instrument_type") or "",
                        item.get("option_type") or "",
                        float(item.get("strike_price") or 0.0),
                    ),
                ),
                "symbol_changes": entry["symbol_changes"],
                "company_name_changes": entry["company_name_changes"],
            }
        return normalized

    def _build_equities_metadata(
        self,
        equity_by_symbol: dict[str, dict[str, str]],
        symbol_changes: dict[str, list[dict[str, str]]],
        company_changes: dict[str, list[dict[str, str]]],
    ) -> dict[str, Any]:
        equities: dict[str, Any] = {}
        for symbol, row in equity_by_symbol.items():
            equities[symbol] = {
                "symbol": symbol,
                "isin": self._first_non_empty(row, [" ISIN NUMBER", "ISIN NUMBER", "ISIN"]),
                "security_name": self._first_non_empty(row, ["NAME OF COMPANY", "Security Name"]),
                "series": self._first_non_empty(row, [" SERIES", "Series"]),
                "face_value": self._first_non_empty(row, [" FACE VALUE", "Face Value"]),
                "date_of_listing": self._first_non_empty(row, [" DATE OF LISTING", "Date of Listing"]),
                "paid_up_value": self._first_non_empty(row, [" PAID UP VALUE", "Paid Up Value"]),
                "market_lot": self._first_non_empty(row, [" MARKET LOT", "Market Lot"]),
                "symbol_changes": symbol_changes.get(symbol, []),
                "company_name_changes": company_changes.get(symbol, []),
            }
        return equities

    def _load_kotak_master(self, exchange_segment: str) -> list[dict[str, str]]:
        path = self.broker.scrip_master_path(exchange_segment)
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return list(csv.DictReader(handle))

    @staticmethod
    def _read_csv(path: Path) -> list[dict[str, str]]:
        opener = gzip.open if path.suffix == ".gz" else open
        with opener(path, "rt", encoding="utf-8-sig", newline="") as handle:
            return list(csv.DictReader(handle))

    def _index_by_symbol(self, rows: list[dict[str, str]]) -> dict[str, dict[str, str]]:
        indexed: dict[str, dict[str, str]] = {}
        for row in rows:
            symbol = self._discover_symbol(row)
            if symbol:
                indexed[symbol] = row
        return indexed

    def _index_change_rows(self, rows: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
        indexed: dict[str, list[dict[str, str]]] = defaultdict(list)
        for row in rows:
            for candidate in (
                self._first_non_empty(row, ["SYMBOL"]),
                self._first_non_empty(row, ["NEW_SYMBOL"]),
                self._first_non_empty(row, ["OLD_SYMBOL"]),
            ):
                if candidate:
                    indexed[candidate].append(row)
        return indexed

    def _discover_symbol(self, row: dict[str, str]) -> str:
        for key in (
            "SYMBOL",
            " SYMBOL",
            "Symbol",
            "symbol",
            "UNDERLYING",
            "Underlying",
            "Name",
        ):
            value = row.get(key)
            if value and value.strip():
                return value.strip()
        return ""

    @staticmethod
    def _first_non_empty(row: dict[str, str], keys: list[str]) -> str:
        for key in keys:
            value = row.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return ""

    def _extract_numeric_field(self, row: dict[str, str], candidates: list[str], fallback: str = "") -> int | None:
        for key in candidates:
            value = row.get(key)
            number = self._to_int(value)
            if number is not None:
                return number
        return self._to_int(fallback)

    @staticmethod
    def _to_int(value: Any) -> int | None:
        if value is None:
            return None
        text = str(value).replace(",", "").strip()
        if not text:
            return None
        try:
            return int(float(text))
        except ValueError:
            return None

    @staticmethod
    def _to_float(value: Any) -> float | None:
        if value is None:
            return None
        text = str(value).replace(",", "").strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None

    @staticmethod
    def _sort_expiry(value: str) -> tuple[int, str]:
        if not value:
            return (99999999, value)
        for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y"):
            try:
                parsed = datetime.strptime(value, fmt)
                return (int(parsed.strftime("%Y%m%d")), value)
            except ValueError:
                continue
        return (99999999, value)
