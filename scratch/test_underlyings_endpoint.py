import urllib.request
import json

try:
    response = urllib.request.urlopen("http://127.0.0.1:8000/api/free/underlyings")
    data = json.loads(response.read().decode())
    
    underlyings = data.get("underlyings", [])
    print(f"API returned {len(underlyings)} symbols.")
    print("Priority symbols checked:")
    for sym in ["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY", "MIDCPNIFTY"]:
        present = sym in underlyings
        print(f"  - {sym}: {'Present' if present else 'Missing'}")
        
    print("\nSample stock symbols returned:")
    stocks = [s for s in underlyings if s not in ["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY", "MIDCPNIFTY"]]
    print(f"  {stocks[:10]}")
    
    if len(underlyings) > 0 and "NIFTY" in underlyings and "SENSEX" in underlyings:
        print("\nTEST PASSED!")
    else:
        print("\nTEST FAILED!")
        
except Exception as e:
    print(f"Test encountered error: {e}")
