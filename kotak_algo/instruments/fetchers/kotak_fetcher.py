import pandas as pd
from typing import Optional
from kotak_algo.broker.neo_client import NeoBrokerClient
from kotak_algo.utils.logger import get_logger

LOGGER = get_logger("kotak_fetcher")

class KotakFetcher:
    def __init__(self, broker: NeoBrokerClient):
        self.broker = broker

    def fetch_master(self, segment: str = "nse_fo") -> Optional[pd.DataFrame]:
        """Fetches the scrip master from Kotak Neo."""
        try:
            path = self.broker.scrip_master_path(exchange_segment=segment)
            if path and path.exists():
                # Kotak Neo scrip master is usually a CSV with specific columns
                df = pd.read_csv(path)
                return df
            else:
                LOGGER.error("kotak_master_file_not_found", path=str(path))
                return None
        except Exception as e:
            LOGGER.error("kotak_fetch_master_failed", error=str(e))
            return None
