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


@app.get("/api/free/option-chain/{symbol}")
async def get_free_option_chain(symbol: str):
    """
    Fetch live option chain data for free directly from NSE (no broker API required).
    """
    if not get_scraper:
        raise HTTPException(status_code=501, detail="NSE Scraper module not available.")
    
    try:
        is_index = symbol.upper() in ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]
        scraper = get_scraper(symbol=symbol, is_index=is_index)
        
        # Run the blocking fetch in a thread pool
        result = await asyncio.to_thread(scraper.fetch_data, calculate_greeks=True)
        df = result["df"]
        spot_price = result["spot"]
        expiries = result["expiries"]
        
        active_expiry = expiries[0] if expiries else ""
        expiry_formatted = ""
        if active_expiry:
            try:
                from datetime import datetime
                dt = datetime.strptime(active_expiry, "%d-%b-%Y")
                expiry_formatted = dt.strftime("%d%b%y").upper()
            except Exception:
                expiry_formatted = active_expiry.replace("-", "").upper()

        algo = get_algo_app()
        if algo:
            try:
                algo.position_tracker.update_market_data(
                    trading_symbol=symbol.upper(),
                    instrument_token=symbol.upper(),
                    ltp=float(spot_price),
                    bid=float(spot_price) - 0.05,
                    ask=float(spot_price) + 0.05
                )
            except Exception as e:
                LOGGER.warning("failed_to_update_spot_in_position_tracker", error=str(e))

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
                except Exception as e:
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
        LOGGER.error("free_option_chain_error", error=str(e))
        raise HTTPException(
            status_code=503,
            detail={
                "message": "NSE data unavailable. Market may be closed or NSE is not responding.",
                "symbol": symbol.upper(),
                "error": str(e),
                "source": "error"
            }
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
        
        leg = {
            "trading_symbol": payload.trading_symbol,
            "instrument_token": payload.token,
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
