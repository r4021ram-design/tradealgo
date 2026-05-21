/**
 * Black-Scholes Options Pricing Engine
 */

// Standard normal cumulative distribution function (CDF)
function CND(x) {
  const a1 = 0.31938153;
  const a2 = -0.356563782;
  const a3 = 1.781477937;
  const a4 = -1.821255978;
  const a5 = 1.330274429;
  const L = Math.abs(x);
  const K = 1.0 / (1.0 + 0.2316419 * L);
  let res = 1.0 - 1.0 / Math.sqrt(2.0 * Math.PI) * Math.exp(-L * L / 2.0) * (a1 * K + a2 * K * K + a3 * Math.pow(K, 3) + a4 * Math.pow(K, 4) + a5 * Math.pow(K, 5));
  if (x < 0) {
    res = 1.0 - res;
  }
  return res;
}

// Standard normal probability density function (PDF)
function ND(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2.0 * Math.PI);
}

/**
 * Calculate Black-Scholes theoretical price and Greeks
 * @param {string} type 'Call' or 'Put'
 * @param {number} S Underlying Price (Spot)
 * @param {number} K Strike Price
 * @param {number} T Time to Expiration (in years, e.g., DTE / 365)
 * @param {number} r Risk-free interest rate (decimal, e.g., 0.05 for 5%)
 * @param {number} v Volatility (Implied Volatility as decimal, e.g., 0.20 for 20%)
 * @param {number} q Dividend Yield (decimal, e.g., 0.0)
 * @returns {object} { price, delta, gamma, theta, vega, rho }
 */
export function calculateBlackScholes(type, S, K, T, r, v, q = 0) {
  const isCall = type.toLowerCase() === 'call' || type.toLowerCase() === 'ce';
  
  if (T <= 0) {
    // Expiration logic
    const intrinsicValue = isCall ? Math.max(0, S - K) : Math.max(0, K - S);
    return {
      price: intrinsicValue,
      delta: isCall ? (S > K ? 1 : 0) : (S < K ? -1 : 0),
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0
    };
  }

  // Prevent divide by zero if v is very small
  const vol = Math.max(v, 0.0001);

  const d1 = (Math.log(S / K) + (r - q + (vol * vol) / 2.0) * T) / (vol * Math.sqrt(T));
  const d2 = d1 - vol * Math.sqrt(T);

  let price, delta, theta, rho;

  const gamma = (ND(d1) * Math.exp(-q * T)) / (S * vol * Math.sqrt(T));
  const vega = S * ND(d1) * Math.sqrt(T) * Math.exp(-q * T); // Note: commonly divided by 100 for 1% change

  if (isCall) {
    price = S * Math.exp(-q * T) * CND(d1) - K * Math.exp(-r * T) * CND(d2);
    delta = Math.exp(-q * T) * CND(d1);
    theta = (-(S * vol * ND(d1) * Math.exp(-q * T)) / (2 * Math.sqrt(T)) 
             - r * K * Math.exp(-r * T) * CND(d2) 
             + q * S * Math.exp(-q * T) * CND(d1)); // Daily theta usually / 365
    rho = K * T * Math.exp(-r * T) * CND(d2); // Per 1% usually / 100
  } else {
    price = K * Math.exp(-r * T) * CND(-d2) - S * Math.exp(-q * T) * CND(-d1);
    delta = Math.exp(-q * T) * (CND(d1) - 1);
    theta = (-(S * vol * ND(d1) * Math.exp(-q * T)) / (2 * Math.sqrt(T)) 
             + r * K * Math.exp(-r * T) * CND(-d2) 
             - q * S * Math.exp(-q * T) * CND(-d1));
    rho = -K * T * Math.exp(-r * T) * CND(-d2);
  }

  // Standardize greeks to common units (Vega, Theta per day, Rho per 1%)
  return {
    price,
    delta,
    gamma,
    theta: theta / 365,
    vega: vega / 100,
    rho: rho / 100
  };
}

/**
 * Helper to calculate payoff at expiration for a multi-leg strategy
 * Supports two leg formats:
 *   - Portfolio store format: { type, size, strike, entryPrice, isOpen }
 *     where size is signed (positive = buy, negative = sell)
 *   - Legacy format: { type, action, qty, strike, entryPrice }
 * @param {Array} legs Array of leg objects
 * @param {number} spotPrice Underlying price at expiration
 * @returns {number} Net Profit/Loss
 */
export function calculateExpirationPayoff(legs, spotPrice) {
  return legs.reduce((totalPnL, leg) => {
    // Skip closed legs if the flag exists
    if (leg.isOpen === false) return totalPnL;

    const isCall = leg.type.toLowerCase() === 'call' || leg.type.toLowerCase() === 'ce';

    // Determine quantity multiplier: support both {size} and {action, qty} formats
    let qtyMultiplier;
    if (leg.size !== undefined) {
      // Portfolio store format: size is already signed (positive=buy, negative=sell)
      qtyMultiplier = leg.size;
    } else if (leg.action !== undefined && leg.qty !== undefined) {
      // Legacy format
      const isBuy = leg.action.toLowerCase() === 'buy';
      qtyMultiplier = isBuy ? leg.qty : -leg.qty;
    } else {
      return totalPnL; // Skip malformed legs
    }
    
    let intrinsic = 0;
    if (isCall) {
      intrinsic = Math.max(0, spotPrice - leg.strike);
    } else {
      intrinsic = Math.max(0, leg.strike - spotPrice);
    }
    
    const legPnL = (intrinsic - leg.entryPrice) * qtyMultiplier;
    return totalPnL + legPnL;
  }, 0);
}
