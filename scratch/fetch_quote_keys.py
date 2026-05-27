import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from kotak_algo.utils.config_loader import load_config
from kotak_algo.broker.neo_client import NeoBrokerClient

config = load_config(Path("kotak_algo/config.yaml"))
broker = NeoBrokerClient(config["broker"])
broker.authenticate()

# Let's fetch quotes for a couple of active Nifty option tokens we saw in positions
# NIFTY26MAY24200CE (token 72187) and NIFTY26MAY24250CE (token 72237)
tokens = [
    {"instrument_token": "72187", "exchange_segment": "nse_fo"},
    {"instrument_token": "72237", "exchange_segment": "nse_fo"}
]

print("Fetching quotes raw response...")
resp = broker.quotes(instrument_tokens=tokens)
import pprint
pprint.pprint(resp)
