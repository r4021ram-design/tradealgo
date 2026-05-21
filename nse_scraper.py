import requests
import pandas as pd
import time
import math
import warnings
from requests.exceptions import RequestException, JSONDecodeError

# To calculate Greeks, you must install mibian: pip install mibian
try:
    import mibian
except ImportError:
    mibian = None
    warnings.warn("mibian library not found. Greeks calculation will be skipped. Run 'pip install mibian' to enable.")

class NSEScraper:
    """
    A robust web scraper to fetch live option chain data from the National Stock Exchange (NSE) India.
    Designed for both Indices (NIFTY, BANKNIFTY) and Stock Options (RELIANCE, HDFC, etc).
    """
    def __init__(self, symbol="NIFTY", is_index=True):
        self.symbol = symbol.upper()
        self.is_index = is_index
        self.base_url = "https://www.nseindia.com"
        
        # API Endpoints differ slightly for Indices vs Equities
        if self.is_index:
            self.api_url = f"https://www.nseindia.com/api/option-chain-indices?symbol={self.symbol}"
        else:
            self.api_url = f"https://www.nseindia.com/api/option-chain-equities?symbol={self.symbol}"
            
        # Rotating browser headers to bypass NSE blocking
        self.user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
        ]
        
        self.session = requests.Session()
        self._refresh_session_headers()
        self._warm_up_session()

    def _refresh_session_headers(self):
        """Randomize User-Agent and update session headers."""
        import random
        ua = random.choice(self.user_agents)
        self.headers = {
            "User-Agent": ua,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": "https://www.nseindia.com/market-data/option-chain",
            "X-Requested-With": "XMLHttpRequest",
            "Connection": "keep-alive"
        }
        self.session.headers.clear()
        self.session.headers.update(self.headers)
        print(f"Refreshed session with UA: {ua[:50]}...")

    def _warm_up_session(self):
        """
        Silver Bullet: Hit the specific metadata endpoint to get crucial cookies.
        """
        print("Warming up NSE session cookies...")
        try:
            # Step 1: Hit Home Page
            self.session.get(self.base_url, timeout=15)
            time.sleep(1)
            # Step 2: Hit Market Status (Sets important session cookies)
            self.session.get(f"{self.base_url}/api/marketStatus", timeout=15)
            time.sleep(1)
            # Step 3: Hit the Option Chain UI page
            self.session.get(f"{self.base_url}/market-data/option-chain", timeout=15)
            time.sleep(2)
        except RequestException as e:
            print(f"Warning: Failed to warm up session: {e}")

    def fetch_data(self, target_expiry=None, calculate_greeks=False, retries=5):
        """
        Fetches the option chain JSON, filters for expiry, and returns a Pandas DataFrame.
        Includes exponential backoff and session rotation.
        """
        last_exception = None
        for attempt in range(retries):
            try:
                # Exponential backoff: 2, 4, 8, 16, 32s
                wait_time = 2 ** (attempt + 1)
                if attempt > 0:
                    print(f"Retrying in {wait_time}s (Attempt {attempt+1}/{retries})...")
                    time.sleep(wait_time)

                response = self.session.get(self.api_url, timeout=12)
                
                # Check for blocking
                if response.status_code in (401, 403, 429):
                    print(f"Access Denied/Rate Limited ({response.status_code}). Rotating headers and cookies...")
                    self._refresh_session_headers()
                    self._warm_up_session()
                    continue
                    
                response.raise_for_status()
                data = response.json()
                
                # Validation Layer: Ensure crucial keys exist
                if "records" not in data or "data" not in data["records"] or "expiryDates" not in data["records"]:
                    print(f"Invalid JSON structure (Attempt {attempt+1}). Retrying...")
                    self._warm_up_session()
                    continue
                    
                return self._process_data(data, target_expiry, calculate_greeks)
                
            except (RequestException, JSONDecodeError) as e:
                last_exception = e
                print(f"Fetch failed (Attempt {attempt+1}): {e}")
                # Log snippets for debugging if blocked
                if hasattr(e, 'response') and e.response is not None:
                    if "captcha" in e.response.text.lower():
                        print("CRITICAL: NSE triggered CAPTCHA.")
                self._warm_up_session()
                
        raise Exception(f"Failed to fetch NSE data after {retries} attempts. Last error: {last_exception}")

    def _process_data(self, raw_data, target_expiry, calculate_greeks):
        """
        Processes the raw JSON into a clean Pandas DataFrame.
        """
        records = raw_data['records']['data']
        expiries = raw_data['records']['expiryDates']
        spot_price = raw_data['records']['underlyingValue']
        
        # Default to nearest expiry if none provided
        if not target_expiry:
            target_expiry = expiries[0]
            print(f"No expiry provided. Defaulting to nearest: {target_expiry}")
        elif target_expiry not in expiries:
            raise ValueError(f"Expiry '{target_expiry}' not found. Available: {expiries[:5]}...")

        # Extract rows matching the expiry
        formatted_data = []
        for row in records:
            if row['expiryDate'] == target_expiry:
                strike = row.get('strikePrice', 0)
                
                ce = row.get('CE', {})
                pe = row.get('PE', {})
                
                formatted_data.append({
                    "Strike": strike,
                    "Expiry": target_expiry,
                    
                    "CE_LTP": ce.get('lastPrice', 0),
                    "CE_OI": ce.get('openInterest', 0),
                    "CE_OI_Chg": ce.get('changeinOpenInterest', 0),
                    "CE_IV": ce.get('impliedVolatility', 0),
                    
                    "PE_LTP": pe.get('lastPrice', 0),
                    "PE_OI": pe.get('openInterest', 0),
                    "PE_OI_Chg": pe.get('changeinOpenInterest', 0),
                    "PE_IV": pe.get('impliedVolatility', 0),
                })
                
        df = pd.DataFrame(formatted_data)
        
        # Optimize Data: Ensure numeric types (NSE sometimes sends hyphens for 0)
        numeric_cols = ["CE_LTP", "CE_OI", "CE_OI_Chg", "CE_IV", "PE_LTP", "PE_OI", "PE_OI_Chg", "PE_IV"]
        for col in numeric_cols:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            
        # Optional: Calculate Greeks using mibian
        if calculate_greeks and mibian is not None:
            df = self._calculate_greeks(df, spot_price)
            
        print(f"Successfully loaded {len(df)} strikes for {self.symbol} (Spot: {spot_price})")
        return {
            "df": df,
            "spot": spot_price,
            "expiries": expiries
        }

    def _calculate_greeks(self, df, spot_price, days_to_expiry=None, interest_rate=10):
        """
        Uses the mibian library to calculate Greeks (Delta, Theta, Gamma).
        Note: DTE calculation requires exactly knowing trading days. For simplicity, we use 7.
        """
        if days_to_expiry is None:
            days_to_expiry = 7 # Approximation
            
        ce_deltas, ce_thetas, pe_deltas, pe_thetas = [], [], [], []
        
        for _, row in df.iterrows():
            strike = row['Strike']
            
            # Call Greeks
            ce_iv = row['CE_IV']
            if ce_iv > 0:
                # mibian.BS([underlyingPrice, strikePrice, interestRate, daysToExpiration], volatility=x)
                c = mibian.BS([spot_price, strike, interest_rate, days_to_expiry], volatility=ce_iv)
                ce_deltas.append(c.callDelta)
                ce_thetas.append(c.callTheta)
            else:
                ce_deltas.append(0)
                ce_thetas.append(0)
                
            # Put Greeks
            pe_iv = row['PE_IV']
            if pe_iv > 0:
                p = mibian.BS([spot_price, strike, interest_rate, days_to_expiry], volatility=pe_iv)
                pe_deltas.append(p.putDelta)
                pe_thetas.append(p.putTheta)
            else:
                pe_deltas.append(0)
                pe_thetas.append(0)
                
        df['CE_Delta'] = ce_deltas
        df['CE_Theta'] = ce_thetas
        df['PE_Delta'] = pe_deltas
        df['PE_Theta'] = pe_thetas
        
        return df

# Singleton instances to reuse sessions across requests
_scrapers = {}

def get_scraper(symbol="NIFTY", is_index=True):
    key = (symbol.upper(), is_index)
    if key not in _scrapers:
        _scrapers[key] = NSEScraper(symbol=symbol, is_index=is_index)
    return _scrapers[key]

if __name__ == "__main__":
    print("Starting NIFTY Scraper Test...")
    scraper = get_scraper(symbol="NIFTY", is_index=True)
    
    try:
        df_nifty = scraper.fetch_data(calculate_greeks=True)
        print("\n--- NIFTY Option Chain Snapshot (Sample) ---")
        mid_idx = len(df_nifty) // 2
        print(df_nifty.iloc[mid_idx-2 : mid_idx+3].to_string())
    except Exception as e:
        print(f"Error occurred: {e}")
