# NSE & BSE Derivative Contract Specifications (2026)

This document serves as the single source of truth for all index and stock derivative specifications, lot sizes, and expiry rules in the KotakAlgo system.

---

## 1. Exchange Segments & Mappings

| Exchange | Derivative Type | Exchange Segment | Typical Underlyings |
| :--- | :--- | :--- | :--- |
| **NSE** | Index & Stock Derivatives | `"nse_fo"` | NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, Stock Options |
| **BSE** | Index Derivatives | `"bse_fo"` | SENSEX, BANKEX |

---

## 2. Expiry Rules & Schedules

### Index Derivatives
*   **NSE Indices (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50)**: **Tuesday** Expiry
*   **BSE Indices (SENSEX, BANKEX)**: **Thursday** Expiry
*   **Holiday Rule**: If the scheduled expiry day is a market holiday, the contract shifts to the **preceding business day** (Monday for NSE, Wednesday for BSE).

### Stock Derivatives
*   **Designated Expiry Day**: **Tuesday**
    *   Applies to all individual stock options and stock futures listed on NSE.
*   **Holiday Rule**: If Tuesday is a market holiday, the contract shifts to the **preceding business day** (Monday).

---

## 3. Index Lot Sizes

| Index Symbol | Segment | Instrument Type | Lot Size | Expiry Day |
| :--- | :--- | :--- | :---: | :--- |
| **BANKEX** | `bse_fo` | OPTIDX / FUTIDX | **30** | Thursday |
| **BANKNIFTY** | `nse_fo` | OPTIDX / FUTIDX | **30** | Tuesday |
| **FINNIFTY** | `nse_fo` | OPTIDX / FUTIDX | **60** | Tuesday |
| **MIDCPNIFTY** | `nse_fo` | OPTIDX / FUTIDX | **120** | Tuesday |
| **NIFTY** | `nse_fo` | OPTIDX / FUTIDX | **65** | Tuesday |
| **NIFTYNXT50** | `nse_fo` | OPTIDX / FUTIDX | **25** | Tuesday |
| **SENSEX** | `bse_fo` | OPTIDX / FUTIDX | **20** | Thursday |

---

## 4. Individual Stock Lot Sizes

There are **254** active stock options and futures instruments configured. Below is the complete, official lot size database:

