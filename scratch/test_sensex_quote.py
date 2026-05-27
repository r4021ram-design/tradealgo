import os
import sys
from pathlib import Path

# Add project root to python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kotak_algo.main import AlgoApp

config_path = Path("kotak_algo/config.yaml")
app = AlgoApp(config_path)

print("Authenticating broker...")
app.broker.authenticate()

# 1. Test SENSEX Futures quote (token 870220)
print("\nFetching SENSEX Future Quote...")
try:
    q = app.broker.quotes(instrument_tokens=[{"instrument_token": "870220", "exchange_segment": "bse_fo"}])
    print("Future quote response:", q)
except Exception as e:
    print("Future quote failed:", e)

# 2. Test SENSEX Index quote (token 1, bse_cm)
print("\nFetching SENSEX Index Quote...")
try:
    q = app.broker.quotes(instrument_tokens=[{"instrument_token": "1", "exchange_segment": "bse_cm"}])
    print("Index quote response:", q)
except Exception as e:
    print("Index quote failed:", e)
