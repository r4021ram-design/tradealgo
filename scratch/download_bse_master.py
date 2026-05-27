import os
import sys
from pathlib import Path

# Add project root to python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kotak_algo.utils.config_loader import load_dotenv
from kotak_algo.main import AlgoApp
from kotak_algo.broker.neo_client import NeoBrokerClient

config_path = Path("kotak_algo/config.yaml")
app = AlgoApp(config_path)

print("Authenticating broker...")
app.broker.authenticate()
print("Broker authenticated successfully!")

print("Fetching bse_fo scrip master...")
path = app.broker.scrip_master_path("bse_fo")
print(f"Scrip master downloaded to: {path}")

# Check columns and print first few rows of SENSEX
import pandas as pd
df = pd.read_csv(path)
print(f"Total rows: {len(df)}")
print("Columns:", list(df.columns))

sensex_df = df[df["TckrSymb"].astype(str).str.upper() == "SENSEX"]
print(f"Total SENSEX contracts found: {len(sensex_df)}")
if not sensex_df.empty:
    print("\nSample SENSEX contracts:")
    print(sensex_df[["FinInstrmId", "TckrSymb", "XpryDt", "StrkPric", "OptnTp", "NewBrdLotQty", "StockNm"]].head(10))
