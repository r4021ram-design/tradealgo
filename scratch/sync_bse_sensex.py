import os
import sys
import sqlite3
from datetime import datetime, timezone
import pandas as pd
from pathlib import Path

# Add project root to python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

db_path = Path("kotak_algo/instruments/data/contracts.db")
csv_path = Path("data/scrip_master/bse_fo.csv")

if not csv_path.exists():
    print(f"BSE master CSV not found at {csv_path}!")
    sys.exit(1)

print("Reading BSE F&O Master CSV...")
df = pd.read_csv(csv_path)

# Filter for SENSEX and BANKEX
bse_symbols = ["SENSEX", "BANKEX"]
bse_df = df[df["pSymbolName"].astype(str).str.upper().isin(bse_symbols)]
print(f"Found {len(bse_df)} total SENSEX/BANKEX contracts.")

if bse_df.empty:
    print("No SENSEX/BANKEX contracts found in CSV!")
    sys.exit(1)

print(f"Connecting to database at {db_path}...")
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# Clean previous BSE contracts to avoid duplicates
cursor.execute("DELETE FROM contracts WHERE exchange = 'BSE'")
print("Deleted existing BSE contracts.")

# Helper to format option type for futures
def get_option_type(row):
    opt = str(row.get("pOptionType", "XX")).strip()
    if opt in ("CE", "PE"):
        return opt
    return "XX"

# Helper to format instrument type
def get_inst_type(row):
    inst = str(row.get("pInstType", "")).strip()
    if inst == "IO":
        return "OPTIDX"
    elif inst == "IF":
        return "FUTIDX"
    return inst

count = 0
for _, row in bse_df.iterrows():
    try:
        symbol = str(row["pSymbolName"]).strip().upper()
        trading_sym = str(row["pTrdSymbol"]).strip()
        token = str(row["pSymbol"]).strip()
        
        # Parse Expiry (BSE uses standard Unix timestamp: seconds since 1970)
        raw_expiry = int(row["pExpiryDate"])
        expiry_dt = datetime.fromtimestamp(raw_expiry, timezone.utc).date()
        expiry_str = expiry_dt.strftime("%Y-%m-%d")
        
        # Parse Strike (paise -> rupees)
        raw_strike = float(row["dStrikePrice;"])
        strike = raw_strike / 100.0
        
        opt_type = get_option_type(row)
        inst_type = get_inst_type(row)
        lot_size = int(row["lLotSize"])
        
        # Simple monthly flag detection
        weekly_monthly = "MONTHLY" if expiry_dt.day > 24 else "WEEKLY"
        
        cursor.execute(
            """
            INSERT INTO contracts (
                exchange, segment, symbol, trading_symbol, underlying, 
                expiry, strike, option_type, instrument_type, 
                lot_size, freeze_qty, token, weekly_monthly_flag
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "BSE", "FO", symbol, trading_sym, symbol,
                expiry_str, strike, opt_type, inst_type,
                lot_size, 0, token, weekly_monthly
            )
        )
        count += 1
    except Exception as e:
        print(f"Error parsing row: {e}")
        continue

conn.commit()
print(f"Successfully inserted {count} BSE contracts into database!")

# Verify insertion
cursor.execute("SELECT COUNT(*) FROM contracts WHERE exchange = 'BSE'")
print(f"Verified count in DB: {cursor.fetchone()[0]}")

# Show some SENSEX contracts
cursor.execute("SELECT trading_symbol, expiry, strike, option_type, token FROM contracts WHERE symbol = 'SENSEX' LIMIT 5")
print("\nSample SENSEX contracts in DB:")
for r in cursor.fetchall():
    print(f"  {r}")

conn.close()
