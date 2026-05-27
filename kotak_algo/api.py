import os
import sys
# Add parent directory to path so it can be run directly
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
import io
import threading
import time
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, File, UploadFile, Form, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from kotak_algo.exceptions import AlgoError
from kotak_algo.main import AlgoApp
from kotak_algo.core.option_chain import OptionChainService
from kotak_algo.utils.logger import get_logger
from kotak_algo.utils.contract_parser import extract_contract_note, save_reconciliation_csvs

# Instrument Master Imports
from kotak_algo.instruments.data.db_utils import init_db, get_db
from kotak_algo.instruments.services.contract_service import ContractService
from kotak_algo.instruments.services.expiry_service import ExpiryService
from kotak_algo.instruments.scheduler.daily_sync import run_scheduler

# Import the NSE Scraper
try:
    from nse_scraper import get_scraper
except ImportError:
    # We define a dummy logger if get_logger isn't available yet
    print("Warning: Could not import NSEScraper.")
    get_scraper = None

LOGGER = get_logger("api")

tick_queue: asyncio.Queue = asyncio.Queue()


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                LOGGER.warning("websocket_broadcast_error", error=str(e))


manager = ConnectionManager()


def get_algo_app() -> Optional[AlgoApp]:
    return getattr(get_algo_app, "_app", None)


def set_algo_app(app: AlgoApp):
    get_algo_app._app = app


def get_algo_app_or_404() -> AlgoApp:
    app = get_algo_app()
    if not app:
        raise HTTPException(status_code=503, detail="AlgoApp not initialized")
    
    # Check if broker and session exist
    if not hasattr(app, 'broker') or not app.broker:
        raise HTTPException(status_code=503, detail="Broker client not initialized")

    # Proactive session check for every API request
    if not app.broker.is_session_alive():
        LOGGER.warning("api_request_detected_dead_session_attempting_refresh")
        try:
            # This triggers the thread-safe double-checked locking refresh
            app.broker.authenticate() 
        except Exception as e:
            LOGGER.error("api_session_refresh_failed", error=str(e))
            raise HTTPException(status_code=503, detail=f"Broker session expired and auto-refresh failed: {e}")
            
    return app

_event_loop: asyncio.AbstractEventLoop | None = None


def broadcast_tick(tick_data: dict[str, Any]):
    """Callback fired by position_tracker in the Kotak WS thread"""
    if _event_loop and _event_loop.is_running():
        asyncio.run_coroutine_threadsafe(tick_queue.put(tick_data), _event_loop)

async def tick_broadcaster_task():
    """Background task to read from queue and broadcast to all WS clients"""
    while True:
        tick_data = await tick_queue.get()
        await manager.broadcast(tick_data)
        tick_queue.task_done()

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _event_loop
    _event_loop = asyncio.get_running_loop()

    # Initialize Instrument DB
    try:
        init_db()
        LOGGER.info("instrument_db_initialized")
        # Start instrument sync in background
        asyncio.create_task(run_scheduler())
    except Exception as e:
        LOGGER.error("instrument_db_init_failed", error=str(e))

    task = asyncio.create_task(tick_broadcaster_task())

    config_path = Path(__file__).parent / "config.yaml"
    if not config_path.exists():
        config_path = Path(__file__).parent / "config.example.yaml"

    algo_app = AlgoApp(config_path)
    set_algo_app(algo_app)

    algo_app.position_tracker.register_listener(broadcast_tick)

    def run_app():
        try:
            algo_app.start()
        except Exception as e:
            LOGGER.error("algo_app_start_failed", error=str(e))

    app_thread = threading.Thread(target=run_app, daemon=True)
    app_thread.start()
    LOGGER.info("algo_app_started_in_background")

    yield

    app = get_algo_app()
    if app:
        app.shutdown(reason="fastapi_shutdown")
    task.cancel()

app = FastAPI(lifespan=lifespan)

# --- API Models ---

class ErrorResponse(BaseModel):
    success: bool = False
    error_code: str
    message: str
    details: Optional[dict[str, Any]] = None