| Stock Symbol | Instrument Type | Lot Size | Expiry Day |
| :--- | :--- | :---: | :--- |
| **360ONE** | OPTSTK / FUTSTK | **500** | Tuesday |
| **ABB** | OPTSTK / FUTSTK | **125** | Tuesday |
| **ABCAPITAL** | OPTSTK / FUTSTK | **3100** | Tuesday |
| **ADANIENSOL** | OPTSTK / FUTSTK | **675** | Tuesday |
| **ADANIENT** | OPTSTK / FUTSTK | **309** | Tuesday |
| **ADANIGREEN** | OPTSTK / FUTSTK | **600** | Tuesday |
| **ADANIPORTS** | OPTSTK / FUTSTK | **475** | Tuesday |
| **ADANIPOWER** | OPTSTK / FUTSTK | **3550** | Tuesday |
| **ALKEM** | OPTSTK / FUTSTK | **125** | Tuesday |
| **AMBER** | OPTSTK / FUTSTK | **100** | Tuesday |
| **AMBUJACEM** | OPTSTK / FUTSTK | **1050** | Tuesday |
| **AMBUJACEM** | OPTSTK / FUTSTK | **1200** | Tuesday |
| **ANGELONE** | OPTSTK / FUTSTK | **2500** | Tuesday |
| **APLAPOLLO** | OPTSTK / FUTSTK | **350** | Tuesday |
| **APOLLOHOSP** | OPTSTK / FUTSTK | **125** | Tuesday |
| **ASHOKLEY** | OPTSTK / FUTSTK | **5000** | Tuesday |
| **ASIANPAINT** | OPTSTK / FUTSTK | **250** | Tuesday |
| **ASTRAL** | OPTSTK / FUTSTK | **425** | Tuesday |
| **AUBANK** | OPTSTK / FUTSTK | **1000** | Tuesday |
| **AUROPHARMA** | OPTSTK / FUTSTK | **550** | Tuesday |
| **AXISBANK** | OPTSTK / FUTSTK | **625** | Tuesday |
| **BAJAJ-AUTO** | OPTSTK / FUTSTK | **75** | Tuesday |
| **BAJAJFINSV** | OPTSTK / FUTSTK | **250** | Tuesday |
| **BAJAJFINSV** | OPTSTK / FUTSTK | **300** | Tuesday |
| **BAJAJHLDNG** | OPTSTK / FUTSTK | **50** | Tuesday |
| **BAJAJHLDNG** | OPTSTK / FUTSTK | **75** | Tuesday |
| **BAJFINANCE** | OPTSTK / FUTSTK | **750** | Tuesday |
| **BANDHANBNK** | OPTSTK / FUTSTK | **3600** | Tuesday |
| **BANKBARODA** | OPTSTK / FUTSTK | **2925** | Tuesday |
| **BANKINDIA** | OPTSTK / FUTSTK | **5200** | Tuesday |
| **BDL** | OPTSTK / FUTSTK | **350** | Tuesday |
| **BDL** | OPTSTK / FUTSTK | **425** | Tuesday |
| **BEL** | OPTSTK / FUTSTK | **1425** | Tuesday |
| **BHARATFORG** | OPTSTK / FUTSTK | **500** | Tuesday |
| **BHARTIARTL** | OPTSTK / FUTSTK | **475** | Tuesday |
| **BHEL** | OPTSTK / FUTSTK | **2625** | Tuesday |
| **BIOCON** | OPTSTK / FUTSTK | **2500** | Tuesday |
| **BLUESTARCO** | OPTSTK / FUTSTK | **325** | Tuesday |
| **BOSCHLTD** | OPTSTK / FUTSTK | **25** | Tuesday |
| **BPCL** | OPTSTK / FUTSTK | **1975** | Tuesday |
| **BRITANNIA** | OPTSTK / FUTSTK | **125** | Tuesday |
| **BSE** | OPTSTK / FUTSTK | **375** | Tuesday |
| **BSE** | OPTSTK / FUTSTK | **200** | Tuesday |
| **CAMS** | OPTSTK / FUTSTK | **750** | Tuesday |
| **CAMS** | OPTSTK / FUTSTK | **825** | Tuesday |
| **CANBK** | OPTSTK / FUTSTK | **6750** | Tuesday |
| **CDSL** | OPTSTK / FUTSTK | **475** | Tuesday |
| **CGPOWER** | OPTSTK / FUTSTK | **850** | Tuesday |
| **CHOLAFIN** | OPTSTK / FUTSTK | **625** | Tuesday |
| **CIPLA** | OPTSTK / FUTSTK | **375** | Tuesday |
| **CIPLA** | OPTSTK / FUTSTK | **425** | Tuesday |
| **COALINDIA** | OPTSTK / FUTSTK | **1350** | Tuesday |
| **COCHINSHIP** | OPTSTK / FUTSTK | **400** | Tuesday |
| **COFORGE** | OPTSTK / FUTSTK | **375** | Tuesday |
| **COFORGE** | OPTSTK / FUTSTK | **475** | Tuesday |
| **COLPAL** | OPTSTK / FUTSTK | **225** | Tuesday |
| **COLPAL** | OPTSTK / FUTSTK | **275** | Tuesday |
| **CONCOR** | OPTSTK / FUTSTK | **1250** | Tuesday |
| **CROMPTON** | OPTSTK / FUTSTK | **1800** | Tuesday |
| **CROMPTON** | OPTSTK / FUTSTK | **2150** | Tuesday |
| **CUMMINSIND** | OPTSTK / FUTSTK | **200** | Tuesday |
| **DABUR** | OPTSTK / FUTSTK | **1250** | Tuesday |
| **DALBHARAT** | OPTSTK / FUTSTK | **325** | Tuesday |
| **DELHIVERY** | OPTSTK / FUTSTK | **2075** | Tuesday |
| **DIVISLAB** | OPTSTK / FUTSTK | **100** | Tuesday |
| **DIXON** | OPTSTK / FUTSTK | **50** | Tuesday |
| **DLF** | OPTSTK / FUTSTK | **950** | Tuesday |
| **DLF** | OPTSTK / FUTSTK | **825** | Tuesday |
| **DMART** | OPTSTK / FUTSTK | **150** | Tuesday |
| **DRREDDY** | OPTSTK / FUTSTK | **625** | Tuesday |
| **EICHERMOT** | OPTSTK / FUTSTK | **100** | Tuesday |
| **ETERNAL** | OPTSTK / FUTSTK | **2425** | Tuesday |
| **EXIDEIND** | OPTSTK / FUTSTK | **1800** | Tuesday |
| **FEDERALBNK** | OPTSTK / FUTSTK | **2500** | Tuesday |
| **FORCEMOT** | OPTSTK / FUTSTK | **25** | Tuesday |
| **FORTIS** | OPTSTK / FUTSTK | **775** | Tuesday |
| **GAIL** | OPTSTK / FUTSTK | **3150** | Tuesday |
| **GAIL** | OPTSTK / FUTSTK | **3550** | Tuesday |
| **GLENMARK** | OPTSTK / FUTSTK | **375** | Tuesday |
| **GMRAIRPORT** | OPTSTK / FUTSTK | **6975** | Tuesday |
| **GODFRYPHLP** | OPTSTK / FUTSTK | **275** | Tuesday |
| **GODREJCP** | OPTSTK / FUTSTK | **500** | Tuesday |
| **GODREJPROP** | OPTSTK / FUTSTK | **275** | Tuesday |
| **GODREJPROP** | OPTSTK / FUTSTK | **325** | Tuesday |
| **GRASIM** | OPTSTK / FUTSTK | **250** | Tuesday |
| **HAL** | OPTSTK / FUTSTK | **150** | Tuesday |
| **HAVELLS** | OPTSTK / FUTSTK | **500** | Tuesday |
| **HCLTECH** | OPTSTK / FUTSTK | **350** | Tuesday |
| **HCLTECH** | OPTSTK / FUTSTK | **400** | Tuesday |
| **HDFCAMC** | OPTSTK / FUTSTK | **300** | Tuesday |
| **HDFCBANK** | OPTSTK / FUTSTK | **550** | Tuesday |
| **HDFCBANK** | OPTSTK / FUTSTK | **650** | Tuesday |
| **HDFCLIFE** | OPTSTK / FUTSTK | **1100** | Tuesday |
| **HEROMOTOCO** | OPTSTK / FUTSTK | **150** | Tuesday |
| **HINDALCO** | OPTSTK / FUTSTK | **700** | Tuesday |
| **HINDPETRO** | OPTSTK / FUTSTK | **2025** | Tuesday |
| **HINDUNILVR** | OPTSTK / FUTSTK | **300** | Tuesday |
| **HINDZINC** | OPTSTK / FUTSTK | **1225** | Tuesday |
| **HYUNDAI** | OPTSTK / FUTSTK | **275** | Tuesday |
| **ICICIBANK** | OPTSTK / FUTSTK | **700** | Tuesday |
| **ICICIGI** | OPTSTK / FUTSTK | **325** | Tuesday |
| **ICICIPRULI** | OPTSTK / FUTSTK | **925** | Tuesday |
| **IDEA** | OPTSTK / FUTSTK | **71475** | Tuesday |
| **IDFCFIRSTB** | OPTSTK / FUTSTK | **9275** | Tuesday |
| **IEX** | OPTSTK / FUTSTK | **4350** | Tuesday |
| **IEX** | OPTSTK / FUTSTK | **3750** | Tuesday |
| **INDHOTEL** | OPTSTK / FUTSTK | **1000** | Tuesday |
| **INDIANB** | OPTSTK / FUTSTK | **1000** | Tuesday |
| **INDIGO** | OPTSTK / FUTSTK | **150** | Tuesday |
| **INDUSINDBK** | OPTSTK / FUTSTK | **700** | Tuesday |
| **INDUSTOWER** | OPTSTK / FUTSTK | **1700** | Tuesday |
| **INFY** | OPTSTK / FUTSTK | **400** | Tuesday |
| **INOXWIND** | OPTSTK / FUTSTK | **6400** | Tuesday |
| **INOXWIND** | OPTSTK / FUTSTK | **3575** | Tuesday |
| **IOC** | OPTSTK / FUTSTK | **4875** | Tuesday |
| **IREDA** | OPTSTK / FUTSTK | **3450** | Tuesday |
| **IREDA** | OPTSTK / FUTSTK | **4525** | Tuesday |
| **IRFC** | OPTSTK / FUTSTK | **4250** | Tuesday |
| **IRFC** | OPTSTK / FUTSTK | **5425** | Tuesday |
| **ITC** | OPTSTK / FUTSTK | **1600** | Tuesday |
| **ITC** | OPTSTK / FUTSTK | **1725** | Tuesday |
| **JINDALSTEL** | OPTSTK / FUTSTK | **625** | Tuesday |
| **JIOFIN** | OPTSTK / FUTSTK | **2350** | Tuesday |
| **JSWENERGY** | OPTSTK / FUTSTK | **1000** | Tuesday |
| **JSWENERGY** | OPTSTK / FUTSTK | **1075** | Tuesday |
| **JSWSTEEL** | OPTSTK / FUTSTK | **675** | Tuesday |
| **JUBLFOOD** | OPTSTK / FUTSTK | **1250** | Tuesday |
| **KALYANKJIL** | OPTSTK / FUTSTK | **1175** | Tuesday |
| **KALYANKJIL** | OPTSTK / FUTSTK | **1350** | Tuesday |
| **KAYNES** | OPTSTK / FUTSTK | **150** | Tuesday |
| **KAYNES** | OPTSTK / FUTSTK | **100** | Tuesday |
| **KEI** | OPTSTK / FUTSTK | **175** | Tuesday |
| **KFINTECH** | OPTSTK / FUTSTK | **500** | Tuesday |
| **KFINTECH** | OPTSTK / FUTSTK | **575** | Tuesday |
| **KOTAKBANK** | OPTSTK / FUTSTK | **2000** | Tuesday |
| **KPITTECH** | OPTSTK / FUTSTK | **425** | Tuesday |
| **KPITTECH** | OPTSTK / FUTSTK | **775** | Tuesday |
| **LAURUSLABS** | OPTSTK / FUTSTK | **850** | Tuesday |
| **LICHSGFIN** | OPTSTK / FUTSTK | **1000** | Tuesday |
| **LICI** | OPTSTK / FUTSTK | **700** | Tuesday |
| **LODHA** | OPTSTK / FUTSTK | **450** | Tuesday |
| **LODHA** | OPTSTK / FUTSTK | **625** | Tuesday |
| **LT** | OPTSTK / FUTSTK | **175** | Tuesday |
| **LTF** | OPTSTK / FUTSTK | **2250** | Tuesday |
| **LTM** | OPTSTK / FUTSTK | **150** | Tuesday |
| **LUPIN** | OPTSTK / FUTSTK | **425** | Tuesday |
| **M&M** | OPTSTK / FUTSTK | **200** | Tuesday |
| **MANAPPURAM** | OPTSTK / FUTSTK | **3000** | Tuesday |
| **MANKIND** | OPTSTK / FUTSTK | **250** | Tuesday |
| **MANKIND** | OPTSTK / FUTSTK | **225** | Tuesday |
| **MARICO** | OPTSTK / FUTSTK | **1200** | Tuesday |
| **MARUTI** | OPTSTK / FUTSTK | **50** | Tuesday |
| **MAXHEALTH** | OPTSTK / FUTSTK | **525** | Tuesday |
| **MAZDOCK** | OPTSTK / FUTSTK | **200** | Tuesday |
| **MAZDOCK** | OPTSTK / FUTSTK | **225** | Tuesday |
| **MCX** | OPTSTK / FUTSTK | **625** | Tuesday |
| **MCX** | OPTSTK / FUTSTK | **225** | Tuesday |
| **MFSL** | OPTSTK / FUTSTK | **400** | Tuesday |
| **MOTHERSON** | OPTSTK / FUTSTK | **6150** | Tuesday |
| **MOTILALOFS** | OPTSTK / FUTSTK | **775** | Tuesday |
| **MPHASIS** | OPTSTK / FUTSTK | **275** | Tuesday |
| **MUTHOOTFIN** | OPTSTK / FUTSTK | **275** | Tuesday |
| **NAM-INDIA** | OPTSTK / FUTSTK | **625** | Tuesday |
| **NATIONALUM** | OPTSTK / FUTSTK | **1875** | Tuesday |
| **NAUKRI** | OPTSTK / FUTSTK | **375** | Tuesday |
| **NAUKRI** | OPTSTK / FUTSTK | **550** | Tuesday |
| **NBCC** | OPTSTK / FUTSTK | **6500** | Tuesday |
| **NESTLEIND** | OPTSTK / FUTSTK | **500** | Tuesday |
| **NHPC** | OPTSTK / FUTSTK | **6400** | Tuesday |
| **NHPC** | OPTSTK / FUTSTK | **6950** | Tuesday |
| **NMDC** | OPTSTK / FUTSTK | **6750** | Tuesday |
| **NTPC** | OPTSTK / FUTSTK | **1500** | Tuesday |
| **NUVAMA** | OPTSTK / FUTSTK | **500** | Tuesday |
| **NYKAA** | OPTSTK / FUTSTK | **3125** | Tuesday |
| **OBEROIRLTY** | OPTSTK / FUTSTK | **350** | Tuesday |
| **OFSS** | OPTSTK / FUTSTK | **75** | Tuesday |
| **OFSS** | OPTSTK / FUTSTK | **100** | Tuesday |
| **OIL** | OPTSTK / FUTSTK | **1400** | Tuesday |
| **ONGC** | OPTSTK / FUTSTK | **2250** | Tuesday |
| **PAGEIND** | OPTSTK / FUTSTK | **15** | Tuesday |
| **PAGEIND** | OPTSTK / FUTSTK | **20** | Tuesday |
| **PATANJALI** | OPTSTK / FUTSTK | **900** | Tuesday |
| **PATANJALI** | OPTSTK / FUTSTK | **1075** | Tuesday |
| **PAYTM** | OPTSTK / FUTSTK | **725** | Tuesday |
| **PERSISTENT** | OPTSTK / FUTSTK | **100** | Tuesday |
| **PERSISTENT** | OPTSTK / FUTSTK | **125** | Tuesday |
| **PETRONET** | OPTSTK / FUTSTK | **1900** | Tuesday |
| **PFC** | OPTSTK / FUTSTK | **1300** | Tuesday |
| **PGEL** | OPTSTK / FUTSTK | **950** | Tuesday |
| **PHOENIXLTD** | OPTSTK / FUTSTK | **350** | Tuesday |
| **PIDILITIND** | OPTSTK / FUTSTK | **500** | Tuesday |
| **PIIND** | OPTSTK / FUTSTK | **175** | Tuesday |
| **PNB** | OPTSTK / FUTSTK | **8000** | Tuesday |
| **PNBHOUSING** | OPTSTK / FUTSTK | **650** | Tuesday |
| **POLICYBZR** | OPTSTK / FUTSTK | **350** | Tuesday |
| **POLYCAB** | OPTSTK / FUTSTK | **125** | Tuesday |
| **POWERGRID** | OPTSTK / FUTSTK | **1900** | Tuesday |
| **POWERINDIA** | OPTSTK / FUTSTK | **25** | Tuesday |
| **PREMIERENE** | OPTSTK / FUTSTK | **575** | Tuesday |
| **PREMIERENE** | OPTSTK / FUTSTK | **650** | Tuesday |
| **PRESTIGE** | OPTSTK / FUTSTK | **450** | Tuesday |
| **RBLBANK** | OPTSTK / FUTSTK | **3175** | Tuesday |
| **RECLTD** | OPTSTK / FUTSTK | **1400** | Tuesday |
| **RECLTD** | OPTSTK / FUTSTK | **1575** | Tuesday |
| **RELIANCE** | OPTSTK / FUTSTK | **500** | Tuesday |
| **RVNL** | OPTSTK / FUTSTK | **1525** | Tuesday |
| **RVNL** | OPTSTK / FUTSTK | **1925** | Tuesday |
| **SAIL** | OPTSTK / FUTSTK | **4700** | Tuesday |
| **SAMMAANCAP** | OPTSTK / FUTSTK | **4300** | Tuesday |
| **SBICARD** | OPTSTK / FUTSTK | **800** | Tuesday |
| **SBILIFE** | OPTSTK / FUTSTK | **375** | Tuesday |
| **SBIN** | OPTSTK / FUTSTK | **750** | Tuesday |
| **SHREECEM** | OPTSTK / FUTSTK | **25** | Tuesday |
| **SHRIRAMFIN** | OPTSTK / FUTSTK | **825** | Tuesday |
| **SIEMENS** | OPTSTK / FUTSTK | **175** | Tuesday |
| **SOLARINDS** | OPTSTK / FUTSTK | **50** | Tuesday |
| **SONACOMS** | OPTSTK / FUTSTK | **1225** | Tuesday |
| **SRF** | OPTSTK / FUTSTK | **200** | Tuesday |
| **SUNPHARMA** | OPTSTK / FUTSTK | **350** | Tuesday |
| **SUPREMEIND** | OPTSTK / FUTSTK | **175** | Tuesday |
| **SUZLON** | OPTSTK / FUTSTK | **12700** | Tuesday |
| **SUZLON** | OPTSTK / FUTSTK | **9025** | Tuesday |
| **SWIGGY** | OPTSTK / FUTSTK | **1300** | Tuesday |
| **SWIGGY** | OPTSTK / FUTSTK | **1825** | Tuesday |
| **TATACONSUM** | OPTSTK / FUTSTK | **550** | Tuesday |
| **TATAELXSI** | OPTSTK / FUTSTK | **100** | Tuesday |
| **TATAELXSI** | OPTSTK / FUTSTK | **125** | Tuesday |
| **TATAPOWER** | OPTSTK / FUTSTK | **1450** | Tuesday |
| **TATASTEEL** | OPTSTK / FUTSTK | **2750** | Tuesday |
| **TCS** | OPTSTK / FUTSTK | **175** | Tuesday |
| **TCS** | OPTSTK / FUTSTK | **225** | Tuesday |
| **TECHM** | OPTSTK / FUTSTK | **600** | Tuesday |
| **TIINDIA** | OPTSTK / FUTSTK | **200** | Tuesday |
| **TITAN** | OPTSTK / FUTSTK | **175** | Tuesday |
| **TMPV** | OPTSTK / FUTSTK | **800** | Tuesday |
| **TMPV** | OPTSTK / FUTSTK | **1600** | Tuesday |
| **TORNTPHARM** | OPTSTK / FUTSTK | **125** | Tuesday |
| **TRENT** | OPTSTK / FUTSTK | **100** | Tuesday |
| **TRENT** | OPTSTK / FUTSTK | **150** | Tuesday |
| **TVSMOTOR** | OPTSTK / FUTSTK | **175** | Tuesday |
| **ULTRACEMCO** | OPTSTK / FUTSTK | **50** | Tuesday |
| **UNIONBANK** | OPTSTK / FUTSTK | **4425** | Tuesday |
| **UNITDSPR** | OPTSTK / FUTSTK | **400** | Tuesday |
| **UNOMINDA** | OPTSTK / FUTSTK | **550** | Tuesday |
| **UPL** | OPTSTK / FUTSTK | **1355** | Tuesday |
| **VBL** | OPTSTK / FUTSTK | **1125** | Tuesday |
| **VBL** | OPTSTK / FUTSTK | **1275** | Tuesday |
| **VEDL** | OPTSTK / FUTSTK | **1150** | Tuesday |
| **VMM** | OPTSTK / FUTSTK | **4850** | Tuesday |
| **VOLTAS** | OPTSTK / FUTSTK | **375** | Tuesday |
| **WAAREEENER** | OPTSTK / FUTSTK | **175** | Tuesday |
| **WIPRO** | OPTSTK / FUTSTK | **3000** | Tuesday |
| **YESBANK** | OPTSTK / FUTSTK | **31100** | Tuesday |
| **ZYDUSLIFE** | OPTSTK / FUTSTK | **900** | Tuesday |

