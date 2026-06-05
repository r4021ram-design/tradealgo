import { create } from 'zustand';
import { getApiUrl } from '../utils/api';

// Empty initial state — populated from live API only
const initialPositions = [];
const initialMarketWatch = [];
const savedSymbols = JSON.parse(localStorage.getItem('added_symbols') || '[]');

export const useTerminalStore = create((set, get) => ({
  positions: initialPositions,
  marketWatch: savedSymbols,
  addedSymbols: savedSymbols,
  availableMargin: 0,
  marginUsed: 0,
  niftySpot: 23985.0,
  bankNiftySpot: 55138.0,
  activeView: 'terminal', // 'terminal' or 'oms'
  setActiveView: (activeView) => set({ activeView }),


  // --- Option Chain State ---
  selectedUnderlying: 'NIFTY',
  selectedExpiry: '',
  availableExpiries: [],
  availableUnderlyings: ['NIFTY', 'BANKNIFTY', 'SENSEX'],
  spotPrice: 0,
  optionChain: [],

  setUnderlying: (underlying) => set({ selectedUnderlying: underlying }),
  setExpiry: (expiry) => set({ selectedExpiry: expiry }),
  setSpotPrice: (price) => set({ spotPrice: price }),
  setAvailableExpiries: (expiries) => set({ availableExpiries: expiries }),
  setAvailableUnderlyings: (underlyings) => set({ availableUnderlyings: underlyings }),
  setOptionChain: (chain) => set({ optionChain: chain }),
  
  setMarketWatch: (data) => set((state) => {
    const customAdded = state.addedSymbols || [];
    const merged = [...data];
    customAdded.forEach(item => {
      if (!merged.some(m => m.symbol === item.symbol)) {
        merged.push(item);
      }
    });
    return { marketWatch: merged };
  }),

  addSymbolToWatchlist: (symbolObj) => set((state) => {
    const existing = state.addedSymbols || [];
    if (existing.some(x => x.symbol === symbolObj.symbol)) return {};
    
    const newSymbol = {
      symbol: symbolObj.symbol,
      bidQty: 0,
      bidPrice: symbolObj.ltp || 0,
      askPrice: symbolObj.ltp || 0,
      askQty: 0,
      ltp: symbolObj.ltp || 0,
      change: 0,
      volume: 0,
      oi: 0,
      oiChange: 0,
      iv: 0,
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      ...symbolObj
    };

    const updated = [...existing, newSymbol];
    localStorage.setItem('added_symbols', JSON.stringify(updated));

    // Also update current active marketWatch
    const currentMw = [...state.marketWatch];
    if (!currentMw.some(m => m.symbol === newSymbol.symbol)) {
      currentMw.push(newSymbol);
    }

    return { addedSymbols: updated, marketWatch: currentMw };
  }),

  removeSymbolFromWatchlist: (symbolName) => set((state) => {
    const existing = state.addedSymbols || [];
    const updated = existing.filter(x => x.symbol !== symbolName);
    localStorage.setItem('added_symbols', JSON.stringify(updated));

    const currentMw = state.marketWatch.filter(x => x.symbol !== symbolName);
    return { addedSymbols: updated, marketWatch: currentMw };
  }),

  setPositions: (positions) => set({ positions }),
  setMargins: (availableMargin, marginUsed) => set({ availableMargin, marginUsed }),
  setNiftySpot: (niftySpot) => set({ niftySpot }),
  setBankNiftySpot: (bankNiftySpot) => set({ bankNiftySpot }),

  updateOptionChainRow: (strike, side, updates) => set((state) => {
    if (side !== 'ce' && side !== 'pe') return {};
    return {
      optionChain: state.optionChain.map(row => {
        if (row.strike === strike) {
          return {
            ...row,
            [side]: { ...row[side], ...updates }
          };
        }
        return row;
      })
    };
  }),

  // Order Modal State
  orderModal: {
    isOpen: false,
    type: 'BUY', // 'BUY' or 'SELL'
    symbol: '',
    price: 0,
    token: '',
    exchangeSegment: 'nse_fo',
    expiry: '',
    lotSize: 0,
  },

  openOrderModal: (type, symbol = '', price = 0, extra = {}) => set({
    orderModal: {
      isOpen: true,
      type,
      symbol,
      price,
      token: extra.token || '',
      exchangeSegment: extra.exchangeSegment || 'nse_fo',
      expiry: extra.expiry || '',
      lotSize: extra.lotSize || 0,
    }
  }),

  closeOrderModal: () => set((state) => ({
    orderModal: { ...state.orderModal, isOpen: false }
  })),

  // Action to update LTP and tick direction
  updateTick: (symbol, newLtp) => set((state) => {
    const updateLtp = (items) => items.map(item => {
      if (item.symbol === symbol) {
        const tickDirection = newLtp > item.ltp ? 1 : newLtp < item.ltp ? -1 : 0;
        return { ...item, ltp: newLtp, tickDirection };
      }
      return item;
    });

    return {
      positions: updateLtp(state.positions),
      marketWatch: updateLtp(state.marketWatch)
    };
  }),

  // Enhanced tick update for market watch with OI/Volume changes
  updateMarketWatchTick: (symbol, updates) => set((state) => ({
    marketWatch: state.marketWatch.map(item => {
      if (item.symbol === symbol) {
        const tickDirection = updates.ltp > item.ltp ? 1 : updates.ltp < item.ltp ? -1 : 0;
        return { ...item, ...updates, tickDirection };
      }
      return item;
    }),
    addedSymbols: (state.addedSymbols || []).map(item => {
      if (item.symbol === symbol) {
        return { ...item, ...updates };
      }
      return item;
    })
  })),

  // Square off position
  squareOff: (symbol) => set((state) => ({
    positions: state.positions.map(p => {
      if (p.symbol === symbol) {
        const unrealized = p.netQty > 0 ? (p.ltp - p.avgBuyPrice) * p.netQty : (p.avgSellPrice - p.ltp) * Math.abs(p.netQty);
        return { ...p, netQty: 0, realizedPnl: p.realizedPnl + unrealized };
      }
      return p;
    })
  })),

  // Execute multi-leg strategy
  executeStrategy: async (name, legs) => {
    try {
      const response = await fetch(getApiUrl('/api/strategy/execute'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, legs })
      });
      if (!response.ok) {
        const text = await response.text();
        let errMsg = text;
        try {
          const parsed = JSON.parse(text);
          if (parsed && parsed.detail) {
            errMsg = parsed.detail;
          }
        } catch (e) {}
        throw new Error(errMsg);
      }
      const data = await response.json();
      console.log('Strategy Executed:', data);
      return data;
    } catch (error) {
      console.error('Execution Failed:', error);
      throw error;
    }
  },

  // --- Paper Trading Mode ---
  isPaperTrade: true,
  fetchPaperTradeStatus: async () => {
    try {
      const response = await fetch(getApiUrl('/api/config/paper-trade'));
      if (response.ok) {
        const data = await response.json();
        set({ isPaperTrade: data.paper_trade });
      }
    } catch (error) {
      console.error('Failed to fetch paper trade status:', error);
    }
  },
  togglePaperTrade: async (val) => {
    try {
      const response = await fetch(getApiUrl('/api/config/paper-trade'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper_trade: val })
      });
      if (response.ok) {
        set({ isPaperTrade: val });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to set paper trade status:', error);
      return false;
    }
  },
  theme: localStorage.getItem('app_theme') || 'light',
  toggleTheme: () => set((state) => {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('app_theme', newTheme);
    return { theme: newTheme };
  })
}));
