import sqlite3

db_path = r"c:\Users\admin\Desktop\kotakalgo\kotak_algo\instruments\data\contracts.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("--- Distinct symbols ---")
cursor.execute("SELECT DISTINCT symbol FROM contracts LIMIT 50")
for r in cursor.fetchall():
    print(r)

print("--- Any SENSEX in trading_symbol? ---")
cursor.execute("SELECT DISTINCT symbol, trading_symbol, instrument_type, expiry FROM contracts WHERE trading_symbol LIKE '%SENSEX%' LIMIT 20")
for r in cursor.fetchall():
    print(r)

conn.close()