---

## 5. Symbol & Token Mapping Mechanics

In the Kotak Securities / Kotak Neo API, every derivative contract is identified by two crucial properties:
1. **Instrument Token (`instrument_token`)**: A unique integer key assigned by the exchange (NSE or BSE).
2. **Trading Symbol (`trading_symbol`)**: A human-readable string descriptive name (e.g. `NIFTY26MAY30700CE`).

### A. Key Index Spot Tokens
Real-time spot/index calculations query the following fixed exchange tokens:
*   **NIFTY 50 Spot**: `26000` (`nse_cm`)
*   **BANK NIFTY Spot**: `26009` (`nse_cm`)
*   **SENSEX Spot**: `1` (`bse_cm`)
*   **BANKEX Spot**: `12` (`bse_cm`)
*   **INDIA VIX Spot**: `26017` (`nse_cm`)

### B. Option Trading Symbol Structure
Kotak Neo employs two standard F&O trading symbol formatting patterns:

#### Pattern 1: Monthly Contracts
Used for monthly index options, stock options, and futures.
*   **Format**: `[Underlying][Year][Month][Strike][CE/PE/FUT]`
*   *Example*: `NIFTY26MAY30700CE`
    *   `NIFTY`: Underlying symbol name
    *   `26`: Year (2026)
    *   `MAY`: 3-letter Month abbreviation
    *   `30700`: Strike Price
    *   `CE`: Call Option (PE for Put, FUT for Futures)

