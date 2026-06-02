import math
from datetime import datetime, timedelta, timezone

# IST timezone offset
IST = timezone(timedelta(hours=5, minutes=30))

def norm_cdf(x):
    """Standard normal cumulative distribution function using math.erf for high performance."""
    return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0

def norm_pdf(x):
    """Standard normal probability density function."""
    return math.exp(-x * x / 2.0) / math.sqrt(2.0 * math.pi)

def black_scholes_price(S, K, T, r, sigma, option_type, q=0.0):
    """Calculate the Black-Scholes price."""
    if T <= 0.0 or sigma <= 0.0:
        return max(0.0, S - K) if option_type == 'CE' else max(0.0, K - S)
        
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    
    if option_type == 'CE':
        return S * math.exp(-q * T) * norm_cdf(d1) - K * math.exp(-r * T) * norm_cdf(d2)
    else:
        return K * math.exp(-r * T) * norm_cdf(-d2) - S * math.exp(-q * T) * norm_cdf(-d1)

def black_scholes_vega(S, K, T, r, sigma, q=0.0):
    """Calculate the Black-Scholes Vega."""
    if T <= 0.0 or sigma <= 0.0:
        return 0.0
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    return S * math.exp(-q * T) * norm_pdf(d1) * math.sqrt(T)

def implied_volatility_nr(S, K, T, r, market_price, option_type, q=0.0):
    """
    Calculate IV using Newton-Raphson method with improved convergence.
    Uses a smarter initial guess based on the Brenner-Subrahmanyam approximation.
    """
    if T <= 0.0 or market_price <= 0.0:
        return 0.0
        
    # Check intrinsic value bounds
    intrinsic = max(0.0, S - K) if option_type == 'CE' else max(0.0, K - S)
    time_value = market_price - intrinsic
    
    if market_price < intrinsic * 0.80:
        # Market price is WAY below intrinsic (>20% discount) — likely stale data
        # Still return a minimal IV so Greeks (Delta) are computed
        return 0.01  # 1% minimal IV for deep ITM
    
    MAX_ITER = 100
    TOLERANCE = 1e-6
    
    # Smart initial guess using Brenner-Subrahmanyam approximation
    # sigma_approx ≈ sqrt(2*pi/T) * (C/S) for ATM options
    # For non-ATM, use a modified version
    if time_value > 0:
        sigma = math.sqrt(2.0 * math.pi / T) * (time_value / S)
        sigma = max(0.05, min(sigma, 3.0))  # Clamp between 5% and 300%
    else:
        sigma = 0.2  # Default 20%
    
    for i in range(MAX_ITER):
        try:
            price = black_scholes_price(S, K, T, r, sigma, option_type, q)
            diff = price - market_price
            
            if abs(diff) < TOLERANCE:
                return sigma
                
            vega = black_scholes_vega(S, K, T, r, sigma, q)
            if vega < 1e-10:
                # Vega too small — try bisection fallback
                break
                
            sigma = sigma - diff / vega
            
            # Prevent negative volatility or exploding volatility
            if sigma <= 0.001:
                sigma = 0.001
            elif sigma > 5.0:
                sigma = 5.0
        except (OverflowError, ValueError, ZeroDivisionError):
            break
    
    # Bisection fallback if Newton-Raphson didn't converge
    lo, hi = 0.01, 5.0
    for _ in range(100):
        mid = (lo + hi) / 2.0
        try:
            price = black_scholes_price(S, K, T, r, mid, option_type, q)
        except (OverflowError, ValueError):
            hi = mid
            continue
        if price < market_price:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-6:
            return mid
    
    return (lo + hi) / 2.0  # Return best estimate rather than 0

def calculate_greeks(spot_price, strike_price, ltp, expiry_datetime, option_type, r=0.0525, q=0.0):
    """
    Calculate IV and Greeks.
    option_type must be 'CE' or 'PE'.
    expiry_datetime: datetime object for the expiry date
    r: Risk-free rate (default 5.25% = RBI Repo Rate, matches NSE India methodology)
    Returns a dictionary of greeks.
    """
    if spot_price <= 0 or strike_price <= 0 or ltp <= 0:
        return {"iv": 0.0, "delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    
    # Compute T: time to expiry in years
    # Options expire at 15:30 IST on expiry day
    now = datetime.now()
    
    # If expiry_datetime has no time info, set it to 15:30 IST (market close)
    if expiry_datetime.hour == 0 and expiry_datetime.minute == 0:
        # Set expiry to 15:30 IST = 10:00 UTC
        expiry_at_close = expiry_datetime.replace(hour=15, minute=30, second=0)
    else:
        expiry_at_close = expiry_datetime
    
    T = (expiry_at_close - now).total_seconds() / (365.25 * 24 * 3600)
    
    # If already expired or very close to expiry
    if T <= 0:
        T = 0.00001  # Minimum small positive value
    
    # Calculate IV via Newton-Raphson + Bisection fallback
    sigma = implied_volatility_nr(spot_price, strike_price, T, r, ltp, option_type, q)
    
    if sigma <= 0.001:
        # Even bisection failed — return zero greeks but with a flag
        return {"iv": 0.0, "delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    
    try:
        sqrtT = math.sqrt(T)
        d1 = (math.log(spot_price / strike_price) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
        d2 = d1 - sigma * sqrtT
        
        # Delta
        if option_type == 'CE':
            delta = math.exp(-q * T) * norm_cdf(d1)
        else:
            delta = math.exp(-q * T) * (norm_cdf(d1) - 1.0)
            
        # Gamma
        gamma = math.exp(-q * T) * norm_pdf(d1) / (spot_price * sigma * sqrtT)
        
        # Vega (per 1% change in vol)
        vega = spot_price * math.exp(-q * T) * norm_pdf(d1) * sqrtT / 100.0
        
        # Theta (per day)
        term1 = -(spot_price * sigma * math.exp(-q * T) * norm_pdf(d1)) / (2 * sqrtT)
        if option_type == 'CE':
            term2 = q * spot_price * math.exp(-q * T) * norm_cdf(d1)
            term3 = -r * strike_price * math.exp(-r * T) * norm_cdf(d2)
        else:
            term2 = -q * spot_price * math.exp(-q * T) * norm_cdf(-d1)
            term3 = r * strike_price * math.exp(-r * T) * norm_cdf(-d2)
            
        theta = (term1 + term2 + term3) / 365.0
        
        return {
            "iv": round(sigma * 100.0, 2),  # as percentage
            "delta": round(delta, 4),
            "gamma": round(gamma, 6),
            "theta": round(theta, 2),
            "vega": round(vega, 2)
        }
    except (OverflowError, ValueError, ZeroDivisionError):
        return {"iv": round(sigma * 100.0, 2), "delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
