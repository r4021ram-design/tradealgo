# KotakAlgo — Agent Instructions

## MANDATORY FIRST STEP
Before making ANY code changes, read `.agent/ARCHITECTURE.md` for the complete system architecture, file structure, data flows, and business rules.

## Quick Reference
- **Backend**: Python FastAPI (`kotak_algo/api.py`) + AlgoApp engine (`kotak_algo/main.py`)
- **Frontend**: React + Vite + TailwindCSS v4 (`dashboard/`)
- **Broker**: Kotak Securities Neo API (`kotak_algo/broker/neo_client.py`)
- **Database**: SQLite (`kotak_algo/instruments/data/contracts.db`)
- **Config**: `kotak_algo/config.yaml` (env vars from `kotak_algo/.env`)
- **Expiry Rules**: `.agent/contract_specifications.md`

## Critical Rules
1. NSE derivatives expire on **Tuesday**. BSE (SENSEX/BANKEX) expire on **Thursday**.
2. Use `exchange_segment="bse_fo"` for SENSEX/BANKEX, `"nse_fo"` for everything else.
3. `paper_trade: true` in config means simulated orders — check before assuming live trading.
4. All backend logging uses **structlog** (JSON format).
5. The dashboard state is managed with **Zustand** stores, not Redux or Context.
6. AG Grid v35 requires explicit module registration in `main.jsx`.

## Running the System
```bash
# Backend
cd kotakalgo && python -m uvicorn kotak_algo.api:app --host 127.0.0.1 --port 8000

# Frontend
cd kotakalgo/dashboard && npm run dev
```