#### Pattern 2: Weekly Contracts
Used for weekly index options (e.g. NIFTY, BANKNIFTY, SENSEX weekly option series).
*   **Format**: `[Underlying][Year][MonthChar][Day][Strike][CE/PE]`
*   *Example*: `NIFTY2652624200CE`
    *   `NIFTY`: Underlying symbol name
    *   `26`: Year (2026)
    *   `5`: Month Character (1-9 for Jan-Sep, `O` for October, `N` for November, `D` for December)
    *   `26`: Expiry day of the month
    *   `24200`: Strike Price
    *   `CE`: Call Option

### C. Database Resolution Mechanics
When running strategies or rendering the Option Chain, the system queries the local F&O database (`contracts.db`) to map user selections to the required trading symbol and token:
```sql
SELECT trading_symbol, token, lot_size 
FROM contracts 
WHERE symbol = ? AND expiry = ? AND strike = ? AND option_type = ?
```

### D. Real-Time Streaming Matching
1. **Subscription**: The system subscribes to WebSocket quotes by sending a list of numeric **Instrument Tokens**.
2. **Incoming Ticks**: WebSocket messages contain only raw numeric tokens (e.g. `tk: "12345"`).
3. **Reverse Mapping**: The `PositionTracker` maps the token back to the corresponding `trading_symbol` to update the LTP, Bid/Ask, and recalculate portfolio Greeks.