class GenericResponse(BaseModel):
    success: bool = True
    message: str
    data: Optional[Any] = None

# --- Global Exception Handler ---

@app.exception_handler(AlgoError)
async def algo_exception_handler(request: Request, exc: AlgoError):
    LOGGER.error("api_exception_caught", error_type=type(exc).__name__, message=str(exc))
    return JSONResponse(
        status_code=400,
        content=ErrorResponse(
            error_code=type(exc).__name__,
            message=str(exc),
            details=getattr(exc, "details", None)
        ).dict()
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    LOGGER.exception("unhandled_api_error", error=str(exc))
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error_code="INTERNAL_SERVER_ERROR",
            message="An unexpected system error occurred"
        ).dict()
    )

# Allow React dev servers (Vite/CRA)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class OrderPayload(BaseModel):
    trading_symbol: str
    transaction_type: str
    quantity: int | None = None
    order_type: str | None = "MKT"


class OptionChainOrderPayload(BaseModel):
    trading_symbol: str
    token: str
    side: str = "B"
    exchange_segment: str = "nse_fo"
    product: str = "NRML"
    order_type: str = "MKT"
    quantity: int | None = None
    opt_type: str = "CE"
    transaction_type: str = "B"


class StrategyLegPayload(BaseModel):
    symbol: str
    side: str # 'BUY' or 'SELL'
    quantity: int
    strike: float
    type: str # 'Call' or 'Put'


class StrategyExecutePayload(BaseModel):
    name: str
    legs: list[StrategyLegPayload]
    order_type: str | None = "MKT"
    exchange_segment: str = "nse_fo"
    product: str = "NRML"


class OptionChainRequest(BaseModel):
    underlying: str
    exchange_segment: str = "nse_fo"
    expiry: str | None = None
    strike_range: int = 20


@app.get("/health")
async def health_check():
    """Simple health check for load balancers."""
    return {"status": "healthy"}

@app.get("/broker/status")
async def get_broker_status(app: AlgoApp = Depends(get_algo_app_or_404)):
    """Status of the Kotak Neo broker connection and session."""
    return {
        "connected": app.broker.is_session_alive(),
        "circuit_breaker": app.broker.circuit_breaker.to_dict(),
        "last_auth_time": getattr(app.broker, "_last_auth_time", None)
    }

@app.get("/ws/status")
async def get_ws_status(app: AlgoApp = Depends(get_algo_app_or_404)):
    """Status of the WebSocket feed and data freshness."""
    ws_info = app.websocket.to_dict()
    # Check for stale data across all subscribed symbols
    stale_symbols = []
    now = time.monotonic()
    for symbol, last_tick in app.websocket._symbol_last_tick.items():
        if now - last_tick > app.websocket.STALE_SYMBOL_THRESHOLD_S:
            stale_symbols.append({"symbol": symbol, "age": round(now - last_tick, 1)})
            
    return {
        **ws_info,
        "stale_data_detected": len(stale_symbols) > 0,
        "stale_symbols": stale_symbols
    }

@app.get("/risk/status")
async def get_risk_status(app: AlgoApp = Depends(get_algo_app_or_404)):
    """Current risk limits and status."""
    risk = app.risk_manager
    return {
        "kill_switch_active": risk.kill_switch_active,
        "combined_sl_triggered": risk.combined_sl_triggered,
        "daily_loss_breached": risk.daily_loss_breached(),
        "open_strategies_count": len(risk.open_strategies),
        "orders_last_minute": len(risk._order_count_window)
    }

@app.get("/strategies/status")
async def get_strategies_status(app: AlgoApp = Depends(get_algo_app_or_404)):
    """Lifecycle status of all configured strategies."""
    return [
        {
            "name": s.name,
            "state": s.state.value,
            "active": s.active,
            "legs_count": len(s.legs),
            "entered_slots": list(s.entered_slots)
        } for s in app.strategies
    ]

