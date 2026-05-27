import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from kotak_algo.utils.config_loader import load_config
from kotak_algo.broker.neo_client import NeoBrokerClient

config = load_config(Path("kotak_algo/config.yaml"))
broker = NeoBrokerClient(config["broker"])
broker.authenticate()

print("Session alive:", broker.is_session_alive())
positions = broker.positions()
print("Raw positions response:")
import pprint
pprint.pprint(positions)
