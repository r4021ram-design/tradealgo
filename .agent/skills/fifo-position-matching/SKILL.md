---
name: fifo-position-matching
description: "Instructions and guide for maintaining, extending, and testing the FIFO trading position matching engine, position flipping logic, and MTM/PNL calculations."
---

# FIFO Position Matching & OMS Engine

## Overview
This skill provides the structure, rules, and workflows for maintaining and extending the trading position engine (OMS/RMS behavior) on the frontend. The engine handles FIFO position matching, position flipping (e.g. from LONG to SHORT), segment-specific expiration rules, and computes Realized/Unrealized PNL dynamically.

## Key Components

### 1. Types & Registry
- [OrderBookGrid.tsx](file:///c:/Users/admin/Desktop/kotakalgo/dashboard/src/components/oms/OrderBookGrid.tsx): Grid showing order book history (with newly added inline modification, cancellation, and manual fill action buttons).
- [NetPositionWindow.tsx](file:///c:/Users/admin/Desktop/kotakalgo/dashboard/src/components/oms/NetPositionWindow.tsx): Visualizes overall portfolio PNL metrics (realized/unrealized/MTM), allows manually entering simulation orders (supporting initial status of FILLED or PENDING), updating LTPs, and triggering preset test cases.
- [FilterBar.tsx](file:///c:/Users/admin/Desktop/kotakalgo/dashboard/src/components/oms/FilterBar.tsx): Quick filtering panel by segment, expiry, strike, and call/put option types.
- [types.ts](file:///c:/Users/admin/Desktop/kotakalgo/dashboard/src/engine/types.ts): Contains types for `Instrument`, `Order`, `Fill`, `OpenTrade` (the FIFO queue entries), `ClosedTrade` (matched entry/exit pairs), and `PositionSummary`.
- [instrumentRegistry.ts](file:///c:/Users/admin/Desktop/kotakalgo/dashboard/src/engine/instrumentRegistry.ts): Generates unique position keys based on segment properties:
  - `EQ`: `{Symbol}_EQ`
  - `FUT`: `{Symbol}_FUT_{Expiry}`
  - `OPT`: `{Symbol}_OPT_{Expiry}_{Strike}_{Type}`

### 2. Matching Engine (`positionEngine.ts`)
- [positionEngine.ts](file:///c:/Users/admin/Desktop/kotakalgo/dashboard/src/engine/positionEngine.ts) contains pure logic functions:
  - `computePositionsFromFills(fills)`: Matches BUY and SELL fills in chronological order. Uses a FIFO queue of open fills. Handles partial matches and **position flips** (e.g. holding 100 BUY, receiving 150 SELL -> closes 100 BUY, opens 50 SELL).
  - `calculatePositionSummaries(derivedPositions, marketPrices)`: Calculates Realized PNL, Unrealized PNL, and MTM based on LATEST TICK PRICES (LTP).
    - **LONG Unrealized PnL**: `(LTP - Avg Entry Price) * Net Qty`
    - **SHORT Unrealized PnL**: `(Avg Entry Price - LTP) * |Net Qty|`

### 3. Layout Integration
- [TopBar.jsx](file:///c:/Users/admin/Desktop/kotakalgo/dashboard/src/components/layout/TopBar.jsx): Embedded a premium navigation tab switch for toggling between the **Live Terminal** and the **OMS Position Engine**.
- [App.jsx](file:///c:/Users/admin/Desktop/kotakalgo/dashboard/src/App.jsx): Dynamically renders either view based on the navigation state.

## Verification & Build
We ran a clean production build (`npm run build`) in `dashboard/` which successfully built the entire codebase with zero errors:
```bash
vite v8.0.10 building client environment for production...
✓ built in 1.83s
```

## Expiry & Segment Rules
- **NSE** derivatives expire on **Tuesday**. BSE (**SENSEX/BANKEX**) expire on **Thursday**.
- In option symbol parsing, verify exchange segment formatting: `"nse_fo"` for NSE underlyings, `"bse_fo"` for SENSEX/BANKEX underlyings.
- Preceding holiday rule shifts expiration to Monday (NSE) or Wednesday (BSE) if the designated day is a holiday.

## Workflow: Extending & Testing

### 1. Extending the Engine
When adding support for new segments or order behaviors:
1. Update `Instrument` types in `types.ts`.
2. Update key generation in `instrumentRegistry.ts`.
3. Add corresponding matching test cases to the **Order Simulator Preset Scenarios** inside `NetPositionWindow.tsx`.

### 2. Manual Verification & Testing
1. Start the Vite dev server (`npm run dev`).
2. Switch from **LIVE TERMINAL** to the **OMS POSITION ENGINE** view in the top navigation bar.
3. Use the **Order Simulator** to execute custom orders or trigger preset test cases:
   - **FIFO Matching**: Validates normal FIFO entry, partial exit, and multiple fills matching.
   - **Position Flip**: Validates long-to-short flipping, resulting in correct realized PNL and leftover opposite positions.
   - **Multi-Segment**: Validates simultaneous options, futures, and equities tracking.
4. Verify overall **TOTAL MTM** and check calculations against expectations.

## Common Mistakes
- **Direct Mutating State**: Never mutate the orders/fills state array directly. Always use Zustand actions (which leverage immutable state updates).
- **Hardcoding Expiries**: Do not assume expiries always land on the standard weekday without checking the holiday registry (`HOLIDAYS_2026`).
- **Ignoring LTP Key Matching**: Ensure that the symbol key used to update market tick prices matches the generated position key format exactly.
