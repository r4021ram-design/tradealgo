# KotakAlgo — Complete Architecture & Codebase Guide

> **Purpose**: This is the single source of truth for the entire KotakAlgo trading system.  
> Any new AI agent MUST read this file first before making any changes.  
> Last updated: 2026-06-10

---

## 1. What Is This Project?

KotakAlgo is a **fully automated options trading system** for the Indian stock market (NSE & BSE), built on top of the **Kotak Securities Neo Trading API**. It includes:

- A **Python backend** (FastAPI + AlgoApp engine) that handles broker communication, order execution, strategy automation, risk management, and live market data streaming.
- A **React dashboard** (Vite + TailwindCSS) that provides a real-time trading terminal UI with option chains, position grids, strategy builder, and portfolio management.

### Key Business Rules

- **NSE expiry day**: **Tuesday** (Nifty, BankNifty, FinNifty, MidcapNifty, all stock derivatives)
- **BSE expiry day**: **Thursday** (SENSEX, BANKEX)
- **Holiday rule**: If expiry day is a holiday → shift to **preceding business day**
- See `.agent/contract_specifications.md` for the full reference.

---

## 2. Repository Structure

```
kotakalgo/
├── .agent/                          # Agent configuration & knowledge
│   ├── ARCHITECTURE.md              # ← THIS FILE (read first!)
│   ├── contract_specifications.md   # NSE/BSE expiry rules
│   └── skills/                      # Custom agent skills
│
├── kotak_algo/                      # Python Backend (the trading engine)
│   ├── __init__.py
│   ├── main.py                      # AlgoApp: main loop, strategy orchestrator
│   ├── api.py                       # FastAPI server (36KB, 965 lines)
│   ├── config.yaml                  # Runtime configuration
│   ├── config.example.yaml          # Template for config
│   ├── config_models.py             # Pydantic validation models
│   ├── container.py                 # Dependency injection (punq)
│   ├── events.py                    # Event bus (pub/sub)
│   ├── exceptions.py                # Centralized exception hierarchy
│   ├── requirements.txt             # Python dependencies
│   │
│   ├── broker/                      # Broker integration layer
│   │   ├── neo_client.py            # Kotak Neo SDK wrapper (auth, orders, quotes)
│   │   ├── order_manager.py         # Order lifecycle (place, modify, cancel, SL)
│   │   ├── pre_trade_validator.py   # Pre-trade validation checks
│   │   └── websocket_feed.py        # Real-time tick streaming (auto-reconnect)
│   │
│   ├── core/                        # Core trading logic
│   │   ├── option_chain.py          # Live option chain fetcher
│   │   ├── position_tracker.py      # Position tracking, P&L, Greeks
│   │   ├── risk_manager.py          # Risk limits, SL enforcement, kill switch
│   │   ├── greeks_engine.py         # Black-Scholes Greeks calculator
│   │   ├── strike_selector.py       # ATM/OTM strike selection logic
│   │   ├── scheduler.py             # Time-based scheduling (entry/exit)
│   │   ├── nse_reference.py         # NSE reference data (lot sizes, qty freeze)
│   │   ├── backtest_sandbox.py      # Localized historical backtesting simulation sandbox engine
│   │   └── telemetry.py             # Local telemetry/audit logger

│   │
│   ├── strategies/                  # Trading strategy implementations
│   │   ├── base_strategy.py         # Abstract base (state machine: IDLE→ENTERING→IN_TRADE→EXITING→DONE)
│   │   ├── straddle.py              # ATM Straddle (sell CE+PE at same strike)
│   │   └── strangle.py              # OTM Strangle (sell CE+PE at different strikes)
│   │
│   ├── instruments/                 # Instrument master database
│   │   ├── data/
│   │   │   ├── contracts.db         # SQLite database of all contracts
│   │   │   └── db_utils.py          # SQLAlchemy engine & session
│   │   ├── models/                  # ORM models
│   │   ├── parsers/                 # CSV/API response parsers
│   │   ├── fetchers/                # Contract data fetchers
│   │   ├── services/                # ContractService, ExpiryService
│   │   ├── scheduler/               # Daily sync scheduler
│   │   └── utils/                   # Instrument utilities
│   │
│   ├── utils/                       # Shared utilities
│   │   ├── logger.py                # Structured logging (structlog)
│   │   ├── config_loader.py         # YAML config with env var substitution
│   │   ├── api_validator.py         # API response validation
│   │   ├── contract_parser.py       # PDF contract note parser
│   │   ├── retry.py                 # Retry with backoff + CircuitBreaker
│   │   ├── telegram_notifier.py     # Telegram alert bot
│   │   └── totp_helper.py           # TOTP generation for 2FA
│   │
│   ├── logs/                        # Runtime logs (structlog JSON)
│   ├── snapshots/                   # Position snapshots
│   └── data/                        # Runtime data
│
├── dashboard/                       # React Frontend (Vite + TailwindCSS v4)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.jsx                 # Entry point (AG Grid module registration)
│   │   ├── App.jsx                  # Root layout: Lock screen, SplitPane + OrderModal
│   │   ├── App.css                  # Global styles
│   │   ├── index.css                # Tailwind directives
│   │   │
│   │   ├── engine/                  # OMS Core Engine (TypeScript)
│   │   │   ├── types.ts             # Segment, Side, Order, Fill, Position types
│   │   │   ├── instrumentRegistry.ts# Position key generation and parsing
│   │   │   └── positionEngine.ts    # FIFO matching & realized/unrealized PNL
│   │   │
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── MainLayout.jsx   # Full-screen layout wrapper
│   │   │   │   ├── TopBar.jsx       # NIFTY/BANKNIFTY spot, MTM, active view tabs, paper switcher
│   │   │   │   └── SplitPane.jsx    # Split-pane layout
│   │   │   │
│   │   │   ├── oms/                 # OMS Position Engine Simulation Grids
│   │   │   │   ├── OMSDashboard.tsx # Composited layout with filtering/tabs
│   │   │   │   ├── OpenPositionsGrid.tsx # Open positions table
│   │   │   │   ├── ClosedTradesGrid.tsx  # Closed entry/exit matched pairs
│   │   │   │   ├── OrderBookGrid.tsx     # Order history book
│   │   │   │   ├── NetPositionWindow.tsx # MTM summary + manual order simulator
│   │   │   │   └── FilterBar.tsx         # Multi-segment grid filter panel
│   │   │   │
│   │   │   ├── market-watch/
│   │   │   │   └── MarketWatch.jsx  # AG Grid watchlist with live tick flashing
│   │   │   │
│   │   │   ├── orders/
│   │   │   │   ├── NetPositionGrid.jsx  # AG Grid positions with P&L & Greeks
│   │   │   │   ├── OrderModal.jsx       # Buy/Sell order entry modal
│   │   │   │   └── OrdersGrid.jsx       # Custom orders grid
│   │   │   │
│   │   │   ├── option-chain/        # Option chain panel
│   │   │   │   ├── OptionChain.jsx  # Main option chain layout with mirrored columns and Greeks
│   │   │   │   └── OptionChain.css  # Option chain spreadsheet styles

│   │   │   │
│   │   │   ├── strategy/
│   │   │   │   └── StrategyBuilder.jsx  # Multi-leg strategy builder with payoff chart
│   │   │   │
│   │   │   ├── portfolio/
│   │   │   │   └── OptionPortfolioManager.jsx  # Portfolio scenario analysis & combined Greeks
│   │   │   │
│   │   │   ├── instruments/         # Instrument search
│   │   │   ├── MetricCard.jsx       # Reusable metric display card
│   │   │   └── PositionsGrid.jsx    # Alternative positions grid
│   │   │
│   │   ├── hooks/
│   │   │   ├── useTickStream.js     # WebSocket hook for real-time ticks
│   │   │   ├── useLiveData.js       # Live data polling (/sync-state)
│   │   │   ├── useOrdersData.js     # Live orders polling (/api/orders)
│   │   │   └── useOptionChainData.js # Option chain data fetching hook
│   │   │
│   │   ├── store/
│   │   │   ├── useTerminalStore.js  # Zustand: positions, marketWatch, activeView, paperMode
│   │   │   ├── useTerminalStore.d.ts# TypeScript declarations for terminal store
│   │   │   └── usePortfolioStore.js # Zustand: portfolio state
│   │   │
│   │   └── utils/
│   │       ├── api.js               # API URL helper
│   │       ├── symbolParser.js      # Clean option symbol parsing logic
│   │       ├── i18n.js              # Localization configurations
│   │       └── blackScholes.js      # Client-side Black-Scholes calculator
│   │
│   └── public/
│
├── data/                            # Archived data
│   ├── nse/                         # NSE reference data archives
│   └── post_market_data/            # Daily post-market snapshots (JSON + CSV)
│       └── YYYY-MM-DD/
│           ├── positions.json/csv
│           ├── trades.json/csv
│           ├── orders.json/csv
│           └── limits.json/csv
│
├── start_trading.bat                # Local services startup batch file
├── nse_scraper.py                   # NSE website scraper (fallback for option chain)
├── verify_db.py                     # Database verification script
├── ip_monitor.py                    # IP change monitoring
└── scratch/                         # Temporary scratch scripts
```

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        React Dashboard (Vite)                       │
│  ┌──────────┐  ┌───────────────┐  ┌──────────┐  ┌───────────────┐ │
│  │MarketWatch│  │NetPositionGrid│  │OptionChain│  │StrategyBuilder│ │
│  │ (AG Grid) │  │   (AG Grid)   │  │  Panel    │  │ + PayoffChart │ │
│  └──────────┘  └───────────────┘  └──────────┘  └───────────────┘ │
│         │              │                │               │           │
│         └──────────────┴────────────────┴───────────────┘           │
│                              Zustand Store                          │
│                    useTerminalStore / usePortfolioStore              │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ HTTP REST + WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    FastAPI Server (api.py)                           │
│              Port 8000 · CORS enabled for localhost                  │
│                                                                     │
│  Routes:                                                            │
│    GET  /health                    → Simple health check            │
│    GET  /api/health                → Detailed system health         │
│    GET  /broker/status             → Broker connection status       │
│    GET  /ws/status                 → WebSocket feed status          │
│    GET  /risk/status               → Risk limits status             │
│    GET  /strategies/status         → Strategy lifecycle status      │
│    GET  /sync-state                → Positions, market data, P&L    │
│    GET  /api/free/underlyings      → All tradeable symbols          │
│    GET  /api/free/option-chain/{s} → Live option chain              │
│    POST /option-chain              → Option chain (authenticated)   │
│    POST /api/order/place           → Place order from option chain  │
│    POST /api/strategy/execute      → Execute multi-leg strategy     │
│    POST /place-order               → Place order on existing leg    │
│    POST /square-off-all            → Emergency exit all positions   │
│    POST /api/reconciliation/upload → Upload contract note PDF       │
│    GET  /api/contracts             → Query instrument master DB     │
│    GET  /api/contracts/active      → Active contracts               │
│    GET  /api/contracts/search      → Search contracts               │
│    GET  /api/contracts/nearest-expiry → Nearest expiry for symbol   │
│    GET  /api/contracts/strikes/{s} → Available strikes              │
│    GET  /api/contracts/lot-size/{s}→ Lot size for symbol            │
│    POST /api/verify-pin            → Verify 4-digit Trading PIN     │
│    GET  /api/orders                → Get session orders             │
│    DELETE /api/orders/{order_id}   → Cancel pending order           │
│    PUT  /api/orders/{order_id}     → Modify pending order           │
│    GET  /api/config/paper-trade    → Get paper trading status       │
│    POST /api/config/paper-trade    → Toggle & persist paper trade   │
│    GET  /api/contracts/details     → Detailed contract specs        │
│    POST /api/backtest              → Trigger sandbox backtest run   │
│    WS   /ws/live-feed              → Real-time tick broadcast       │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    AlgoApp Engine (main.py)                          │
│              Runs in a background daemon thread                      │
│                                                                     │
│  Main Loop (_tick every 1 second):                                  │
│    1. Refresh NSE reference data                                    │
│    2. Check daily loss breach → shutdown if exceeded                │
│    3. Enforce leg-level stop losses                                 │
│    4. Enforce combined stop loss                                    │
│    5. For each strategy: should_enter() → execute()                 │
│                          should_exit()  → square_off()              │
│    6. Health watchdog for stuck strategies                           │
│    7. Check hard exit time → shutdown                               │
└────────┬──────────┬──────────┬──────────┬───────────────────────────┘
         │          │          │          │
         ▼          ▼          ▼          ▼
   ┌──────────┐┌──────────┐┌──────────┐┌──────────┐
   │  Broker  ││  Order   ││  Risk    ││ Position │
   │  Client  ││  Manager ││  Manager ││ Tracker  │
   │(neo_client)│(order_mgr)│(risk_mgr)│(pos_track)│
   └─────┬────┘└──────────┘└──────────┘└─────┬────┘
         │                                    │
         ▼                                    ▼
   ┌──────────┐                         ┌──────────┐
   │ Kotak Neo│                         │ WebSocket│
   │  SDK API │                         │   Feed   │
   └──────────┘                         └──────────┘
