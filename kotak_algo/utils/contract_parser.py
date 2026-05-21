import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
import pdfplumber

from kotak_algo.utils.logger import get_logger

LOGGER = get_logger("contract_parser")

# Regex to capture formats like "NIFTY 24 APR 22000 CE" or "BANKNIFTY 15MAY 45000 PE"
# We handle optional spaces and optional year in expiry.
SECURITY_DESC_REGEX = re.compile(
    r'(?P<symbol>[A-Za-z]+)\s+(?P<expiry>\d{1,2}\s*[A-Za-z]{3}(?:\s*\d{2,4})?)\s+(?P<strike>\d+(?:\.\d+)?)\s+(?P<type>CE|PE)',
    re.IGNORECASE
)

# Common charge keys found at the end of the contract note
CHARGE_KEYS = [
    "Securities Transaction Tax",
    "Stamp Duty",
    "Exchange Transaction Charges",
    "GST",
    "Brokerage",
    "SEBI Turnover Fees",
    "Clearing Charges"
]

def clean_number(val: str | None) -> float:
    if not val:
        return 0.0
    cleaned = val.replace(',', '').strip()
    try:
        return float(cleaned)
    except ValueError:
        return 0.0

def extract_contract_note(pdf_stream: io.BytesIO, password: str = "") -> dict[str, Any]:
    trades = []
    summary = {key: 0.0 for key in CHARGE_KEYS}
    summary["Net Total"] = 0.0
    
    with pdfplumber.open(pdf_stream, password=password) as pdf:
        header_map = {}
        
        for page in pdf.pages:
            # Extract tables
            tables = page.extract_tables()
            for table in tables:
                if not table:
                    continue
                    
                for row in table:
                    # Clean empty/None cells
                    row = [str(cell).strip().replace('\n', ' ') if cell else "" for cell in row]
                    
                    # 1. Identify the header row
                    row_joined = " ".join(row).lower()
                    if not header_map and "order no" in row_joined and "security description" in row_joined:
                        # Build dynamic column mapping
                        for idx, col_name in enumerate(row):
                            col_lower = col_name.lower()
                            if "order no" in col_lower:
                                header_map["order_no"] = idx
                            elif "trade time" in col_lower:
                                header_map["trade_time"] = idx
                            elif "security description" in col_lower or "contract desc" in col_lower:
                                header_map["security_desc"] = idx
                            elif "buy qty" in col_lower or "buy quantity" in col_lower:
                                header_map["buy_qty"] = idx
                            elif "buy rate" in col_lower or "buy price" in col_lower:
                                header_map["buy_rate"] = idx
                            elif "sell qty" in col_lower or "sell quantity" in col_lower:
                                header_map["sell_qty"] = idx
                            elif "sell rate" in col_lower or "sell price" in col_lower:
                                header_map["sell_rate"] = idx
                            elif "net total" in col_lower:
                                header_map["net_total"] = idx
                        continue
                    
                    # 2. Extract Data Rows using dynamic mapping
                    if header_map and "order_no" in header_map:
                        order_no = row[header_map["order_no"]]
                        # A valid data row typically has a numeric Order No
                        if not order_no or not any(c.isdigit() for c in order_no):
                            continue
                            
                        sec_desc = row[header_map.get("security_desc", -1)] if "security_desc" in header_map else ""
                        if not sec_desc:
                            continue
                            
                        # Extract option details
                        match = SECURITY_DESC_REGEX.search(sec_desc)
                        opt_symbol = match.group("symbol") if match else sec_desc
                        opt_expiry = match.group("expiry") if match else ""
                        opt_strike = match.group("strike") if match else ""
                        opt_type = match.group("type") if match else ""
                        
                        buy_qty = clean_number(row[header_map["buy_qty"]] if "buy_qty" in header_map else "0")
                        buy_rate = clean_number(row[header_map["buy_rate"]] if "buy_rate" in header_map else "0")
                        sell_qty = clean_number(row[header_map["sell_qty"]] if "sell_qty" in header_map else "0")
                        sell_rate = clean_number(row[header_map["sell_rate"]] if "sell_rate" in header_map else "0")
                        
                        trades.append({
                            "Order No": order_no,
                            "Trade Time": row[header_map["trade_time"]] if "trade_time" in header_map else "",
                            "Security Description": sec_desc,
                            "Symbol": opt_symbol.upper(),
                            "Expiry": opt_expiry.upper(),
                            "Strike": opt_strike,
                            "Type": opt_type.upper(),
                            "Buy Qty": buy_qty,
                            "Buy Rate": buy_rate,
                            "Sell Qty": sell_qty,
                            "Sell Rate": sell_rate,
                        })

            # 3. Extract Charges (Usually found in text on the last pages)
            text = page.extract_text()
            if text:
                lines = text.split('\n')
                for line in lines:
                    line_lower = line.lower()
                    for charge_key in CHARGE_KEYS:
                        # Simple heuristic: if the line contains the charge name, try to extract the last numeric value
                        if charge_key.lower() in line_lower:
                            # Extract all numbers from the line
                            numbers = re.findall(r'-?\d+(?:,\d+)*(?:\.\d+)?', line)
                            if numbers:
                                # Often the actual amount is the last number on that line
                                val = clean_number(numbers[-1])
                                summary[charge_key] += val

    return {
        "trade_legs": trades,
        "summary": summary
    }

def save_reconciliation_csvs(data: dict[str, Any], date_str: str = None, save_dir: str = ".") -> dict[str, str]:
    if not date_str:
        date_str = datetime.now().strftime("%d%m%y")
        
    dir_path = Path(save_dir)
    dir_path.mkdir(parents=True, exist_ok=True)
    
    trades_path = dir_path / f"trades_{date_str}.csv"
    summary_path = dir_path / f"summary_{date_str}.csv"
    
    # Save trades
    if data.get("trade_legs"):
        df_trades = pd.DataFrame(data["trade_legs"])
        df_trades.to_csv(trades_path, index=False)
    else:
        # Create empty CSV with headers if no trades
        pd.DataFrame(columns=["Order No", "Trade Time", "Security Description", "Symbol", "Expiry", "Strike", "Type", "Buy Qty", "Buy Rate", "Sell Qty", "Sell Rate"]).to_csv(trades_path, index=False)
        
    # Save summary
    if data.get("summary"):
        summary_items = [{"Charge Type": k, "Amount": v} for k, v in data["summary"].items()]
        df_summary = pd.DataFrame(summary_items)
        df_summary.to_csv(summary_path, index=False)
        
    return {
        "trades_csv": str(trades_path.resolve()),
        "summary_csv": str(summary_path.resolve())
    }
