import sys
from pathlib import Path
import time
from unittest.mock import patch, MagicMock
import threading

sys.path.insert(0, str(Path(__file__).parent))

from kotak_algo.main import AlgoApp, _install_signal_handlers

def run_mocked():
    config_path = Path("kotak_algo/config.yaml")
    
    # Patch the entire NeoBrokerClient and its client property
    with patch("kotak_algo.broker.neo_client.NeoBrokerClient.authenticate") as mock_auth, \
         patch("kotak_algo.broker.neo_client.NeoBrokerClient.client", new_callable=MagicMock) as mock_client:
         
        mock_client.return_value = MagicMock()
        mock_client.return_value.scrip_master.return_value = "dummy.csv"
        
        app = AlgoApp(config_path)
        app.build_strategies = MagicMock()
        
        # Mock NSE reference
        app.nse_reference.refresh = MagicMock(return_value=Path("dummy.csv"))
        
        # Mock position tracker and websocket to not actually connect
        app.position_tracker.start = MagicMock()
        app.websocket.start = MagicMock()
        app.websocket.subscribe = MagicMock()
        
        # Mock strategy should_enter to avoid needing live market data in the mock
        for name in app.config.get("strategies", {}):
            pass # We will let the strategies build and just print logs
            
        _install_signal_handlers(app)
        
        print("--- STARTING MOCKED ALGO APP (Will auto-shutdown in 10s) ---")
        
        # Auto shutdown after 10s
        def delayed_shutdown():
            time.sleep(10)
            app.shutdown("mock_timeout")
            
        threading.Thread(target=delayed_shutdown, daemon=True).start()
        
        try:
            app.start()
        except Exception as e:
            print(f"Exception: {e}")
            import traceback
            traceback.print_exc()
        print("--- MOCKED RUN COMPLETED ---")

if __name__ == "__main__":
    run_mocked()
