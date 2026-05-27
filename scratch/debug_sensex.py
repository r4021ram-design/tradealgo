import os
import sys
import traceback
from pathlib import Path

# Add project root to python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kotak_algo.main import AlgoApp
from kotak_algo.core.option_chain import OptionChainService

config_path = Path("kotak_algo/config.yaml")
app = AlgoApp(config_path)

print("Authenticating broker...")
app.broker.authenticate()

print("\nCalling OptionChainService.get_option_chain for SENSEX...")
try:
    service = OptionChainService(app.broker, app.logger)
    chain_data = service.get_option_chain(
        underlying="SENSEX",
        exchange_segment="bse_fo",
        expiry=None,
        strike_range=20
    )
    print("SENSEX Option Chain retrieved successfully!")
    print("Keys:", chain_data.keys())
    print("Spot:", chain_data.get("spot"))
    print("Expiry:", chain_data.get("expiry"))
    print("CE chain size:", len(chain_data.get("ce_chain", [])))
    print("PE chain size:", len(chain_data.get("pe_chain", [])))
except Exception as e:
    print("\nSENSEX Option Chain failed with exception:")
    traceback.print_exc()

print("\nCalling OptionChainService.get_option_chain for BANKEX...")
try:
    service = OptionChainService(app.broker, app.logger)
    chain_data = service.get_option_chain(
        underlying="BANKEX",
        exchange_segment="bse_fo",
        expiry=None,
        strike_range=20
    )
    print("BANKEX Option Chain retrieved successfully!")
    print("Keys:", chain_data.keys())
    print("Spot:", chain_data.get("spot"))
    print("Expiry:", chain_data.get("expiry"))
except Exception as e:
    print("\nBANKEX Option Chain failed with exception:")
    traceback.print_exc()