@app.get("/api/health")
async def detailed_health():
    """Aggregated system health for the dashboard."""
    algo = get_algo_app()
    if not algo:
        return {
            "status": "critical",
            "message": "AlgoApp not initialized",
        }

    # Broker session
    try:
        session_alive = algo.broker.is_session_alive()
        broker_status = "active" if session_alive else "expired"
    except Exception:
        broker_status = "unknown"

    # Circuit breaker
    circuit = algo.broker.circuit_breaker.to_dict()

    # WebSocket
    ws_info = algo.websocket.to_dict()

    # Position tracker
    pt_info = algo.position_tracker.to_dict()

    # Pending orders
    pending_count = sum(
        1 for o in algo.order_manager.pending_orders.values()
        if o.get("status") == "pending"
    )

    # Overall status
    if broker_status == "expired" or circuit["state"] == "open" or not ws_info["connected"]:
        overall = "degraded"
    elif pt_info["consecutive_poll_failures"] > 0:
        overall = "degraded"
    else:
        overall = "healthy"

    return {
        "status": overall,
        "broker_session": broker_status,
        "circuit_breaker": circuit,
        "websocket": ws_info,
        "positions": pt_info,
        "pending_orders": pending_count,
        "strategies_active": len(algo.strategies),
        "paper_trade": algo.order_manager.paper_trade,
    }


@app.get("/sync-state")
async def sync_state(app: AlgoApp = Depends(get_algo_app_or_404)):
    tracker = app.position_tracker
    return {
        "legs": tracker.legs,
        "market_data": tracker.market_data,
        "total_pnl": tracker.total_pnl(),
        "margin_used": tracker.margin_used,
        "available_margin": tracker.available_margin,
        "net_premium_received": tracker.net_premium_received()
    }


