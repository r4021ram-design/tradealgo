from __future__ import annotations

import csv
from datetime import datetime
from typing import Any

from kotak_algo.utils.logger import get_logger


class StrikeSelector:
    def __init__(self, broker, position_tracker=None, logger=None) -> None:
        self.broker = broker
        self.position_tracker = position_tracker
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

    def select_iron_condor(
        self,
        underlying: str,
        exchange_segment: str,
        strike_gap: int,
        strangle_gap: int,
        condor_gap: int,
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
        short_ce_strike = selection["atm"] + strangle_gap
        long_ce_strike = short_ce_strike + condor_gap
        short_pe_strike = selection["atm"] - strangle_gap
        long_pe_strike = short_pe_strike - condor_gap
        
        short_ce = self._match_option(rows, underlying, expiry, short_ce_strike, "CE", instrument_type)
        long_ce = self._match_option(rows, underlying, expiry, long_ce_strike, "CE", instrument_type)
        short_pe = self._match_option(rows, underlying, expiry, short_pe_strike, "PE", instrument_type)
        long_pe = self._match_option(rows, underlying, expiry, long_pe_strike, "PE", instrument_type)
        
        return {
            "spot": selection["spot"],
            "atm": selection["atm"],
            "short_ce": short_ce,
            "long_ce": long_ce,
            "short_pe": short_pe,
            "long_pe": long_pe,
        }

    def spot_price(self, underlying: str, exchange_segment: str, instrument_type: str | None = None) -> float:
        # 1. Check PositionTracker cache first
        if self.position_tracker:
            cached_ltp = self.position_tracker.ltp(underlying)
            if cached_ltp > 0:
                self.logger.info("spot_price_resolved_from_tracker_cache", underlying=underlying, ltp=cached_ltp)
                return cached_ltp
            
            # If not in active memory, check LKV store inside position_tracker
            if hasattr(self.position_tracker, "lkv_store") and self.position_tracker.lkv_store:
                lkv_entry = self.position_tracker.lkv_store.get_full(underlying)
                lkv_ltp = lkv_entry.get("ltp", 0.0)
                if lkv_ltp > 0:
                    self.logger.info("spot_price_resolved_from_tracker_lkv", underlying=underlying, ltp=lkv_ltp)
                    return lkv_ltp

        # 2. Check default fallback values for indices
        underlying_upper = underlying.upper()
        if underlying_upper == "NIFTY":
            return 23161.60
        elif underlying_upper == "BANKNIFTY":
            return 55176.75
        elif underlying_upper == "SENSEX":
            return 73832.55
        elif underlying_upper == "BANKEX":
            return 54000.00
        elif underlying_upper in ("INDIA VIX", "INDIAVIX"):
            return 15.61

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
            raw_rows = list(csv.DictReader(handle))
            
        normalized_rows = []
        for row in raw_rows:
            # 1. Underlying Symbol Name
            underlying = row.get("pSymbolName") or row.get("symbol")
            if not underlying or underlying.isdigit():
                underlying = row.get("pSymbol")
                if underlying and underlying.isdigit():
                    underlying = ""
            if not underlying:
                continue
                
            # 2. Expiry Date
            expiry = row.get("pExpDt")
            if not expiry:
                raw_exp = row.get("pExpiryDate") or row.get("lExpiryDate ")
                if raw_exp and raw_exp.isdigit():
                    try:
                        val = int(raw_exp) + 315532800
                        dt = datetime.utcfromtimestamp(val)
                        expiry = dt.strftime("%d-%b-%Y")
                    except Exception:
                        pass
                else:
                    expiry = raw_exp or ""
                    
            # 3. Strike Price
            strike = row.get("pStrkPrc")
            if not strike:
                raw_strike = row.get("dStrikePrice;") or row.get("dStrikePrice")
                if raw_strike:
                    try:
                        f_strike = float(raw_strike)
                        if f_strike > 10000:
                            strike = str(f_strike / 100.0)
                        else:
                            strike = str(f_strike)
                    except Exception:
                        strike = raw_strike
                else:
                    strike = "0.0"
                    
            # 4. Token
            token = row.get("token")
            if not token:
                token = row.get("pSymbol") or ""
                
            # 5. Option Type
            opt_type = row.get("pOptTp") or row.get("pOptionType") or ""
            
            # 6. Lot Size
            lot_size = row.get("lotSize") or row.get("lLotSize") or row.get("iLotSize") or ""

            norm_row = {
                "pSymbol": underlying,
                "pInstType": row.get("pInstType") or row.get("pInstName") or "",
                "pExchSeg": row.get("pExchSeg") or row.get("pExchange") or "",
                "pExpDt": expiry,
                "lotSize": lot_size,
                "pTrdSymbol": row.get("pTrdSymbol") or "",
                "token": token,
                "pOptTp": opt_type,
                "pStrkPrc": strike,
            }
            normalized_rows.append(norm_row)
            
        self._rows_cache[exchange_segment] = normalized_rows
        self.logger.info("master_rows_loaded", exchange_segment=exchange_segment, row_count=len(normalized_rows), path=str(path))
        return normalized_rows

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

