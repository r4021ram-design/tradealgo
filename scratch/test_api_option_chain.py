import urllib.request
import json

def test_symbol(symbol):
    print(f"\n=================== {symbol} ===================")
    try:
        url = f"http://127.0.0.1:8000/api/free/option-chain/{symbol}"
        response = urllib.request.urlopen(url)
        data = json.loads(response.read().decode())
        
        print("Underlying:", data.get("symbol"))
        print("Spot Price:", data.get("spotPrice"))
        print("Expiry Dates:", data.get("expiryDates")[:5] if data.get("expiryDates") else [])
        print("Source:", data.get("source"))
        
        chain = data.get("optionChain", [])
        print(f"Option Chain size: {len(chain)} rows")
        if chain:
            print("First row strike:", chain[0]['strike'])
            print("ATM-like row:")
            mid = len(chain) // 2
            row = chain[mid]
            print(f"  Strike: {row['strike']} | CE symbol: {row['ce_symbol']} LTP: {row['ce']['ltp']} | PE symbol: {row['pe_symbol']} LTP: {row['pe']['ltp']}")
    except Exception as e:
        print(f"Error testing {symbol}:", e)

test_symbol("SENSEX")
test_symbol("BANKEX")
test_symbol("NIFTY")
test_symbol("TVSMOTOR")
