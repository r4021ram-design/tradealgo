import sqlite3
db = sqlite3.connect('kotak_algo/instruments/data/contracts.db')
c = db.cursor()

print('=== BANKEX FUTURE CONTRACTS ===')
c.execute("SELECT trading_symbol, expiry, strike, option_type, token FROM contracts WHERE symbol='BANKEX' AND instrument_type='FUTIDX' ORDER BY expiry LIMIT 5")
for row in c.fetchall():
    print(f'  {row}')

db.close()
