from datetime import datetime
import pandas as pd
from typing import List, Dict, Any
from kotak_algo.instruments.models.contract_model import Contract

class NSEParser:
    @staticmethod
    def parse_fo_contracts(df: pd.DataFrame) -> List[Dict[str, Any]]:
        """Parses the NSE fo_contracts.csv file."""
        contracts = []
        # Columns in fo_contracts.csv:
        # instrument_type, symbol, expiry_date, strike_price, option_type, token, etc.
        # Note: Columns might vary, need to handle flexibly.
        
        for _, row in df.iterrows():
            try:
                # Normalize field names based on actual NSE file headers
                # Typical headers: 'SYMBOL', 'EXPIRY_DT', 'STRIKE_PR', 'OPTION_TYP', 'INSTRUMENT'
                symbol = row.get('SYMBOL', row.get('symbol'))
                expiry_str = row.get('EXPIRY_DT', row.get('expiry_date'))
                strike = float(row.get('STRIKE_PR', row.get('strike_price', 0)))
                opt_type = row.get('OPTION_TYP', row.get('option_type', 'XX'))
                inst_type = row.get('INSTRUMENT', row.get('instrument_type'))
                token = str(row.get('TOKEN', row.get('token', '')))
                
                # Convert expiry string to date
                # Format is usually 'DD-MMM-YYYY' e.g. '30-May-2024'
                expiry_dt = None
                if isinstance(expiry_str, str):
                    expiry_dt = datetime.strptime(expiry_str, '%d-%b-%Y').date()
                
                # Standardize Trading Symbol (e.g., NIFTY25MAY24000CE)
                # Note: This is an approximation; different brokers use different formats.
                # Kotak Neo often uses its own mapping.
                ts_expiry = expiry_dt.strftime('%d%b%y').upper() if expiry_dt else ""
                ts_strike = f"{int(strike)}" if strike > 0 else ""
                trading_symbol = f"{symbol}{ts_expiry}{ts_strike}{opt_type if opt_type != 'XX' else ''}"

                contracts.append({
                    "symbol": symbol,
                    "trading_symbol": trading_symbol,
                    "expiry": expiry_dt,
                    "strike": strike,
                    "option_type": opt_type,
                    "instrument_type": inst_type,
                    "token": token,
                })
            except Exception:
                continue
        return contracts

class ExpiryParser:
    @staticmethod
    def parse_date(date_val: Any) -> datetime.date:
        if isinstance(date_val, datetime):
            return date_val.date()
        if isinstance(date_val, str):
            for fmt in ('%d-%b-%Y', '%Y-%m-%d', '%d%m%Y'):
                try:
                    return datetime.strptime(date_val, fmt).date()
                except ValueError:
                    continue
        return None
