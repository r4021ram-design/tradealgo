from datetime import datetime, date

def format_date_for_nse(d: date) -> str:
    """Format date as 10May2024"""
    return d.strftime('%d%b%Y')

def parse_nse_date(date_str: str) -> date:
    """Parse 30-May-2024 or 30May2024"""
    for fmt in ('%d-%b-%Y', '%d%b%Y'):
        try:
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue
    return None
