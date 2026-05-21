from __future__ import annotations

import csv
from datetime import datetime
from typing import Any

from kotak_algo.utils.logger import get_logger


class StrikeSelector:
    def __init__(self, broker, logger=None) -> None:
        self.broker = broker
        self.logger = (logger or get_logger("strike_selector")).bind(component="strike_selector")
        self._rows_cache: dict[str, list[dict[str, str]]] = {}

    def select_straddle(
        self,
        underlying: str,
        exchange_segment: str,
        strike_gap: int,
        instrument_type: str | None = None,
    ) -> dict[str, dict[str, Any]]:
        spot = self.spot_price(underlying, exchange_segment, instrument_type)
        atm = round(spot / strike_gap) * strike_gap
        rows = self._load_rows(exchange_segment)
        expiry = self._nearest_expiry(rows, underlying, instrument_type)
        ce = self._match_option(rows, underlying, expiry, atm, "CE", instrument_type)
        pe = self._match_option(rows, underlying, expiry, atm, "PE", instrument_type)
        return {"spot": spot, "atm": atm, "ce": ce, "pe": pe}

    def select_strangle(
        self,
        underlying: str,
        exchange_segment: str,
        strike_gap: int,
        strangle_gap: int,
        instrument_type: str | None = None,
    ) -> dict[str, dict[str, Any]]:
        selection = self.select_straddle(
            underlying=underlying,
            exchange_segment=exchange_segment,
            strike_gap=strike_gap,
            instrument_type=instrument_type,
        )
        rows = self._load_rows(exchange_segment)
        expiry = self._nearest_expiry(rows, underlying, instrument_type)
        ce_strike = selection["atm"] + strangle_gap
        pe_strike = selection["atm"] - strangle_gap
        ce = self._match_option(rows, underlying, expiry, ce_strike, "CE", instrument_type)
        pe = self._match_option(rows, underlying, expiry, pe_strike, "PE", instrument_type)
        return {"spot": selection["spot"], "atm": selection["atm"], "ce": ce, "pe": pe}

    def spot_price(self, underlying: str, exchange_segment: str, instrument_type: str | None = None) -> float:
        rows = self._load_rows(exchange_segment)
        futures_rows = [
            row for row in rows
            if self._get(row, "pSymbol") == underlying
            and (not instrument_type or self._get(row, "pInstType") in {instrument_type, "FUTIDX", "FUTSTK"})
            and self._as_float(self._get(row, "ltp", "0")) > 0
        ]
        if futures_rows:
            return self._as_float(self._get(futures_rows[0], "ltp", "0"))

        option_rows = [
            row for row in rows
            if self._get(row, "pSymbol") == underlying
            and self._get(row, "pOptTp") in {"CE", "PE"}
        ]
        if not option_rows:
            raise ValueError(f"No rows found for underlying={underlying}")
        strikes = sorted({self._as_float(self._get(row, "pStrkPrc", "0")) for row in option_rows})
        return strikes[len(strikes) // 2]

    def _load_rows(self, exchange_segment: str) -> list[dict[str, str]]:
        if exchange_segment in self._rows_cache:
            return self._rows_cache[exchange_segment]
        path = self.broker.scrip_master_path(exchange_segment)
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self._rows_cache[exchange_segment] = rows
        self.logger.info("master_rows_loaded", exchange_segment=exchange_segment, row_count=len(rows), path=str(path))
        return rows

    def _nearest_expiry(self, rows: list[dict[str, str]], underlying: str, instrument_type: str | None) -> str:
        expiries = []
        for row in rows:
            if self._get(row, "pSymbol") != underlying:
                continue
            if instrument_type and self._get(row, "pInstType") not in {instrument_type, "OPTIDX", "OPTSTK"}:
                continue
            expiry = self._get(row, "pExpDt")
            if expiry:
                expiries.append(expiry)
        if not expiries:
            raise ValueError(f"No expiry found for {underlying}")

        def _parse(value: str) -> datetime:
            for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y"):
                try:
                    return datetime.strptime(value, fmt)
                except ValueError:
                    continue
            raise ValueError(f"Unsupported expiry format: {value}")

        nearest = min(expiries, key=_parse)
        return nearest

    def _match_option(
        self,
        rows: list[dict[str, str]],
        underlying: str,
        expiry: str,
        strike: int | float,
        opt_type: str,
        instrument_type: str | None,
    ) -> dict[str, Any]:
        for row in rows:
            if self._get(row, "pSymbol") != underlying:
                continue
            if self._get(row, "pExpDt") != expiry:
                continue
            if self._get(row, "pOptTp") != opt_type:
                continue
            if instrument_type and self._get(row, "pInstType") not in {instrument_type, "OPTIDX", "OPTSTK"}:
                continue
            strike_price = self._as_float(self._get(row, "pStrkPrc", "0"))
            if strike_price == float(strike):
                return {
                    "trading_symbol": self._get(row, "pTrdSymbol"),
                    "instrument_token": self._get(row, "token"),
                    "strike": strike_price,
                    "expiry": expiry,
                    "option_type": opt_type,
                }
        raise ValueError(f"No option match for {underlying} {expiry} {strike} {opt_type}")

    @staticmethod
    def _get(row: dict[str, str], key: str, default: str = "") -> str:
        return (row.get(key) or default).strip()

    @staticmethod
    def _as_float(value: str) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

