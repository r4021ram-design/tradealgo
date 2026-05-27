# NSE & BSE Derivative Expiry Rules (2026)

This document serves as the single source of truth for index and stock derivative expiry rules in this repository. All core and components (Python backend & React frontend) must conform to these rules.

## 1. National Stock Exchange (NSE)
*   **Designated Expiry Day**: **Tuesday**
    *   Applies to all weekly and monthly contracts for **Nifty 50**, **Bank Nifty**, **Fin Nifty**, **Midcap Nifty**, etc.
    *   Applies to all individual stock options and stock futures.
*   **Holiday Rule**: If Tuesday is a market holiday, the contract expiry shifts to the preceding business day (**Monday**).

## 2. Bombay Stock Exchange (BSE)
*   **Designated Expiry Day**: **Thursday**
    *   Applies to all weekly and monthly contracts for **SENSEX** and **BANKEX**.
*   **Holiday Rule**: If Thursday is a market holiday, the contract expiry shifts to the preceding business day (**Wednesday**).

---

## 3. Reference Implementation Details

### Python Backend
*   Implemented in `kotak_algo/core/position_tracker.py` -> `parse_expiry(expiry_clean_str, underlying)`
*   Uses `calendar.TUESDAY` (1) for NSE underlyings and `calendar.THURSDAY` (3) for BSE underlyings (`SENSEX`, `BANKEX`).
*   Shifts expiry date backwards day-by-day in a loop if the date is a weekend or listed in `HOLIDAYS_2026`.

### React Frontend
*   Implemented in `dashboard/src/components/portfolio/OptionPortfolioManager.jsx` -> `parseOptionSymbol(symbol)`
*   Uses JavaScript day numbers: `2` (Tuesday) for NSE underlyings and `4` (Thursday) for BSE underlyings (`SENSEX`, `BANKEX`).
*   Applies a special exception shift to Wednesday (May 27) for any SENSEX/BANKEX contract falling on the Buddha Purnima holiday (Thursday, May 28, 2026).
