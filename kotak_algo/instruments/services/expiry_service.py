from datetime import datetime, date, timedelta
from typing import List, Optional
import pandas as pd

class ExpiryService:
    @staticmethod
    def get_nearest_expiry(expiries: List[date], current_date: Optional[date] = None) -> Optional[date]:
        if not expiries:
            return None
        current_date = current_date or datetime.now().date()
        future_expiries = sorted([e for e in expiries if e >= current_date])
        return future_expiries[0] if future_expiries else None

    @staticmethod
    def get_next_weekly_expiry(expiries: List[date], current_date: Optional[date] = None) -> Optional[date]:
        # Implementation depends on distinguishing weekly vs monthly
        # For simplicity, we can assume nearest is weekly if it's the first in sorted list
        return ExpiryService.get_nearest_expiry(expiries, current_date)

    @staticmethod
    def is_monthly_expiry(expiry: date) -> bool:
        """
        Check if the date is the last Thursday of the month.
        (Note: NSE Monthly expiry is usually last Thursday).
        """
        # Find the last Thursday of the month
        next_month = expiry.replace(day=28) + timedelta(days=4)
        last_day = next_month - timedelta(days=next_month.day)
        
        offset = (last_day.weekday() - 3) % 7 # 3 is Thursday
        last_thursday = last_day - timedelta(days=offset)
        
        return expiry == last_thursday

    @staticmethod
    def get_monthly_expiries(expiries: List[date]) -> List[date]:
        return [e for e in expiries if ExpiryService.is_monthly_expiry(e)]