```

---

## 4. Component Deep Dive

### 4.1 NeoBrokerClient (`broker/neo_client.py`)
- Wraps the `neo_api_client.NeoAPI` SDK
- **Auto re-authentication** on SessionExpiredError
- **Circuit breaker** (5 failures → 30s timeout → auto-reset)
- **Retry with exponential backoff** on transient errors
- **Proactive health check** thread (every 5 min)
- Thread-safe authentication with `_auth_lock`
- Methods: `authenticate()`, `place_order()`, `modify_order()`, `cancel_order()`, `order_history()`, `positions()`, `trade_report()`, `limits()`, `quotes()`

### 4.2 OrderManager (`broker/order_manager.py`)
- **Duplicate order guard** (10s cooldown per symbol+side+qty)
- **Pre-trade validation** via `PreTradeValidator`
- **Risk middleware** checks before every order
- **Paper trade mode** (simulated fills with UUID order IDs)
- **Limit order repricing** (place at mid → reprice N times → fall back to market)
- **Market exit with 3 retries** + critical alert on failure
- Order types: `place_entry_order()`, `place_stop_loss_order()`, `market_exit()`, `trigger_stop_loss()`

### 4.3 WebSocketFeed (`broker/websocket_feed.py`)
- Real-time tick data from Kotak Neo
- **Auto-reconnect** with exponential backoff (max 20 attempts)
- **Heartbeat monitoring** (30s timeout → force reconnect)
- **Per-symbol stale detection** (60s threshold)
- **Tick deduplication** (skips identical consecutive payloads)
- **Auto re-subscribe** after reconnect
- Feeds data to `PositionTracker` → broadcasts to dashboard via WebSocket

### 4.4 PositionTracker (`core/position_tracker.py`)
- Tracks all open legs with real-time LTP, bid/ask, Greeks
- **Rupee-term Greeks Integration**: Interacts with the Black-Scholes Greeks engine (`core/greeks_engine.py`) to calculate Delta, Gamma, Theta, and Vega. Incorporates RBI Repo rate (5.25%) as the risk-free rate `r` and sets options expiry time to 15:30 IST on expiry day for correct DTE (Days-To-Expiry) fractional year calculations. Also implements a **Zero DTE Greeks Fallback Safety Guard** by intercepting the time to expiry `T` and applying `T = max(T, 0.00002)` if `T <= 0` or if the current date matches the contract expiry date exactly, preventing option Greeks from collapsing to flat `0.00` on expiry day.
- **Background polling** thread reconciles with broker positions
- **Market data cache** for all subscribed instruments
- `parse_expiry()` handles NSE (Tuesday) and BSE (Thursday) expiry rules
- Hardcoded `HOLIDAYS_2026` set for holiday-adjusted expiries
- Methods: `total_pnl()`, `net_premium_received()`, `ltp()`, `mid_price()`, `record_fill()`

### 4.5 RiskManager (`core/risk_manager.py`)
- **Trading PIN Security**: Implements 4-digit Trading PIN authentication (`risk.trading_pin` in config, e.g., `1234`) via `POST /api/verify-pin` to prevent unauthorized actions and protect backend routes.
- **Daily loss limit**: Shuts down if total P&L drops below `-max_daily_loss`
- **Combined stop loss**: Exits all positions if loss exceeds X% of net premium
- **Leg-level stop loss**: Individual SL triggers per option leg
- **Order throttling**: Max N orders per minute
- **Kill switch**: Emergency procedure to exit everything and halt trading
- **Position reconciliation**: Compares local state with broker, auto-corrects mismatches

### 4.6 Strategies (`strategies/`)
State machine: `IDLE → ENTERING → IN_TRADE → EXITING → DONE`

| Strategy | File | What It Does |
|----------|------|-------------|
| **Straddle** | `straddle.py` | Sells ATM CE + PE at same strike |
| **Strangle** | `strangle.py` | Sells OTM CE + PE with `strangle_gap` offset |
| **Iron Condor** | `iron_condor.py` | Sells OTM Call/Put (Strangle) and buys further OTM Call/Put wings (Hedges) |

Both inherit from `BaseStrategy` which provides:
- `prepare()` → build legs, resolve tokens
- `should_enter()` → checks scheduler for entry time
- `should_exit()` → checks scheduler for exit time
- `execute()` → places entry orders sequentially (Long legs executed/confirmed filled first)
- `square_off()` → market exits all legs sequentially (Short legs exited first)
- `_recover_strategy()` → re-attaches to broker positions on restart

### 4.7 OptionChainService (`core/option_chain.py`)
- Fetches live option chain from Kotak Neo API
- Queries `contracts.db` for trading symbols, tokens, strikes
- Fetches futures quote for spot price derivation
- **Exchange segment**: `nse_fo` for NSE, `bse_fo` for SENSEX/BANKEX
- Falls back to hardcoded index token if futures quote fails

### 4.8 Event Bus (`events.py`)
Pub/sub system for decoupled communication:
- `LEG_STOP_LOSS_TRIGGERED`, `COMBINED_STOP_LOSS_TRIGGERED`
- `STRATEGY_ENTERED`, `STRATEGY_EXITED`
- `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`
- `SESSION_EXPIRED`, `SESSION_REAUTH_SUCCESS/FAILED`
- `RECONNECT_STARTED/SUCCEEDED/FAILED`
- `API_CIRCUIT_OPEN/CLOSED`
- `STALE_DATA_DETECTED`, `CRITICAL_ERROR`

### 4.9 Instrument Master (`instruments/`)
- SQLite database (`contracts.db`) with all NSE/BSE F&O contracts
- Daily sync scheduler fetches fresh contracts from Kotak Neo
- ORM model: `Contract` (symbol, trading_symbol, token, expiry, strike, option_type, lot_size, etc.)
- Services: `ContractService` (query/search), `ExpiryService` (expiry date logic)

### 4.10 Option Portfolio Manager & Scenario Analysis (`portfolio/OptionPortfolioManager.jsx`)
- **Combined Risk Engine**: Aggregates risk and computes combined Greeks (Delta, Gamma, Theta, Vega) across live broker positions (read from active portfolio, with individual inclusion toggles) and manual strategy designer/hedging simulation legs.
- **Override IV Formatting**: Formats the "Override IV %" input field using JavaScript's `.toFixed(2)` to clip binary float overflow strings and display clean percentages.
- **Simulation Grid Vega Column**: Appends the "Vega" column directly after "Theta" styled to match Delta/Theta columns, formatted via `.toFixed(2)`.
- **Scenario Payoff Visualizations**: Renders interactive payoff curves showing P&L across a range of underlying prices. Displays the peaked **Expiry Payoff Line** (T=0 final payout) alongside scenario curves under different volatility and time conditions.
- **Interactive Controls**: Features time shift slider (0 to 30 days) and custom volatility shifts (Blue base IV, Green shift, Red shift) to model risk profiles and stress test options.
- **Dynamic X-Axis Scaling**: Automatically scales the graph's X-axis range to span at least 6% of the spot price (+/- 3%) for proper visual resolution of option curve characteristics.

---

## 5. Configuration (`config.yaml`)

```yaml
broker:
  consumer_key: "${KOTAK_CONSUMER_KEY}"    # From .env
  mobile_number: "${KOTAK_MOBILE_NUMBER}"
  ucc: "${KOTAK_UCC}"
  mpin: "${KOTAK_MPIN}"
  totp_secret: "${KOTAK_TOTP_SECRET}"
  environment: "prod"
  telegram:
    enabled: false
    bot_token: "${TELEGRAM_BOT_TOKEN}"
    chat_id: "${TELEGRAM_CHAT_ID}"

