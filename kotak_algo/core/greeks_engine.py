import math
from datetime import datetime

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
    """Calculate IV using Newton-Raphson method."""
    if T <= 0.0:
        return 0.0
        
    # Check intrinsic value bounds
    intrinsic = max(0.0, S - K) if option_type == 'CE' else max(0.0, K - S)
    if market_price < intrinsic:
        return 0.0  # Cannot solve if market price is below intrinsic
        
    MAX_ITER = 50
    TOLERANCE = 1e-5
    
    # Initial guess
    sigma = 0.3
    
    for _ in range(MAX_ITER):
        price = black_scholes_price(S, K, T, r, sigma, option_type, q)
        diff = price - market_price
        
        if abs(diff) < TOLERANCE:
            return sigma
            
        vega = black_scholes_vega(S, K, T, r, sigma, q)
        if vega < 1e-8:
            break
            
        sigma = sigma - diff / vega
        
        # Prevent negative volatility or exploding volatility
        if sigma <= 0.0:
            sigma = 0.01
        elif sigma > 5.0:
            sigma = 5.0
            
    return 0.0  # Failed to converge or deep ITM/OTM

def calculate_greeks(spot_price, strike_price, ltp, expiry_datetime, option_type, r=0.07, q=0.0):
    """
    Calculate IV and Greeks.
    option_type must be 'CE' or 'PE'.
    Returns a dictionary of greeks.
    """
    if spot_price <= 0 or strike_price <= 0 or ltp <= 0:
        return {"iv": 0.0, "delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
        
    now = datetime.now()
    T = max((expiry_datetime - now).total_seconds() / (365 * 24 * 3600), 0.00001)
    
    sigma = implied_volatility_nr(spot_price, strike_price, T, r, ltp, option_type, q)
    if sigma == 0.0:
        return {"iv": 0.0, "delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
        
    d1 = (math.log(spot_price / strike_price) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    
    # Delta
    if option_type == 'CE':
        delta = math.exp(-q * T) * norm_cdf(d1)
    else:
        delta = math.exp(-q * T) * (norm_cdf(d1) - 1.0)
        
    # Gamma
    gamma = math.exp(-q * T) * norm_pdf(d1) / (spot_price * sigma * math.sqrt(T))
    
    # Vega (per 1% change in vol)
    vega = spot_price * math.exp(-q * T) * norm_pdf(d1) * math.sqrt(T) / 100.0
    
    # Theta (per day)
    term1 = -(spot_price * sigma * math.exp(-q * T) * norm_pdf(d1)) / (2 * math.sqrt(T))
    if option_type == 'CE':
        term2 = q * spot_price * math.exp(-q * T) * norm_cdf(d1)
        term3 = -r * strike_price * math.exp(-r * T) * norm_cdf(d2)
    else:
        term2 = -q * spot_price * math.exp(-q * T) * norm_cdf(-d1)
        term3 = r * strike_price * math.exp(-r * T) * norm_cdf(-d2)
        
    theta = (term1 + term2 + term3) / 365.0
    
    return {
        "iv": sigma * 100.0,  # as percentage
        "delta": delta,
        "gamma": gamma,
        "theta": theta,
        "vega": vega
    }
