import sqlite3
from pathlib import Path

db_path = Path("kotak_algo/instruments/data/contracts.db")
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

cursor.execute("SELECT segment, symbol, trading_symbol, token, instrument_type FROM contracts WHERE symbol = 'NIFTY' LIMIT 15")
rows = cursor.fetchall()
for r in rows:
    print(r)

print("Unique segments in database:")
cursor.execute("SELECT DISTINCT segment FROM contracts")
for r in cursor.fetchall():
    print(r)

conn.close()