strategies:
  straddle:
    underlying: "NIFTY"
    exchange_segment: "nse_fo"
    product: "NRML"
    lots: 1
    lot_size: 75
    strike_gap: 50
    sl_multiplier: 2.0                     # SL = 2x entry premium
    entry_times: ["09:25", "13:05"]        # Two entry windows
    exit_time: "15:15"                     # Auto square-off time
  strangle:
    underlying: "BANKNIFTY"
    exchange_segment: "nse_fo"
    product: "NRML"
    lots: 1
    lot_size: 15
    strike_gap: 100
    strangle_gap: 300                      # Distance from ATM
    sl_multiplier: 2.0
    entry_times: ["09:25", "13:05"]
    exit_time: "15:15"
  iron_condor:
    underlying: "NIFTY"
    exchange_segment: "nse_fo"
    product: "NRML"
    lots: 1
    lot_size: 65
    strike_gap: 50
    strangle_gap: 200                      # Distance from ATM to Shorts
    condor_gap: 100                        # Distance from Shorts to Long hedges (wing width)
    sl_multiplier: 2.0
    entry_times: ["09:25", "13:05"]
    exit_time: "15:15"

risk:
  max_daily_loss: 5000
  combined_sl_pct: 50                      # Exit if loss > 50% of premium
  max_open_strategies: 2
  paper_trade: true                        # IMPORTANT: true = simulated orders
  max_reprice_attempts: 3
  reprice_interval_seconds: 30
  position_poll_interval_seconds: 5
  trading_pin: "1234"                      # 4-digit Trading PIN for Lock Screen bypass

