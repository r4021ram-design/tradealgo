import { create } from 'zustand';
import { getApiUrl } from '../utils/api';

// Empty initial state — populated from live API only
const initialPositions = [];
const initialMarketWatch = [];

export const useTerminalStore = create((set, get) => ({
  positions: initialPositions,
  marketWatch: initialMarketWatch,
  availableMargin: 0,
  marginUsed: 0,
  niftySpot: 23985.0,
  bankNiftySpot: 55138.0,

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
  setMarketWatch: (data) => set({ marketWatch: data }),
  setPositions: (positions) => set({ positions }),
  setMargins: (availableMargin, marginUsed) => set({ availableMargin, marginUsed }),
  setNiftySpot: (niftySpot) => set({ niftySpot }),
  setBankNiftySpot: (bankNiftySpot) => set({ bankNiftySpot }),

  updateOptionChainRow: (strike, side, updates) => set((state) => ({
    optionChain: state.optionChain.map(row => {
      if (row.strike === strike) {
        return {
          ...row,
          [side]: { ...row[side], ...updates }
        };
      }
      return row;
    })
  })),

  // Order Modal State
  orderModal: {
    isOpen: false,
    type: 'BUY', // 'BUY' or 'SELL'
    symbol: '',
    price: 0
  },

  openOrderModal: (type, symbol = '', price = 0) => set({
    orderModal: { isOpen: true, type, symbol, price }
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
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      console.log('Strategy Executed:', data);
      return data;
    } catch (error) {
      console.error('Execution Failed:', error);
      throw error;
    }
  }
}));
