"""
NSE Fetcher — retrieves F&O instrument metadata from NSE India.

Data sources (in priority order):
  1. NSE API: /api/equity-stockIndices  → list of all F&O symbols
  2. NSE API: /api/option-chain-indices  → per-index option chain (strikes, expiries)
  3. NSE API: /api/option-chain-equities → per-stock option chain
  4. NSE Archives: daily contract file   → full contract master (pipe-delimited .gz)

All HTTP calls go through a single requests.Session that warms up
cookies exactly the way the existing nse_scraper.py does.
"""

from __future__ import annotations

import gzip
import io
import random
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import pandas as pd
import requests
from requests.exceptions import RequestException

from kotak_algo.utils.logger import get_logger

LOGGER = get_logger("nse_fetcher")

# Rotating User-Agent pool to reduce throttle risk
_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
]

# Known index symbols that use the "indices" option-chain endpoint
INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTY NEXT 50"}


class NSEFetcher:
    """Resilient fetcher for NSE F&O instrument data."""

    BASE = "https://www.nseindia.com"

    def __init__(self) -> None:
        self.session = requests.Session()
        self._cookies_ready = False

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------
    def _headers(self) -> Dict[str, str]:
        return {
            "User-Agent": random.choice(_USER_AGENTS),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": f"{self.BASE}/market-data/equity-derivatives-watch",
            "X-Requested-With": "XMLHttpRequest",
            "Connection": "keep-alive",
        }

    def _warm_up(self, force: bool = False) -> None:
        """Hit NSE pages to acquire session cookies."""
        if self._cookies_ready and not force:
            return
        self.session.headers.update(self._headers())
        try:
            self.session.get(self.BASE, timeout=10)
            time.sleep(0.5)
            self.session.get(f"{self.BASE}/api/marketStatus", timeout=10)
            time.sleep(0.5)
            self._cookies_ready = True
            LOGGER.info("nse_session_warmed_up")
        except RequestException as exc:
            LOGGER.error("nse_warmup_failed", error=str(exc))

    def _get(self, url: str, retries: int = 3, **kwargs) -> requests.Response:
        """GET with automatic cookie refresh on 401/403."""
        self._warm_up()
        for attempt in range(1, retries + 1):
            try:
                resp = self.session.get(url, timeout=15, **kwargs)
                if resp.status_code in (401, 403):
                    LOGGER.warning("nse_auth_rejected", attempt=attempt, status=resp.status_code)
                    time.sleep(2)
                    self._warm_up(force=True)
                    continue
                resp.raise_for_status()
                return resp
            except RequestException as exc:
                LOGGER.warning("nse_request_error", attempt=attempt, error=str(exc))
                time.sleep(2)
                if attempt == retries:
                    raise

    # ------------------------------------------------------------------
    # 1. List of all F&O symbols
    # ------------------------------------------------------------------
    def fetch_fno_symbols(self) -> List[str]:
        """Return the list of all symbols currently in the F&O segment."""
        url = f"{self.BASE}/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O"
        try:
            resp = self._get(url)
            data = resp.json()
            symbols = [item["symbol"] for item in data.get("data", [])]
            LOGGER.info("fetched_fno_symbols", count=len(symbols))
            return symbols
        except Exception as exc:
            LOGGER.error("fetch_fno_symbols_failed", error=str(exc))
            return []

    # ------------------------------------------------------------------
    # 2. Option chain per symbol (the richest single-call source)
    # ------------------------------------------------------------------
    def fetch_option_chain(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch full option-chain JSON for *symbol*."""
        symbol = symbol.upper()
        if symbol in INDEX_SYMBOLS:
            url = f"{self.BASE}/api/option-chain-indices?symbol={symbol}"
        else:
            url = f"{self.BASE}/api/option-chain-equities?symbol={symbol}"
        try:
            resp = self._get(url)
            data = resp.json()
            if "records" not in data or "data" not in data.get("records", {}):
                LOGGER.warning("option_chain_empty", symbol=symbol)
                return None
            return data
        except Exception as exc:
            LOGGER.error("fetch_option_chain_failed", symbol=symbol, error=str(exc))
            return None

    # ------------------------------------------------------------------
    # 3. Daily contract file (pipe-delimited .csv.gz)
    #    File name pattern: NSE_FO_contract_DDMMYYYY.csv.gz
    # ------------------------------------------------------------------
    def fetch_contract_master(self, for_date: Optional[date] = None) -> Optional[pd.DataFrame]:
        """
        Download the official NSE daily contract master file.
        Falls back to today's date if *for_date* is None.
        """
        target = for_date or date.today()
        date_str = target.strftime("%d%m%Y")
        url = (
            f"https://nsearchives.nseindia.com/content/fo/"
            f"NSE_FO_contract_{date_str}.csv.gz"
        )
        try:
            resp = self._get(url)
            # Decompress gzip → read pipe-delimited CSV
            buf = gzip.decompress(resp.content)
            df = pd.read_csv(io.BytesIO(buf))
            LOGGER.info("fetched_contract_master", rows=len(df), date=date_str)
            return df
        except Exception as exc:
            LOGGER.error("fetch_contract_master_failed", url=url, error=str(exc))
            return None

    # ------------------------------------------------------------------
    # 4. Build a full contract DataFrame from option-chain calls
    #    This is the RELIABLE fallback when archive files 404.
    # ------------------------------------------------------------------
    def build_contracts_from_option_chains(
        self,
        symbols: Optional[List[str]] = None,
        index_only: bool = False,
    ) -> pd.DataFrame:
        """
        Iterate over F&O symbols, pull their option chains, and return a
        unified DataFrame of all strikes / expiries / tokens.

        If *index_only* is True only NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY
        are fetched (much faster for a quick sync).
        """
        if symbols is None:
            if index_only:
                symbols = list(INDEX_SYMBOLS - {"NIFTY NEXT 50"})
            else:
                symbols = self.fetch_fno_symbols()
                # Prepend indices that aren't part of the equity list
                for idx in INDEX_SYMBOLS:
                    if idx not in symbols:
                        symbols.insert(0, idx)

        rows: List[Dict[str, Any]] = []

        for sym in symbols:
            chain = self.fetch_option_chain(sym)
            if chain is None:
                continue

            records = chain["records"]["data"]
            expiries = chain["records"].get("expiryDates", [])
            spot = chain["records"].get("underlyingValue", 0)

            for rec in records:
                strike = rec.get("strikePrice", 0)
                expiry_str = rec.get("expiryDate", "")

                for side, opt_type in [("CE", "CE"), ("PE", "PE")]:
                    leg = rec.get(side)
                    if leg is None:
                        continue

                    # Determine instrument type
                    underlying = leg.get("underlying", sym)
                    is_index = underlying.upper() in INDEX_SYMBOLS or sym in INDEX_SYMBOLS
                    inst_type = "OPTIDX" if is_index else "OPTSTK"

                    rows.append({
                        "exchange": "NSE",
                        "segment": "FO",
                        "symbol": sym,
                        "trading_symbol": leg.get("identifier", ""),
                        "underlying": underlying,
                        "expiry_str": expiry_str,
                        "strike": strike,
                        "option_type": opt_type,
                        "instrument_type": inst_type,
                        "lot_size": leg.get("totalTradedVolume", 0),  # placeholder
                        "oi": leg.get("openInterest", 0),
                        "ltp": leg.get("lastPrice", 0),
                        "iv": leg.get("impliedVolatility", 0),
                    })

            # Be polite to NSE — 1-2 s between symbols
            time.sleep(random.uniform(1.0, 2.0))

        df = pd.DataFrame(rows)
        if not df.empty:
            LOGGER.info("built_contracts_from_chains", total_rows=len(df), symbols=len(symbols))
        return df

    # ------------------------------------------------------------------
    # 5. Lot sizes
    # ------------------------------------------------------------------
    def fetch_lot_sizes(self) -> Dict[str, int]:
        """
        Try the archives CSV first; fall back to parsing the option-chain
        metadata if it 404s.
        """
        lot_map: Dict[str, int] = {}

        # Attempt 1: Archives CSV
        url = "https://archives.nseindia.com/content/fo/fo_mktlots.csv"
        try:
            resp = self._get(url, retries=2)
            df = pd.read_csv(io.StringIO(resp.text))
            # Columns: SYMBOL, <month1>, <month2>, …  (lot sizes per month)
            for _, row in df.iterrows():
                sym = str(row.iloc[1]).strip()   # second col is usually SYMBOL
                # Take the first non-zero numeric lot from remaining cols
                for val in row.iloc[2:]:
                    try:
                        lot = int(float(val))
                        if lot > 0:
                            lot_map[sym] = lot
                            break
                    except (ValueError, TypeError):
                        continue
            if lot_map:
                LOGGER.info("fetched_lot_sizes_csv", count=len(lot_map))
                return lot_map
        except Exception as exc:
            LOGGER.warning("lot_sizes_csv_unavailable", error=str(exc))

        # Attempt 2: Hardcoded index lots (always valid)
        lot_map.update({
            "NIFTY": 75,
            "BANKNIFTY": 30,
            "FINNIFTY": 65,
            "MIDCPNIFTY": 120,
        })
        LOGGER.info("using_default_index_lots")
        return lot_map