---

## 6. 2026 Trading Holidays & Expiry Shifting Calendar

Weekly and monthly contracts falling on these dates shift backwards to the preceding business day:

*   **15-Jan-2026** (Thursday) -> BSE contracts shift to **14-Jan-2026** (Wednesday)
*   **26-Jan-2026** (Monday)
*   **03-Mar-2026** (Tuesday) -> NSE contracts shift to **02-Mar-2026** (Monday)
*   **26-Mar-2026** (Thursday) -> BSE contracts shift to **25-Mar-2026** (Wednesday)
*   **31-Mar-2026** (Tuesday) -> NSE contracts shift to **30-Mar-2026** (Monday)
*   **03-Apr-2026** (Friday)
*   **14-Apr-2026** (Tuesday) -> NSE contracts shift to **13-Apr-2026** (Monday)
*   **01-May-2026** (Friday)
*   **28-May-2026** (Thursday - Buddha Purnima) -> BSE SENSEX/BANKEX contracts shift to **27-May-2026** (Wednesday)
*   **26-Jun-2026** (Friday)
*   **09-Sep-2026** (Wednesday)
*   **02-Oct-2026** (Friday)
*   **20-Oct-2026** (Tuesday) -> NSE contracts shift to **19-Oct-2026** (Monday)
*   **10-Nov-2026** (Tuesday) -> NSE contracts shift to **09-Nov-2026** (Monday)
*   **24-Nov-2026** (Tuesday) -> NSE contracts shift to **23-Nov-2026** (Monday)
*   **25-Dec-2026** (Friday)

---

## 7. Reference Code Implementations

*   **Backend Date Shifting & Parsing**:
    *   Defined in: [position_tracker.py](file:///c:/Users/admin/Desktop/kotakalgo/kotak_algo/core/position_tracker.py) -> `parse_expiry(expiry_clean_str, underlying)`
*   **Frontend Symbol Parser & Holiday Config**:
    *   Defined in: [symbolParser.js](file:///c:/Users/admin/Desktop/kotakalgo/dashboard/src/utils/symbolParser.js) -> `parseOptionSymbol(symbol)`
*   **Frontend Greeks Rendering Lot-size Multiplier**:
    *   Defined in: [OptionChain.jsx](file:///c:/Users/admin/Desktop/kotakalgo/dashboard/src/components/option-chain/OptionChain.jsx) -> `getLotSize(symbol)`