@app.post("/option-chain")
async def get_option_chain(request: OptionChainRequest, app: AlgoApp = Depends(get_algo_app_or_404)):
    try:
        option_chain_service = OptionChainService(app.broker, app.logger)
        
        def _fetch_chain():
            return option_chain_service.get_option_chain(
                underlying=request.underlying,
                exchange_segment=request.exchange_segment,
                expiry=request.expiry,
                strike_range=request.strike_range,
            )
        
        chain_data = await asyncio.to_thread(_fetch_chain)
        return chain_data
    
    except Exception as e:
        LOGGER.error("option_chain_error", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/free/underlyings")
async def get_free_underlyings():
    """
    Fetch all unique underlying symbols from contracts database + SENSEX.
    Purged of all simulated/fake data.
    """
    from pathlib import Path
    import sqlite3
    db_path = Path(__file__).resolve().parent / "instruments" / "data" / "contracts.db"
    
    symbols = []
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute(
            "SELECT DISTINCT symbol FROM contracts WHERE instrument_type IN ('OPTIDX', 'OPTSTK') ORDER BY symbol ASC"
        )
        rows = cursor.fetchall()
        conn.close()
        symbols = [r[0] for r in rows if r[0]]
    except Exception as e:
        LOGGER.warning("failed_to_fetch_symbols_from_db", error=str(e))
        symbols = ["NIFTY", "BANKNIFTY"]

    # Ensure BSE underlyings are included
    if "SENSEX" not in symbols:
        symbols.append("SENSEX")
    if "BANKEX" not in symbols:
        symbols.append("BANKEX")

    # Put priority indices at the top
    priority = ["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY", "MIDCPNIFTY"]
    for p in reversed(priority):
        if p in symbols:
            symbols.remove(p)
            symbols.insert(0, p)

    return {"underlyings": symbols}


@app.get("/api/free/option-chain/{symbol}")
async def get_free_option_chain(symbol: str, expiry: Optional[str] = None):
    """
    Fetch live option chain data. Prioritizes the active Kotak Neo broker session.
    Falls back to real-time NSE scraping only if broker is offline.
    Purged of all simulated/fake data.
    """
    if not get_scraper:
        raise HTTPException(status_code=501, detail="NSE Scraper module not available.")
    
    # Convert incoming dd-MMM-yyyy expiry to YYYY-MM-DD for database query
    from datetime import datetime
    expiry_db = None
    if expiry:
        try:
            dt = datetime.strptime(expiry, "%d-%b-%Y")
            expiry_db = dt.strftime("%Y-%m-%d")
        except Exception:
            try:
                dt = datetime.strptime(expiry, "%Y-%m-%d")
                expiry_db = dt.strftime("%Y-%m-%d")
            except Exception:
                expiry_db = expiry

    # 1. First Priority: Try the real Kotak Neo Broker API if alive
    algo = get_algo_app()
    if algo and algo.broker.is_session_alive():
        try:
            LOGGER.info("fetching_real_option_chain_from_kotak_neo", symbol=symbol, expiry=expiry_db)
            option_chain_service = OptionChainService(algo.broker, algo.logger)
            
            exchange_segment = "bse_fo" if symbol.upper() in ["SENSEX", "BANKEX"] else "nse_fo"
            def _fetch_real_chain():
                return option_chain_service.get_option_chain(
                    underlying=symbol.upper(),
                    exchange_segment=exchange_segment,
                    expiry=expiry_db,
                    strike_range=20
                )
            
            chain_data = await asyncio.to_thread(_fetch_real_chain)
            
            # Populate position tracker with the real-time live quotes fetched in the option chain call
            if algo:
                for x in chain_data.get("ce_chain", []):
                    try:
                        algo.position_tracker.update_market_data(
                            trading_symbol=x["trading_symbol"],
                            instrument_token=x["token"],
                            ltp=float(x["ltp"]),
                            bid=float(x["bid"]),
                            ask=float(x["ask"]),
                        )
                    except Exception as e:
                        LOGGER.warning("failed_to_update_tracker_ce_quote", symbol=x.get("trading_symbol"), error=str(e))
                for x in chain_data.get("pe_chain", []):
                    try:
                        algo.position_tracker.update_market_data(
                            trading_symbol=x["trading_symbol"],
                            instrument_token=x["token"],
                            ltp=float(x["ltp"]),
                            bid=float(x["bid"]),
                            ask=float(x["ask"]),
                        )
                    except Exception as e:
                        LOGGER.warning("failed_to_update_tracker_pe_quote", symbol=x.get("trading_symbol"), error=str(e))

            spot_price = chain_data["spot"]
            active_expiry = chain_data["expiry"]
            
            # Fetch all available expiries from database
            from pathlib import Path
            import sqlite3
            db_path = Path(__file__).resolve().parent / "instruments" / "data" / "contracts.db"
            
            expiries = []
            try:
                conn = sqlite3.connect(str(db_path))
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT DISTINCT expiry FROM contracts WHERE symbol = ? AND instrument_type IN ('OPTIDX', 'OPTSTK') AND expiry >= DATE('now') ORDER BY expiry ASC",
                    (symbol.upper(),)
                )
                rows = cursor.fetchall()
                conn.close()
                for r in rows:
                    try:
                        dt = datetime.strptime(r[0], "%Y-%m-%d")
                        expiries.append(dt.strftime("%d-%b-%Y"))
                    except Exception:
                        expiries.append(r[0])
            except Exception as e:
                LOGGER.warning("failed_to_fetch_all_expiries_from_db", error=str(e))
                expiries = [active_expiry]
                
            if not expiries:
                expiries = [active_expiry]

            try:
                dt = datetime.strptime(active_expiry, "%d-%b-%Y")
                expiry_formatted = dt.strftime("%d%b%y").upper()
            except Exception:
                expiry_formatted = active_expiry.replace("-", "").upper()
                
            ce_by_strike = {x["strike"]: x for x in chain_data["ce_chain"]}
            pe_by_strike = {x["strike"]: x for x in chain_data["pe_chain"]}
            all_strikes = sorted(set(ce_by_strike.keys()).union(pe_by_strike.keys()))
            
            chain = []
            for strike in all_strikes:
                ce_item = ce_by_strike.get(strike, {})
                pe_item = pe_by_strike.get(strike, {})
                
                chain.append({
                    "strike": strike,
                    "ce_symbol": ce_item.get("trading_symbol", f"{symbol.upper()}{expiry_formatted}{strike}CE"),
                    "pe_symbol": pe_item.get("trading_symbol", f"{symbol.upper()}{expiry_formatted}{strike}PE"),
                    "ce": {
                        "ltp": ce_item.get("ltp", 0),
                        "oi": ce_item.get("open_interest", 0),
                        "oiChange": ce_item.get("change_oi", 0),
                        "iv": ce_item.get("iv", 0),
                        "delta": 0,
                        "theta": 0,
                        "bidPrice": ce_item.get("bid", 0),
                        "bidQty": ce_item.get("bid_qty", 0),
                        "askPrice": ce_item.get("ask", 0),
                        "askQty": ce_item.get("ask_qty", 0),
                        "volume": ce_item.get("volume", 0),
                    },
                    "pe": {
                        "ltp": pe_item.get("ltp", 0),
                        "oi": pe_item.get("open_interest", 0),
                        "oiChange": pe_item.get("change_oi", 0),
                        "iv": pe_item.get("iv", 0),
                        "delta": 0,
                        "theta": 0,
                        "bidPrice": pe_item.get("bid", 0),
                        "bidQty": pe_item.get("bid_qty", 0),
                        "askPrice": pe_item.get("ask", 0),
                        "askQty": pe_item.get("ask_qty", 0),
                        "volume": pe_item.get("volume", 0),
                    }
                })
                
            return {
                "symbol": symbol.upper(),
                "spotPrice": spot_price,
                "expiryDates": expiries,
                "optionChain": chain,
                "source": "kotak"
            }
        except Exception as e:
            LOGGER.error("kotak_broker_option_chain_failed_falling_back_to_nse_scraper", error=str(e))

    # 2. Second Priority: Try real NSE scraping (only works if market is open)
    try:
        from datetime import datetime, timezone, timedelta
        ist = timezone(timedelta(hours=5, minutes=30))
        now_ist = datetime.now(ist)
        is_weekday = now_ist.weekday() < 5
        market_start = now_ist.replace(hour=9, minute=15, second=0, microsecond=0)
        market_end = now_ist.replace(hour=15, minute=30, second=0, microsecond=0)
        market_open = is_weekday and (market_start <= now_ist <= market_end)
        
        if not market_open:
            raise HTTPException(
                status_code=503,
                detail="Market is currently closed. Real-time data from NSE is unavailable off-market."
            )
            
        is_index = symbol.upper() in ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]
        scraper = get_scraper(symbol=symbol, is_index=is_index)
        
        def _fetch_scraper():
            try:
                return scraper.fetch_data(target_expiry=expiry, calculate_greeks=True, retries=2)
            except ValueError:
                # If target expiry not found, fall back to nearest
                return scraper.fetch_data(target_expiry=None, calculate_greeks=True, retries=2)
            
        result = await asyncio.to_thread(_fetch_scraper)
        df = result["df"]
        spot_price = result["spot"]
        expiries = result["expiries"]
        
        target_expiry = expiry if (expiry and expiry in expiries) else (expiries[0] if expiries else "")
        active_expiry = target_expiry
        expiry_formatted = ""
        if active_expiry:
            try:
                from datetime import datetime
                dt = datetime.strptime(active_expiry, "%d-%b-%Y")
                expiry_formatted = dt.strftime("%d%b%y").upper()
            except Exception:
                expiry_formatted = active_expiry.replace("-", "").upper()

        if algo:
            try:
                algo.position_tracker.update_market_data(
                    trading_symbol=symbol.upper(),
                    instrument_token=symbol.upper(),
                    ltp=float(spot_price),
                    bid=float(spot_price) - 0.05,
                    ask=float(spot_price) + 0.05
                )
            except Exception:
                pass

        # Convert DataFrame to a structured JSON format the dashboard expects
        chain = []
        for _, row in df.iterrows():
            strike = int(row["Strike"])
            ce_symbol = f"{symbol.upper()} {expiry_formatted} {strike} CE" if expiry_formatted else f"{symbol.upper()} {strike} CE"
            pe_symbol = f"{symbol.upper()} {expiry_formatted} {strike} PE" if expiry_formatted else f"{symbol.upper()} {strike} PE"

            if algo:
                try:
                    algo.position_tracker.update_market_data(
                        trading_symbol=ce_symbol,
                        instrument_token=ce_symbol,
                        ltp=float(row["CE_LTP"]),
                        bid=round(float(row["CE_LTP"]) - 0.05, 2),
                        ask=round(float(row["CE_LTP"]) + 0.05, 2)
                    )
                    algo.position_tracker.update_market_data(
                        trading_symbol=pe_symbol,
                        instrument_token=pe_symbol,
                        ltp=float(row["PE_LTP"]),
                        bid=round(float(row["PE_LTP"]) - 0.05, 2),
                        ask=round(float(row["PE_LTP"]) + 0.05, 2)
                    )
                except Exception:
                    pass

            chain.append({
                "strike": strike,
                "ce_symbol": ce_symbol,
                "pe_symbol": pe_symbol,
                "ce": {
                    "ltp": row["CE_LTP"],
                    "oi": row["CE_OI"],
                    "oiChange": row["CE_OI_Chg"],
                    "iv": row["CE_IV"],
                    "delta": row.get("CE_Delta", 0),
                    "theta": row.get("CE_Theta", 0),
                    "bidPrice": round(row["CE_LTP"] - 0.05, 2),
                    "askPrice": round(row["CE_LTP"] + 0.05, 2),
                    "volume": row["CE_OI"],
                },
                "pe": {
                    "ltp": row["PE_LTP"],
                    "oi": row["PE_OI"],
                    "oiChange": row["PE_OI_Chg"],
                    "iv": row["PE_IV"],
                    "delta": row.get("PE_Delta", 0),
                    "theta": row.get("PE_Theta", 0),
                    "bidPrice": round(row["PE_LTP"] - 0.05, 2),
                    "askPrice": round(row["PE_LTP"] + 0.05, 2),
                    "volume": row["PE_OI"],
                }
            })
            
        return {
            "symbol": symbol.upper(),
            "spotPrice": spot_price,
            "expiryDates": expiries,
            "optionChain": chain,
            "source": "live"
        }
    except Exception as e:
        LOGGER.error("real_option_chain_failed", error=str(e))
        raise HTTPException(
            status_code=503,
            detail=f"Failed to fetch real option chain data from both Kotak Neo and NSE: {str(e)}"
        )


