from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path
from typing import Any

from kotak_algo.utils.logger import get_logger


class OptionChainService:
    def __init__(self, broker, logger=None) -> None:
        self.broker = broker
        self.logger = (logger or get_logger("option_chain")).bind(component="option_chain")
        self._rows_cache: dict[str, list[dict[str, str]]] = {}
        self._previous_oi: dict[str, float] = {}
        self._spot_cache: dict[str, float] = {}

    def get_option_chain(
        self,
        underlying: str,
        exchange_segment: str = "nse_fo",
        expiry: str | None = None,
        strike_range: int = 20,
    ) -> dict[str, Any]:
        rows = self._load_rows(exchange_segment)
        
        if not expiry:
            expiry = self._nearest_expiry(rows, underlying)
        
        spot = self._get_spot(rows, underlying)
        self._spot_cache[underlying] = spot
        
        atm_strike = round(spot / 50) * 50
        
        ce_options = []
        pe_options = []
        
        for row in rows:
            if self._get(row, "pSymbol") != underlying:
                continue
            if self._get(row, "pExpDt") != expiry:
                continue
            if self._get(row, "pInstType") not in {"OPTIDX", "OPTSTK"}:
                continue
            
            opt_type = self._get(row, "pOptTp")
            if opt_type not in {"CE", "PE"}:
                continue
            
            strike = self._as_float(self._get(row, "pStrkPrc", "0"))
            
            if abs(strike - atm_strike) > strike_range * 50:
                continue
            
            token = self._get(row, "token")
            trading_symbol = self._get(row, "pTrdSymbol")
            
            option_data = {
                "token": token,
                "trading_symbol": trading_symbol,
                "strike": strike,
                "opt_type": opt_type,
                "exchange_segment": exchange_segment,
            }
            
            if opt_type == "CE":
                ce_options.append(option_data)
            else:
                pe_options.append(option_data)
        
        ce_options.sort(key=lambda x: x["strike"])
        pe_options.sort(key=lambda x: x["strike"])
        
        tokens_to_fetch = [
            {"instrument_token": opt["token"], "exchange_segment": exchange_segment}
            for opt in ce_options + pe_options
        ]
        
        if tokens_to_fetch:
            quotes = self.broker.quotes(instrument_tokens=tokens_to_fetch)
            quote_data = self._parse_quotes(quotes)
        else:
            quote_data = {}
        
        ce_chain = []
        pe_chain = []
        
        for opt in ce_options:
            data = quote_data.get(opt["token"], {})
            prev_oi = self._previous_oi.get(opt["token"], 0)
            current_oi = data.get("open_interest", 0)
            change_oi = current_oi - prev_oi
            self._previous_oi[opt["token"]] = current_oi
            
            ce_chain.append({
                "strike": opt["strike"],
                "token": opt["token"],
                "trading_symbol": opt["trading_symbol"],
                "ltp": data.get("ltp", 0),
                "bid": data.get("bid", 0),
                "ask": data.get("ask", 0),
                "volume": data.get("volume", 0),
                "open_interest": current_oi,
                "change_oi": change_oi,
                "iv": data.get("iv", 0),
                "ohlc": data.get("ohlc", {}),
            })
        
        for opt in pe_options:
            data = quote_data.get(opt["token"], {})
            prev_oi = self._previous_oi.get(opt["token"], 0)
            current_oi = data.get("open_interest", 0)
            change_oi = current_oi - prev_oi
            self._previous_oi[opt["token"]] = current_oi
            
            pe_chain.append({
                "strike": opt["strike"],
                "token": opt["token"],
                "trading_symbol": opt["trading_symbol"],
                "ltp": data.get("ltp", 0),
                "bid": data.get("bid", 0),
                "ask": data.get("ask", 0),
                "volume": data.get("volume", 0),
                "open_interest": current_oi,
                "change_oi": change_oi,
                "iv": data.get("iv", 0),
                "ohlc": data.get("ohlc", {}),
            })
        
        ce_chain.sort(key=lambda x: x["strike"])
        pe_chain.sort(key=lambda x: x["strike"])
        
        analysis = self._analyze_chain(ce_chain, pe_chain, spot)
        
        return {
            "underlying": underlying,
            "spot": spot,
            "expiry": expiry,
            "ce_chain": ce_chain,
            "pe_chain": pe_chain,
            "analysis": analysis,
        }

    def _analyze_chain(self, ce_chain: list, pe_chain: list, spot: float) -> dict[str, Any]:
        max_oi_ce = max(ce_chain, key=lambda x: x["open_interest"]) if ce_chain else None
        max_oi_pe = max(pe_chain, key=lambda x: x["open_interest"]) if pe_chain else None
        
        max_change_oi_ce = max(ce_chain, key=lambda x: abs(x["change_oi"])) if ce_chain else None
        max_change_oi_pe = max(pe_chain, key=lambda x: abs(x["change_oi"])) if pe_chain else None
        
        max_volume_ce = max(ce_chain, key=lambda x: x["volume"]) if ce_chain else None
        max_volume_pe = max(pe_chain, key=lambda x: x["volume"]) if pe_chain else None
        
        total_call_oi = sum(x["open_interest"] for x in ce_chain)
        total_put_oi = sum(x["open_interest"] for x in pe_chain)
        pcr = total_put_oi / total_call_oi if total_call_oi > 0 else 0
        
        return {
            "max_oi_call": {
                "strike": max_oi_ce["strike"] if max_oi_ce else None,
                "trading_symbol": max_oi_ce["trading_symbol"] if max_oi_ce else None,
                "oi": max_oi_ce["open_interest"] if max_oi_ce else 0,
            },
            "max_oi_put": {
                "strike": max_oi_pe["strike"] if max_oi_pe else None,
                "trading_symbol": max_oi_pe["trading_symbol"] if max_oi_pe else None,
                "oi": max_oi_pe["open_interest"] if max_oi_pe else 0,
            },
            "max_change_oi_call": {
                "strike": max_change_oi_ce["strike"] if max_change_oi_ce else None,
                "trading_symbol": max_change_oi_ce["trading_symbol"] if max_change_oi_ce else None,
                "change_oi": max_change_oi_ce["change_oi"] if max_change_oi_ce else 0,
            },
            "max_change_oi_put": {
                "strike": max_change_oi_pe["strike"] if max_change_oi_pe else None,
                "trading_symbol": max_change_oi_pe["trading_symbol"] if max_change_oi_pe else None,
                "change_oi": max_change_oi_pe["change_oi"] if max_change_oi_pe else 0,
            },
            "max_volume_call": {
                "strike": max_volume_ce["strike"] if max_volume_ce else None,
                "trading_symbol": max_volume_ce["trading_symbol"] if max_volume_ce else None,
                "volume": max_volume_ce["volume"] if max_volume_ce else 0,
            },
            "max_volume_put": {
                "strike": max_volume_pe["strike"] if max_volume_pe else None,
                "trading_symbol": max_volume_pe["trading_symbol"] if max_volume_pe else None,
                "volume": max_volume_pe["volume"] if max_volume_pe else 0,
            },
            "total_call_oi": total_call_oi,
            "total_put_oi": total_put_oi,
            "pcr": round(pcr, 2),
            "spot": spot,
        }

    def _load_rows(self, exchange_segment: str) -> list[dict[str, str]]:
        if exchange_segment in self._rows_cache:
            return self._rows_cache[exchange_segment]
        
        path = self.broker.scrip_master_path(exchange_segment)
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self._rows_cache[exchange_segment] = rows
        self.logger.info("option_chain_rows_loaded", exchange_segment=exchange_segment, row_count=len(rows))
        return rows

    def _nearest_expiry(self, rows: list[dict[str, str]], underlying: str) -> str:
        expiries = set()
        for row in rows:
            if self._get(row, "pSymbol") != underlying:
                continue
            if self._get(row, "pOptTp") in {"CE", "PE"}:
                expiry = self._get(row, "pExpDt")
                if expiry:
                    expiries.add(expiry)
        
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

    def _get_spot(self, rows: list[dict[str, str]], underlying: str) -> float:
        for row in rows:
            if self._get(row, "pSymbol") == underlying and self._get(row, "pInstType") in {"FUTIDX", "FUTSTK"}:
                ltp = self._as_float(self._get(row, "ltp", "0"))
                if ltp > 0:
                    return ltp
        
        option_rows = [
            row for row in rows
            if self._get(row, "pSymbol") == underlying
            and self._get(row, "pOptTp") in {"CE", "PE"}
        ]
        if not option_rows:
            raise ValueError(f"No data found for underlying={underlying}")
        
        strikes = sorted({self._as_float(self._get(row, "pStrkPrc", "0")) for row in option_rows})
        return strikes[len(strikes) // 2] if strikes else 0

    def _parse_quotes(self, quotes_response: Any) -> dict[str, dict]:
        result = {}
        
        if not quotes_response:
            return result
        
        messages = quotes_response.get("message", [])
        if not isinstance(messages, list):
            messages = [messages]
        
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            
            token = msg.get("instrument_token") or msg.get("tk")
            if not token:
                continue
            
            result[token] = {
                "ltp": self._as_float(msg.get("last_traded_price") or msg.get("ltp", 0)),
                "bid": self._as_float(msg.get("buy_price") or msg.get("bp", 0)),
                "ask": self._as_float(msg.get("sell_price") or msg.get("sp", 0)),
                "volume": int(msg.get("volume", 0) or 0),
                "open_interest": int(msg.get("open_interest", 0) or 0),
                "iv": self._as_float(msg.get("iv", 0)),
                "ohlc": msg.get("ohlc", {}),
            }
        
        return result

    @staticmethod
    def _get(row: dict[str, str], key: str, default: str = "") -> str:
        return (row.get(key) or default).strip()

    @staticmethod
    def _as_float(value: str | float | int) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0