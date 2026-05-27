import pandas as pd

path = "data/scrip_master/bse_fo.csv"
df = pd.read_csv(path)

print("Columns:")
print(df.columns.tolist())

# Let's search for SENSEX in pSymbolName, pSymbol, pAssetCode, etc.
for col in ["pSymbol", "pSymbolName", "pAssetCode"]:
    matches = df[df[col].astype(str).str.upper().str.contains("SENSEX")]
    print(f"Matches in {col}: {len(matches)}")
    if not matches.empty:
        print(f"Sample values from {col}:", matches[col].unique()[:5])

# Print sample row where pSymbol is SENSEX (or pSymbolName is SENSEX)
sensex_rows = df[df["pSymbolName"].astype(str).str.upper() == "SENSEX"]
if sensex_rows.empty:
    sensex_rows = df[df["pSymbol"].astype(str).str.upper() == "SENSEX"]

if not sensex_rows.empty:
    print("\nTotal SENSEX rows:", len(sensex_rows))
    print("\nSample SENSEX row:")
    row = sensex_rows.iloc[0].to_dict()
    for k, v in row.items():
        if pd.notna(v):
            print(f"  {k}: {v}")
else:
    print("No SENSEX rows found in BSE F&O Master!")