nse_reference:
  enabled: true
  refresh_time: "08:45"                    # Before market open
  archive_dir: "data/nse"
```

---

## 6. How to Run

### Backend (API Server)
```bash
cd kotakalgo
python -m uvicorn kotak_algo.api:app --host 127.0.0.1 --port 8000
```
This starts:
1. FastAPI server on port 8000
2. AlgoApp engine in a background daemon thread
3. Instrument DB initialization + daily sync scheduler
4. Kotak Neo authentication + WebSocket feed
5. Strategy recovery from existing broker positions

### Frontend (Dashboard)
```bash
cd kotakalgo/dashboard
npm run dev
```
Runs Vite dev server (typically port 5173).

### Environment Variables
Stored in `kotak_algo/.env`:
- `KOTAK_CONSUMER_KEY`, `KOTAK_MOBILE_NUMBER`, `KOTAK_UCC`, `KOTAK_MPIN`, `KOTAK_TOTP_SECRET`
- `KOTAK_ENVIRONMENT` (default: "prod")
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (optional)

---

## 7. Data Flow

### Live Tick Flow
```
Kotak Neo WS → WebSocketFeed.on_message()
                → validate_tick()
                → PositionTracker.update_market_data()
                → broadcast_tick() callback
                → asyncio.Queue → tick_broadcaster_task()
                → WebSocket /ws/live-feed → Dashboard
                → useTickStream.js → Zustand updateTick()
                → AG Grid cell flash (green/red)
