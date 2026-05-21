import { create } from 'zustand';

export const usePortfolioStore = create((set, get) => ({
  // Portfolio Parameters
  underlyingPrice: 22000,
  interestRate: 0.05, // 5%
  dividendYield: 0.00,
  targetDate: new Date(),
  
  // Array of legs for complex portfolios (up to 20+)
  legs: [],

  // Global Scenario Analysis Adjustments
  scenarioVolShift: 0, // e.g., +0.02 for +2% IV
  scenarioPriceShift: 0, // e.g., +100 for +100 points
  scenarioDaysShift: 0, // e.g., +5 for +5 days passed

  // Actions
  addLeg: (leg) => set((state) => ({
    legs: [...state.legs, {
      id: Date.now().toString() + Math.random().toString(),
      isOpen: true,
      size: leg.size || 1, // positive for buy, negative for sell
      strike: leg.strike || state.underlyingPrice,
      type: leg.type || 'Call',
      expDate: leg.expDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      dte: leg.dte || 30,
      entryPrice: leg.entryPrice || 0,
      exitPrice: leg.exitPrice || 0,
      iv: leg.iv || 0.20, // 20% default IV
    }]
  })),

  updateLeg: (id, updates) => set((state) => ({
    legs: state.legs.map(leg => leg.id === id ? { ...leg, ...updates } : leg)
  })),

  removeLeg: (id) => set((state) => ({
    legs: state.legs.filter(leg => leg.id !== id)
  })),

  clearLegs: () => set({ legs: [] }),

  setGlobalParams: (params) => set((state) => ({
    ...state,
    ...params
  })),

  loadStrategyPreset: (strategyType, spotPrice, optionChain = []) => {
    let newLegs = [];
    const atm = Math.round(spotPrice / 50) * 50; // Assuming 50 point intervals for NIFTY

    const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const getOptionData = (strike, type, size) => {
      if (!optionChain || optionChain.length === 0) return { price: 100, iv: 0.20 };
      const row = optionChain.find(r => r.strike === strike);
      if (!row) return { price: 100, iv: 0.20 };
      
      const opt = type === 'Call' ? row.ce : row.pe;
      const symbol = type === 'Call' ? row.ce_symbol : row.pe_symbol;
      // Buy -> pay ask, Sell -> get bid
      const price = size > 0 ? (opt.askPrice || opt.ltp) : (opt.bidPrice || opt.ltp);
      const iv = (opt.iv || 20) / 100;
      return { price: price || 100, iv: iv || 0.20, symbol: symbol || '' };
    };

    const createLeg = (type, size, strike) => {
      // Simulate underlying stock if strike is 0
      if (strike === 0) {
        return {
          id: Date.now().toString() + Math.random().toString(),
          isOpen: true, size, strike, type, expDate: exp, dte: 7, entryPrice: spotPrice, exitPrice: 0, iv: 0, symbol: 'NIFTY INDEX'
        };
      }
      const { price, iv, symbol } = getOptionData(strike, type, size);
      return {
        id: Date.now().toString() + Math.random().toString(),
        isOpen: true, size, strike, type, expDate: exp, dte: 7, entryPrice: price, exitPrice: 0, iv: iv, symbol
      };
    };

    switch (strategyType) {
      // --- SINGLE LEG ---
      case 'Long Call':
        newLegs = [createLeg('Call', 1, atm)];
        break;
      case 'Short Call':
        newLegs = [createLeg('Call', -1, atm)];
        break;
      case 'Long Put':
        newLegs = [createLeg('Put', 1, atm)];
        break;
      case 'Short Put':
        newLegs = [createLeg('Put', -1, atm)];
        break;

      // --- DIRECTIONAL SPREADS ---
      case 'Bull Call Spread':
        newLegs = [
          createLeg('Call', 1, atm),
          createLeg('Call', -1, atm + 100)
        ];
        break;
      case 'Bear Call Spread':
        newLegs = [
          createLeg('Call', -1, atm),
          createLeg('Call', 1, atm + 100)
        ];
        break;
      case 'Bull Put Spread':
        newLegs = [
          createLeg('Put', 1, atm - 100),
          createLeg('Put', -1, atm)
        ];
        break;
      case 'Bear Put Spread':
        newLegs = [
          createLeg('Put', 1, atm),
          createLeg('Put', -1, atm - 100)
        ];
        break;

      // --- VOLATILITY (NEUTRAL / BREAKOUT) ---
      case 'Straddle':
        newLegs = [
          createLeg('Call', 1, atm),
          createLeg('Put', 1, atm)
        ];
        break;
      case 'Short Straddle':
        newLegs = [
          createLeg('Call', -1, atm),
          createLeg('Put', -1, atm)
        ];
        break;
      case 'Strangle':
        newLegs = [
          createLeg('Call', 1, atm + 100),
          createLeg('Put', 1, atm - 100)
        ];
        break;
      case 'Short Strangle':
        newLegs = [
          createLeg('Call', -1, atm + 100),
          createLeg('Put', -1, atm - 100)
        ];
        break;
      case 'Iron Condor':
        newLegs = [
          createLeg('Put', 1, atm - 200),
          createLeg('Put', -1, atm - 100),
          createLeg('Call', -1, atm + 100),
          createLeg('Call', 1, atm + 200),
        ];
        break;
      case 'Iron Butterfly':
        newLegs = [
          createLeg('Put', 1, atm - 100),
          createLeg('Put', -1, atm),
          createLeg('Call', -1, atm),
          createLeg('Call', 1, atm + 100),
        ];
        break;
      case 'Call Butterfly':
        newLegs = [
          createLeg('Call', 1, atm - 100),
          createLeg('Call', -2, atm),
          createLeg('Call', 1, atm + 100),
        ];
        break;
      case 'Put Butterfly':
        newLegs = [
          createLeg('Put', 1, atm + 100),
          createLeg('Put', -2, atm),
          createLeg('Put', 1, atm - 100),
        ];
        break;

      // --- HEDGING / INCOME ---
      case 'Covered Call':
        // Synthetic Covered Call (Long Stock + Short Call)
        // Since we only model options here, we represent the stock as a Call with 0 strike or we can just model the short call part.
        // For accurate payoff of Covered Call, we use a deep ITM call to simulate stock.
        newLegs = [
          createLeg('Call', 1, 0), // Simulates long stock
          createLeg('Call', -1, atm + 100)
        ];
        break;
      case 'Protective Put':
        newLegs = [
          createLeg('Call', 1, 0), // Simulates long stock
          createLeg('Put', 1, atm - 100)
        ];
        break;
      case 'Collar':
        newLegs = [
          createLeg('Call', 1, 0), // Simulates long stock
          createLeg('Put', 1, atm - 100),
          createLeg('Call', -1, atm + 100)
        ];
        break;
    }
    set({ legs: newLegs, underlyingPrice: spotPrice });
  }
}));
