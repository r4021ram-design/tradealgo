import sqlite3
import os

db_path = 'kotak_algo/instruments/data/contracts.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("=== NIFTY FUTURES ===")
    cursor.execute("SELECT trading_symbol, instrument_type, token, exchange, segment FROM contracts WHERE symbol='NIFTY' AND instrument_type='FUTIDX' LIMIT 5")
    for r in cursor.fetchall():
        print(r)
        
    print("\n=== NIFTY OPTIONS ===")
    cursor.execute("SELECT trading_symbol, instrument_type, token, exchange, segment FROM contracts WHERE symbol='NIFTY' AND instrument_type='OPTIDX' LIMIT 5")
    for r in cursor.fetchall():
        print(r)
        
    conn.close()
else:
    print("Database not found at:", db_path)