```

### Order Flow
```
Dashboard (Option Chain / Strategy Builder)
  → POST /api/order/place or /api/strategy/execute
  → Resolve symbol/token from contracts.db
  → Fetch on-demand quote if market data missing
  → OrderManager.place_entry_order()
    → DedupCache.check_and_record()
    → RiskManager.validate_order()
    → PreTradeValidator.validate()
    → If paper_trade: simulate fill
    → If live: broker.place_order() → validate_order_response()
    → PositionTracker.record_fill()
    → If limit: reprice loop → fallback to market order
```

### Option Chain Data Flow
```
GET /api/free/option-chain/{symbol}
  → Priority 1: Kotak Neo API (if session alive)
    → OptionChainService.get_option_chain()
    → Query contracts.db for symbols/tokens
    → Fetch futures quote for spot price
    → Fetch batch quotes for all strikes
    → Return structured chain data
  → Priority 2: NSE Scraper (fallback, market hours only)
    → nse_scraper.py → fetch from NSE website
  → Priority 3: Error 503 (market closed)
```

---

## 8. Frontend State Management

### Zustand Stores

**`useTerminalStore`** (primary):
- `positions[]` — Open positions with P&L
- `marketWatch[]` — Watchlist items with live ticks
- `niftySpot`, `bankNiftySpot` — Index spot prices
- `nifty`, `banknifty`, `sensex`, `indiavix` — Detailed index state objects (LTP, absolute change, percentage change) for the Top Header Bar ticker.
- `selectedUnderlying`, `selectedExpiry` — Option chain selection
- `optionChain[]` — Option chain data rows
- `orderModal{}` — Order entry modal state
- `activeView` — Renders either the Live Terminal (`'terminal'`) or the OMS Simulator (`'oms'`)
- `isPaperTrade` — Boolean tracking if Simulated paper trading or Live trading is active
- `theme` — Layout theme: `'light'` (Excel spreadsheet look) or `'dark'` (premium terminal look)
- Actions: `updateTick()`, `setNifty()`, `setBankNifty()`, `setSensex()`, `setIndiaVix()`, `setOptionChain()`, `squareOff()`, `executeStrategy()`, `setActiveView()`, `togglePaperTrade()`, `fetchPaperTradeStatus()`, `toggleTheme()`

**`usePortfolioStore`** (portfolio):
- Portfolio state, manual simulation legs, and P&L/scenario visualization data

**`useOMSStore`** (OMS/RMS simulation):
- `orders[]` — Placed simulation orders
- `fills[]` — Executed trade fills
- `marketPrices{}` — Tracked LTP / market prices per key
- Actions: `addOrder()`, `addFill()`, `updateMarketPrice()`, `getDerivedPositions()`, `getPositionSummaries()`

### Premium Lock Screen & Trading PIN Security
- Renders a secure keypad overlay (`App.jsx`) if `sessionStorage.getItem('terminal_unlocked')` is not `true`.
- Prevents live data fetching (`useTickStream`, `useLiveData`) from starting before unlock.
- Validates the 4-digit Trading PIN against the backend `/api/verify-pin` endpoint.
- virtual keypad (0-9, CLEAR, backspace) and keyboard listener support.
- Displays visual errors and a shake animation on invalid attempts.

### Gateway Connection Watchdog
- A polling task checks `/health` every 5 seconds.
- Displays a status bar showing:
  - `GATEWAY ONLINE` (green indicator dot)
  - `GATEWAY OFFLINE` (pinging red indicator dot)
- Renders recovery tips (e.g. running `start_trading.bat`) if the backend goes offline.

### Global Keyboard Shortcuts
Global shortcuts are active in `UnlockedApp` to allow ultra-fast order placement:
- **`F1`**: Instantly triggers Buy order modal for the ATM Call Option (CE) of the selected underlying.
- **`F2`**: Instantly triggers Sell order modal for the ATM Put Option (PE) of the selected underlying.
- **`Escape`**: Closes the order entry modal.

### Hooks
- `useTickStream()` — WebSocket connection to `/ws/live-feed`
- `useLiveData()` — Polls `/sync-state` for positions/margins
- `useOrdersData()` — Polls `/api/orders` to keep orders grid current
- `useOptionChainData()` — Fetches option chain data from API

---

## 9. Key Libraries & Dependencies

### Python
| Library | Purpose |
|---------|---------|
| `neo_api_client` (NeoAPI) | Kotak Securities trading SDK |
| `fastapi` + `uvicorn` | HTTP API server |
| `websockets` | WebSocket support |
| `pydantic` | Config and payload validation |
| `structlog` | Structured JSON logging |
| `pyotp` | TOTP generation for 2FA |
| `punq` | Dependency injection container |
| `pdfplumber` | Contract note PDF parsing |
| `pandas` | Data manipulation |
| `PyYAML` | Configuration loading |
| `python-telegram-bot` | Telegram notifications |

### JavaScript
| Library | Purpose |
|---------|---------|
| `react` 19 | UI framework |
| `vite` 8 | Build tool |
| `tailwindcss` v4 | Styling |
| `ag-grid-react` v35 | High-performance data tables |
| `zustand` v5 | State management |
| `recharts` v3 | Charts (payoff diagrams) |
| `lucide-react` | Icons |

---

## 10. Exchange Segment Rules

| Underlying | Exchange | Segment Code | Expiry Day |
|------------|----------|-------------|------------|
| NIFTY | NSE | `nse_fo` | Tuesday |
| BANKNIFTY | NSE | `nse_fo` | Tuesday |
| FINNIFTY | NSE | `nse_fo` | Tuesday |
| MIDCPNIFTY | NSE | `nse_fo` | Tuesday |
| All stock options | NSE | `nse_fo` | Tuesday |
| SENSEX | BSE | `bse_fo` | Thursday |
| BANKEX | BSE | `bse_fo` | Thursday |

**Critical**: When fetching option chains, quotes, or placing orders for SENSEX/BANKEX, always use `exchange_segment="bse_fo"`.

---

## 11. Trading Hours

| Event | Time (IST) |
|-------|-----------|
| Pre-open | 09:00 - 09:15 |
| Market open | 09:15 |
| Strategy entry window 1 | 09:25 |
| Strategy entry window 2 | 13:05 |
| Strategy auto square-off | 15:15 |
| Market close | 15:30 |
| Post-market data save | 15:30:30 |

---

## 12. Error Handling & Reliability

### Exception Hierarchy
```
AlgoError (base)
├── BrokerError
│   ├── AuthenticationError (recoverable)
│   ├── SessionExpiredError (recoverable → auto re-auth)
│   ├── OrderRejectedError (non-recoverable)
│   ├── DuplicateOrderError (non-recoverable)
│   └── APIResponseError (recoverable)
├── DataError
│   ├── InvalidMarketDataError (recoverable)
│   └── StaleDataError (recoverable)
├── RiskError (non-recoverable)
│   ├── DailyLossBreachedError
│   └── MaxPositionsError
└── WebSocketError
    ├── ConnectionLostError (recoverable)
    └── ReconnectFailedError (non-recoverable)