@app.post("/api/strategy/execute")
async def execute_strategy(
    payload: StrategyExecutePayload,
    app: AlgoApp = Depends(get_algo_app_or_404),
):
    """
    Execute a multi-leg strategy directly from the Strategy Builder.
    """
    try:
        results = []
        for leg in payload.legs:
            # Note: In a production system, we would resolve the exact trading symbol 
            # and token from the DB based on strike, type and expiry.
            # For this demo, we assume the frontend sends a valid symbol.
            
            side = "B" if leg.side == "BUY" else "S"
            
            # Use the hardened OrderManager to place the order
            # This triggers all the RiskManager and validation logic
            order_id = await asyncio.to_thread(
                app.order_manager.place_order,
                trading_symbol=leg.symbol,
                side=side,
                quantity=leg.quantity,
                order_type="MKT",
                product="NRML",
                tag=f"builder_{payload.name.lower()}"
            )
            results.append({"symbol": leg.symbol, "order_id": order_id})
            
        return {"status": "success", "executed_legs": results}
        
    except Exception as e:
        LOGGER.error("strategy_execution_error", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/order/place")
async def place_option_chain_order(
    payload: OptionChainOrderPayload,
    app: AlgoApp = Depends(get_algo_app_or_404),
):
    try:
        lot_size = app.config.get("strategies", {}).get("straddle", {}).get("lot_size", 1)
        lots = payload.quantity or 1
        
        # Hardened: Resolve the clean contract trading symbol and token from SQLite contracts database
        trading_sym = payload.trading_symbol
        token = payload.token
        
        from kotak_algo.instruments.data.db_utils import get_db
        from kotak_algo.instruments.models.contract_model import Contract
        import re
        
        db = next(get_db())
        # Try exact matching on raw and clean symbol formats
        clean_sym = trading_sym.replace(" ", "").upper()
        contract = db.query(Contract).filter(
            (Contract.trading_symbol == clean_sym) | 
            (Contract.trading_symbol == trading_sym) |
            (Contract.token == token)
        ).first()
        
        if not contract:
            # Try to match parts of the space-separated string (e.g. "NIFTY 26-MAY-2026 24200 CE")
            match = re.match(
                r'^(?P<symbol>[A-Za-z]+)\s+(?P<expiry>[^\s\d]*\d{1,2}[^\s\d]*\d{2,4}|[^\s\d]*\d{1,2}[^\s\d]*)\s+(?P<strike>\d+(?:\.\d+)?)\s+(?P<type>CE|PE)$', 
                trading_sym.strip(), 
                re.IGNORECASE
            )
            if match:
                sym_part = match.group("symbol").upper()
                strike_part = float(match.group("strike"))
                type_part = match.group("type").upper()
                contract = db.query(Contract).filter(
                    Contract.symbol == sym_part,
                    Contract.strike == strike_part,
                    Contract.option_type == type_part
                ).first()
                
        if contract:
            LOGGER.info(
                "resolved_payload_symbol_from_db", 
                original_symbol=trading_sym, 
                resolved_symbol=contract.trading_symbol, 
                resolved_token=contract.token
            )
            trading_sym = contract.trading_symbol
            token = contract.token
            # Set the exact actual lot size from the database if available
            if contract.lot_size:
                lot_size = contract.lot_size

        # Also, double check: if the position_tracker doesn't have market data for the resolved symbol,
        # try to fetch a quote right now to populate it and avoid mid_price <= 0 crash!
        if trading_sym not in app.position_tracker.market_data:
            try:
                LOGGER.info("fetching_on_demand_quote_for_order", symbol=trading_sym, token=token)
                q_response = app.broker.quotes(
                    instrument_tokens=[{"instrument_token": token, "exchange_segment": payload.exchange_segment}]
                )
                from kotak_algo.core.option_chain import OptionChainService
                parsed_quotes = OptionChainService(app.broker, app.logger)._parse_quotes(q_response)
                q_data = parsed_quotes.get(token, {})
                if q_data:
                    app.position_tracker.update_market_data(
                        trading_symbol=trading_sym,
                        instrument_token=token,
                        ltp=float(q_data.get("ltp", 0.0)),
                        bid=float(q_data.get("bid", 0.0)),
                        ask=float(q_data.get("ask", 0.0)),
                    )
            except Exception as e:
                LOGGER.warning("on_demand_quote_fetch_failed", symbol=trading_sym, error=str(e))

        leg = {
            "trading_symbol": trading_sym,
            "instrument_token": token,
            "exchange_segment": payload.exchange_segment,
            "product": payload.product,
            "lot_size": lot_size,
            "lots": lots,
            "quantity": lot_size * lots,
            "tag": f"option-chain-{payload.opt_type}",
        }
        
        def _place_order():
            return app.order_manager.place_entry_order(leg, payload.transaction_type)
        
        result = await asyncio.to_thread(_place_order)
        LOGGER.info("option_chain_order_placed", trading_symbol=payload.trading_symbol, result=result)
        return result
    
    except Exception as e:
        LOGGER.error("option_chain_order_error", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/place-order")
async def place_order(payload: OrderPayload, app: AlgoApp = Depends(get_algo_app_or_404)):
    leg = app.position_tracker.legs.get(payload.trading_symbol)
    if not leg:
        raise HTTPException(status_code=404, detail="Leg not found in active positions")

    def _do_place_order():
        try:
            return app.order_manager.place_entry_order(leg, payload.transaction_type)
        except Exception as e:
            return {"error": str(e)}

    res = await asyncio.to_thread(_do_place_order)
    return res


@app.post("/square-off-all")
async def square_off_all(app: AlgoApp = Depends(get_algo_app_or_404)):
    results = []

    def _do_square_off():
        app.order_manager.cancel_all_pending()
        for symbol, leg in list(app.position_tracker.legs.items()):
            if leg.get("status") == "OPEN":
                try:
                    res = app.order_manager.market_exit(leg, reason="kill_switch_api")
                    results.append({"symbol": symbol, "result": res})
                except Exception as e:
                    results.append({"symbol": symbol, "error": str(e)})
        return results

    res = await asyncio.to_thread(_do_square_off)
    return {"message": "Square off initiated", "details": res}

@app.post("/api/reconciliation/upload")
async def upload_contract_note(file: UploadFile = File(...), password: str = Form("")):
    try:
        content = await file.read()
        pdf_stream = io.BytesIO(content)
        
        # Parse the contract note in memory
        parsed_data = await asyncio.to_thread(extract_contract_note, pdf_stream, password)
        
        # Save as CSV backups locally
        saved_paths = await asyncio.to_thread(save_reconciliation_csvs, parsed_data)
        LOGGER.info("contract_note_parsed", trades_count=len(parsed_data["trade_legs"]), saved_paths=saved_paths)
        
        return parsed_data
        
    except Exception as e:
        LOGGER.error("contract_note_parse_error", error=str(e))
        return {"error": f"Failed to parse contract note: {str(e)}"}

@app.websocket("/ws/live-feed")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # We don't strictly expect incoming messages from the dashboard yet,
            # but we keep the connection open and listen for close.
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# --- Instrument Master Routes ---

@app.get("/api/contracts")
async def get_contracts(
    symbol: Optional[str] = None, 
    expiry: Optional[str] = None, 
    db = Depends(get_db)
):
    service = ContractService(db)
    expiry_date = None
    if expiry:
        try:
            from datetime import datetime
            expiry_date = datetime.strptime(expiry, "%Y-%m-%d").date()
        except ValueError:
            pass
    return service.get_contracts(symbol=symbol, expiry=expiry_date)

@app.get("/api/contracts/active")
async def get_active_contracts(db = Depends(get_db)):
    service = ContractService(db)
    return service.get_active_contracts()

@app.get("/api/contracts/search")
async def search_contracts(q: str, db = Depends(get_db)):
    service = ContractService(db)
    return service.search_contracts(q)

@app.get("/api/contracts/nearest-expiry")
async def get_nearest_expiry(symbol: str, db = Depends(get_db)):
    service = ContractService(db)
    expiries = service.get_expiry_dates(symbol)
    if not expiries:
        raise HTTPException(status_code=404, detail="No expiries found for symbol")
    return {"symbol": symbol, "nearest_expiry": ExpiryService.get_nearest_expiry(expiries)}

@app.get("/api/contracts/strikes/{symbol}")
async def get_strikes(symbol: str, expiry: str, db = Depends(get_db)):
    service = ContractService(db)
    try:
        from datetime import datetime
        expiry_date = datetime.strptime(expiry, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    strikes = service.get_strikes(symbol, expiry_date)
    return {"symbol": symbol, "expiry": expiry, "strikes": strikes}

@app.get("/api/contracts/lot-size/{symbol}")
async def get_lot_size(symbol: str, db = Depends(get_db)):
    service = ContractService(db)
    lot_size = service.get_lot_size(symbol)
    if lot_size is None:
        raise HTTPException(status_code=404, detail="Symbol not found")
    return {"symbol": symbol, "lot_size": lot_size}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("kotak_algo.api:app", host="0.0.0.0", port=8000, reload=True)
