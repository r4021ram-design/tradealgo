import sqlite3
db = sqlite3.connect('kotak_algo/instruments/data/contracts.db')
c = db.cursor()

print('=== TOTAL CONTRACTS ===')
c.execute('SELECT COUNT(*) FROM contracts')
print(f'Total: {c.fetchone()[0]}')

print('\n=== BY INSTRUMENT TYPE ===')
c.execute('SELECT instrument_type, COUNT(*) FROM contracts GROUP BY instrument_type ORDER BY COUNT(*) DESC')
for row in c.fetchall():
    print(f'  {row[0]:12s} {row[1]:>6d}')

print('\n=== TOP SYMBOLS ===')
c.execute('SELECT symbol, COUNT(*) FROM contracts GROUP BY symbol ORDER BY COUNT(*) DESC LIMIT 10')
for row in c.fetchall():
    print(f'  {row[0]:15s} {row[1]:>6d}')

print('\n=== SAMPLE NIFTY CONTRACTS ===')
c.execute("SELECT trading_symbol, expiry, strike, option_type, lot_size FROM contracts WHERE symbol='NIFTY' LIMIT 5")
for row in c.fetchall():
    print(f'  {row}')

print('\n=== SAMPLE BANKNIFTY ===')
c.execute("SELECT trading_symbol, expiry, strike, option_type, lot_size FROM contracts WHERE symbol='BANKNIFTY' LIMIT 5")
for row in c.fetchall():
    print(f'  {row}')

print('\n=== DISTINCT EXPIRIES (NIFTY) ===')
c.execute("SELECT DISTINCT expiry FROM contracts WHERE symbol='NIFTY' ORDER BY expiry LIMIT 8")
for row in c.fetchall():
    print(f'  {row[0]}')

db.close()