```

### Resilience Features
- **Session expired detection**: Heuristic check on API responses for expired signals
- **Circuit breaker**: Prevents hammering dead API (5 failures → 30s open)
- **Auto-reconnect WebSocket**: Exponential backoff, max 20 attempts
- **Heartbeat monitoring**: Force reconnect if no message for 30s
- **Duplicate order prevention**: 10s cooldown per order signature
- **Position reconciliation**: Auto-corrects local vs broker position mismatches
- **Newton-Raphson Bisection Fallback**: Ensures implied volatility is successfully resolved even on deep ITM/OTM strikes by falling back from Newton-Raphson to Bisection search.
- **Telegram alerts**: Critical events notify via Telegram bot

---

## 13. Post-Market Data Archival

After market close (15:30:30 IST), a script saves:
- `positions.json/csv` — Final positions with P&L
- `trades.json/csv` — All executed trades
- `orders.json/csv` — All orders (filled, cancelled, rejected)
- `limits.json/csv` — Margin and fund details

Saved to: `data/post_market_data/YYYY-MM-DD/`

---

## 14. Common Gotchas & Notes

1. **Paper trade mode**: `config.yaml → risk.paper_trade: true` means all orders are simulated. This can be toggled dynamically from the dashboard header (requires user confirmation when enabling Live mode) and persists to both memory and `config.yaml`.
2. **SENSEX/BANKEX exchange segment**: Must use `bse_fo`, not `nse_fo`. This is handled dynamically in `api.py` line ~467.
3. **Expiry parsing**: `parse_expiry()` in `position_tracker.py` handles both weekly (YYMMDD) and monthly (YYMM) contract formats.
4. **May 28, 2026 holiday**: Special handling — SENSEX expiry shifts to May 27 (Wednesday), NIFTY expiry stays May 26 (Tuesday).
5. **AG Grid v35**: Requires explicit `ModuleRegistry.registerModules([AllCommunityModule])` in `main.jsx`.
6. **Option chain data sources**: Priority is Kotak Neo API → NSE Scraper → Error 503.
7. **Instrument DB sync**: Runs automatically on API server startup. Contracts are fetched from Kotak Neo and stored in SQLite.
8. **Structured logging**: All backend logs are JSON (structlog). Parse with `jq` or structured log viewers.
9. **No routing library**: Dashboard uses conditional rendering, not React Router.
10. **Kill switch**: `POST /square-off-all` or `RiskManager.activate_kill_switch()` exits everything immediately.
11. **OMS/RMS Position Engine Simulation**: In the OMS view, order execution, FIFO matching, position flipping, and PNL calculation are computed locally on the client-side using `useOMSStore.ts` and `positionEngine.ts`. It does not execute live trades on the server or broker.
12. **Start Helper Script**: The local services can be quickly launched using `start_trading.bat` in the project root.
13. **Trading PIN Bypass**: Access to the dashboard is blocked until the 4-digit PIN (default: `1234`) is verified against `/api/verify-pin`. The unlock status is cached in the browser's `sessionStorage`.

---

## 15. Critical Risk & Compliance Considerations (SEBI & Broker Limits)

To comply with SEBI algorithmic trading guidelines and handle broker-specific API behaviors/limitations of the Kotak Securities Neo SDK, the system enforces three critical risk middleware structures:

### 15.1 Order Slicing for Quantity Freezes (`broker/order_manager.py`)
- **Quantity Freeze Limits**: The Indian stock exchanges (NSE and BSE) enforce maximum quantity limits per order (e.g., 1800 shares for NIFTY, 1200 for BANKNIFTY) to prevent runaway orders.
- **Order Slicing Engine**: When placing an order, `OrderManager` evaluates the total quantity against the contract specifications. If the quantity exceeds the freeze limit, it automatically slices the order into consecutive, exchange-compliant chunks (e.g., slicing a NIFTY order of 3000 shares into three orders of `[1170, 1170, 660]` assuming 1170 is the current freeze threshold in `nse_reference.py`).

### 15.2 Broker Rate Limiting & Cooldowns
- **Message-to-Order Ratio (MOR)**: Exchange-level rules penalize accounts with high modifications or cancels relative to executions.
- **Modification Throttling**: The repricing loops inside `OrderManager` and modifications done via `PUT /api/orders/{order_id}` are governed by a minimum 2-second throttling cooldown to prevent hitting Kotak Neo API limits and avoid MOR penalties.

### 15.3 Margin Peak & Execution Sequence
- **Execution Sequencing (Entry)**: For multi-leg strategies (Straddles, Strangles, Iron Condors), order legs are executed sequentially to optimize margin requirements. Buy legs (Long options / Hedges) must be executed and confirmed filled *first*, followed by Sell legs (Short options / Writing) to ensure the broker's risk system acknowledges hedging benefits, avoiding order rejections due to insufficient margin.
- **Execution Sequencing (Exit)**: During strategy `square_off()`, Sell/Short legs are exited *first* to release liabilities and margin, followed by Buy/Long legs (hedges) *second*. This avoids margin spikes and potential real-time margin penalty rejections on closure.

### 15.4 Strategy Recovery Engine (`strategies/base_strategy.py`)
- **Crash Recovery**: When the FastAPI server restarts, `_recover_strategy()` is executed inside the background daemon thread.
- **State Restoration**:
  - Compares local database records and active strategy configurations with live broker positions.
  - Matches open legs by underlying symbol. If active open positions exist, it transitions the strategy state to `StrategyState.IN_TRADE` and reconstructs the memory leg representations.
  - If no open positions are found but active orders exist, it transitions to `StrategyState.ENTERING` to avoid duplicate order loops. Otherwise, it resets to `StrategyState.IDLE`.

## 16. Localized Historical Backtesting Sandbox Module

The localized historical simulation sandbox module allows developers to dry-run and backtest options trading strategies, adjustments, stop losses, and rebalancing loops over historical 1-minute spot tick bars without live market or broker dependencies.

### 16.1 Sandbox Components
- **Simulation Engine (`kotak_algo/core/backtest_sandbox.py`)**: Uses sqlite3 to fetch 1-minute historical spot ticks from the `historical_ticks` table in `contracts.db` (automatically generates synthetic ticks if empty). It drives a step-by-step loop simulating spot price, option pricing via the Black-Scholes engine, order submission/execution, stop losses, adjustments, and rebalancing.
- **Order Manager Simulation**: Simulates order placement, status updates, and fills locally via paper-trading flags immediately.
- **Greeks & Pricing simulation**: Recalculates exact Black-Scholes option prices and Greeks dynamically based on simulated spot values and remaining fractional time-to-expiry (DTE).
- **FastAPI Sandbox Controller (`api.py`)**: Exposes `POST /api/backtest` to allow the React dashboard to trigger and display sandbox simulation reports (P&L, execution events, orders).

### 16.2 Executing Sandbox Tests
Run unit tests for the backtest sandbox via:
```bash
python -m unittest scratch/test_backtest_sandbox.py
```
Or run the simulation runner script:
```bash
python scratch/run_backtest_sandbox.py
```

---

## 17. AI Agent Maintenance Guidelines

When deploying automated scripts, creating scratch files, or modifying code as an agent, you must adhere to these structural boundaries:

1. **Do Not Modify contract_specifications.md Manually**: Database contracts, ex-dividend calculations, and expiration date-shifting logic are managed dynamically. Changes to contract specifications or lot sizes must be processed by the synchronization services (`instruments/fetchers/`) to update `contracts.db` automatically.
2. **OMS State Isolation**: The React dashboard uses a separate Zustand store (`useOMSStore`) for the OMS Simulator. This simulated state must remain completely isolated from `useTerminalStore` to prevent simulated orders from leaking into live trade signals or vice versa.


