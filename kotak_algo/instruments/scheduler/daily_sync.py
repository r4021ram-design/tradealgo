"""
Daily instrument synchronisation.

Strategy:
  1. Try the NSE daily contract master (.gz file).
  2. If that 404s (common), fall back to building the contract list
     from per-symbol option-chain API calls (index-only for speed).
  3. Merge lot-size data from a separate fetch.
  4. Persist everything to SQLite.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, date
from typing import Optional

from sqlalchemy.orm import Session

from kotak_algo.instruments.fetchers.nse_fetcher import NSEFetcher
from kotak_algo.instruments.models.contract_model import Contract, SyncLog
from kotak_algo.instruments.services.expiry_service import ExpiryService
from kotak_algo.instruments.data.db_utils import SessionLocal
from kotak_algo.utils.logger import get_logger

LOGGER = get_logger("daily_sync")


class DailySync:
    def __init__(self) -> None:
        self.fetcher = NSEFetcher()

    # ------------------------------------------------------------------
    async def sync_now(self) -> None:
        LOGGER.info("starting_instrument_sync")
        db: Session = SessionLocal()
        try:
            nse_count = 0
            # --- Step 1: Try contract master file first ---
            df = await asyncio.to_thread(self.fetcher.fetch_contract_master)

            if df is not None and not df.empty:
                nse_count = await asyncio.to_thread(self._save_from_contract_master, db, df)
            else:
                # --- Step 2: Fallback — build from option-chain API (indices only) ---
                LOGGER.info("contract_master_unavailable_falling_back_to_option_chains")
                df = await asyncio.to_thread(
                    self.fetcher.build_contracts_from_option_chains,
                    index_only=True,
                )
                if df is None or df.empty:
                    LOGGER.error("sync_failed_no_data")
                    self._log_sync(db, "FAILED", "No data from any source")
                else:
                    # --- Step 3: Fetch lot sizes ---
                    lot_map = await asyncio.to_thread(self.fetcher.fetch_lot_sizes)

                    # --- Step 4: Persist ---
                    nse_count = await asyncio.to_thread(self._save_from_chains, db, df, lot_map)

            # --- Step 5: Sync BSE contracts ---
            bse_count = 0
            from kotak_algo.api import get_algo_app
            app = get_algo_app()
            broker = app.broker if (app and hasattr(app, "broker") and app.broker and app.broker._client is not None) else None
            
            bse_count = await asyncio.to_thread(self._save_bse_contracts, db, broker)
            
            total_count = nse_count + bse_count
            self._run_validation(db, f"Sync complete. NSE: {nse_count}, BSE: {bse_count}. Total: {total_count} rows")

        except Exception as exc:
            db.rollback()
            LOGGER.exception("sync_exception", error=str(exc))
            self._log_sync(db, "FAILED", str(exc)[:250])
        finally:
            db.close()

    def _run_validation(self, db: Session, sync_message: str) -> None:
        """Run post-sync validation and log results."""
        from kotak_algo.instruments.services.validator_service import InstrumentValidator
        validator = InstrumentValidator(db)
        results = validator.run_full_audit()
        
        if results["summary"] == "PASSED":
            LOGGER.info("instrument_sync_validation_passed", details=results)
            self._log_sync(db, "SUCCESS", sync_message)
        else:
            LOGGER.error("instrument_sync_validation_failed", details=results)
            self._log_sync(db, "FAILED", f"Validation failed: {results['lot_sizes']['errors']} lot errors")

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------
    def _save_from_contract_master(self, db: Session, df) -> int:
        """
        Parse the NSE daily contract master CSV.

        Actual column mapping (from NSE file header):
          FinInstrmId      → internal token id
          UndrlygFinInstrmId → underlying id
          FinInstrmNm      → instrument type  (OPTIDX, OPTSTK, FUTIDX, FUTSTK)
          TckrSymb         → symbol            (NIFTY, BANKNIFTY, RELIANCE …)
          XpryDt           → expiry            (Unix epoch seconds)
          StrkPric         → strike price      (in paise, e.g. 6540000 = 65400)
          OptnTp           → option type       (CE / PE / XX for futures)
          MinLot           → minimum lot
          NewBrdLotQty     → board lot qty (= lot size)
          StockNm          → trading symbol    (BANKNIFTY26JUN65400CE)
        """
        db.query(Contract).filter(Contract.exchange == 'NSE').delete()

        cols = set(df.columns)
        LOGGER.info("contract_master_columns", columns=list(cols)[:25])

        count = 0
        for _, row in df.iterrows():
            try:
                symbol = str(row.get("TckrSymb", "")).strip()
                if not symbol or symbol.lower() in ("nan", "null", ""):
                    continue

                # --- Expiry: NSE epoch (base 1980-01-01) → date ---
                # NSE uses seconds since 1980-01-01 UTC, not the standard 1970 epoch.
                NSE_EPOCH_OFFSET = 315532800  # seconds between 1970-01-01 and 1980-01-01
                raw_expiry = row.get("XpryDt", 0)
                try:
                    unix_ts = int(float(raw_expiry)) + NSE_EPOCH_OFFSET
                    expiry_dt = datetime.utcfromtimestamp(unix_ts).date()
                except (ValueError, TypeError, OSError):
                    expiry_dt = None

                # --- Strike: paise → rupees (divide by 100) ---
                raw_strike = float(row.get("StrkPric", 0))
                strike = raw_strike / 100.0

                opt_type = str(row.get("OptnTp", "XX")).strip()
                inst_type = str(row.get("FinInstrmNm", "")).strip()
                trading_sym = str(row.get("StockNm", "")).strip()
                if not trading_sym or trading_sym.lower() in ("nan", "null", ""):
                    continue
                token = str(row.get("FinInstrmId", "")).strip()
                lot_size = int(float(row.get("NewBrdLotQty", row.get("MinLot", 0))))

                weekly_monthly = (
                    "MONTHLY" if ExpiryService.is_monthly_expiry(expiry_dt) else "WEEKLY"
                ) if expiry_dt else "UNKNOWN"

                db.add(Contract(
                    exchange="NSE",
                    segment="FO",
                    symbol=symbol,
                    trading_symbol=trading_sym or f"{symbol}{token}",
                    underlying=symbol,
                    expiry=expiry_dt,
                    strike=strike,
                    option_type=opt_type,
                    instrument_type=inst_type,
                    lot_size=lot_size,
                    freeze_qty=0,
                    token=token,
                    weekly_monthly_flag=weekly_monthly,
                ))
                count += 1
            except Exception:
                continue

        db.commit()
        LOGGER.info("saved_contract_master", count=count)
        return count

    def _save_from_chains(self, db: Session, df, lot_map: dict) -> int:
        """Persist rows built from option-chain API responses."""
        db.query(Contract).filter(Contract.exchange == 'NSE').delete()

        count = 0
        for _, row in df.iterrows():
            try:
                symbol = row["symbol"]
                expiry_dt = self._parse_date(row.get("expiry_str", ""))

                weekly_monthly = (
                    "MONTHLY" if expiry_dt and ExpiryService.is_monthly_expiry(expiry_dt) else "WEEKLY"
                )

                db.add(Contract(
                    exchange="NSE",
                    segment="FO",
                    symbol=symbol,
                    trading_symbol=row.get("trading_symbol", ""),
                    underlying=row.get("underlying", symbol),
                    expiry=expiry_dt,
                    strike=float(row.get("strike", 0)),
                    option_type=row.get("option_type", "XX"),
                    instrument_type=row.get("instrument_type", ""),
                    lot_size=lot_map.get(symbol, 0),
                    freeze_qty=0,
                    token="",
                    weekly_monthly_flag=weekly_monthly,
                ))
                count += 1
            except Exception:
                continue

        db.commit()
        LOGGER.info("saved_from_chains", count=count)
        return count

    def _save_bse_contracts(self, db: Session, broker=None) -> int:
        """
        Parse SENSEX and BANKEX contracts from BSE F&O scrip master CSV.
        If broker is provided, it tries to download/fetch the scrip master file first.
        Otherwise, it falls back to parsing the existing data/scrip_master/bse_fo.csv file.
        """
        try:
            csv_path = None
            if broker:
                LOGGER.info("fetching_bse_fo_scrip_master")
                try:
                    csv_path = broker.scrip_master_path(exchange_segment="bse_fo")
                except Exception as e:
                    LOGGER.warning("failed_to_fetch_bse_scrip_master_using_local", error=str(e))
            
            if not csv_path or not csv_path.exists():
                from pathlib import Path
                csv_path = Path(__file__).resolve().parents[3] / "data" / "scrip_master" / "bse_fo.csv"
                if not csv_path.exists():
                    csv_path = Path("data/scrip_master/bse_fo.csv")
            
            if not csv_path.exists():
                LOGGER.error("bse_fo_scrip_master_not_found", path=str(csv_path))
                return 0

            LOGGER.info("parsing_bse_fo_scrip_master", path=str(csv_path))
            import pandas as pd
            df = pd.read_csv(csv_path)
            if df.empty:
                LOGGER.warning("bse_fo_scrip_master_empty")
                return 0

            # Filter for SENSEX and BANKEX
            bse_symbols = ["SENSEX", "BANKEX"]
            bse_df = df[df["pSymbolName"].astype(str).str.upper().isin(bse_symbols)]
            LOGGER.info("found_bse_contracts_in_master", count=len(bse_df))

            # Helper to format option type for futures
            def get_option_type(row):
                opt = str(row.get("pOptionType") or row.get("pOptTp") or "XX").strip()
                if opt in ("CE", "PE"):
                    return opt
                return "XX"

            # Helper to format instrument type
            def get_inst_type(row):
                inst = str(row.get("pInstType") or "").strip()
                if inst == "IO":
                    return "OPTIDX"
                elif inst == "IF":
                    return "FUTIDX"
                return inst

            db.query(Contract).filter(Contract.exchange == 'BSE').delete()
            
            count = 0
            for _, row in bse_df.iterrows():
                try:
                    symbol = str(row.get("pSymbolName")).strip().upper()
                    trading_sym = str(row.get("pTrdSymbol") or row.get("pTrdSymbolName")).strip()
                    token = str(row.get("pSymbol") or row.get("token")).strip()
                    
                    # Parse Expiry (BSE uses standard Unix timestamp: seconds since 1970)
                    raw_expiry = int(row.get("pExpiryDate") or row.get("lExpiryDate ") or row.get("lExpiryDate") or 0)
                    if not raw_expiry:
                        continue
                    
                    from datetime import timezone
                    expiry_dt = datetime.fromtimestamp(raw_expiry, timezone.utc).date()
                    
                    # Parse Strike (paise -> rupees)
                    strike_col = "dStrikePrice;" if "dStrikePrice;" in row else "dStrikePrice"
                    raw_strike = float(row.get(strike_col, 0))
                    strike = raw_strike / 100.0
                    
                    opt_type = get_option_type(row)
                    inst_type = get_inst_type(row)
                    lot_size = int(row.get("lLotSize") or row.get("lotSize") or 0)
                    
                    weekly_monthly = "MONTHLY" if expiry_dt.day > 24 else "WEEKLY"
                    
                    db.add(Contract(
                        exchange="BSE",
                        segment="FO",
                        symbol=symbol,
                        trading_symbol=trading_sym,
                        underlying=symbol,
                        expiry=expiry_dt,
                        strike=strike,
                        option_type=opt_type,
                        instrument_type=inst_type,
                        lot_size=lot_size,
                        freeze_qty=0,
                        token=token,
                        weekly_monthly_flag=weekly_monthly,
                    ))
                    count += 1
                except Exception as e:
                    continue
            
            db.commit()
            LOGGER.info("saved_bse_contracts", count=count)
            return count
        except Exception as exc:
            LOGGER.exception("bse_sync_exception", error=str(exc))
            return 0

    # ------------------------------------------------------------------
    @staticmethod
    def _parse_date(val) -> Optional[date]:
        if not val or val == "nan":
            return None
        for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d", "%d%b%Y"):
            try:
                return datetime.strptime(str(val).strip(), fmt).date()
            except ValueError:
                continue
        return None

    @staticmethod
    def _log_sync(db: Session, status: str, message: str) -> None:
        db.add(SyncLog(sync_type="DAILY", status=status, message=message[:250]))
        try:
            db.commit()
        except Exception:
            db.rollback()


# ------------------------------------------------------------------
# Entry point used by the FastAPI lifespan
# ------------------------------------------------------------------
async def run_scheduler() -> None:
    """Sync once on startup, then every 24 h."""
    sync = DailySync()
    await sync.sync_now()
    while True:
        await asyncio.sleep(86400)
        await sync.sync_now()
