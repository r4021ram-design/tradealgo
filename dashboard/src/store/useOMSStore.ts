import { create } from 'zustand';
import { Order, Fill, OMSState, PositionSummary, DerivedPosition } from '../engine/types';
import { computePositionsFromFills, calculatePositionSummaries } from '../engine/positionEngine';

interface OMSActions {
  addOrder: (order: Order) => void;
  updateOrderStatus: (orderId: string, status: Order['status']) => void;
  addFill: (fill: Fill) => void;
  updateMarketPrice: (positionKey: string, ltp: number) => void;
  clearAll: () => void;
  getDerivedPositions: () => Record<string, DerivedPosition>;
  getPositionSummaries: () => PositionSummary[];
  modifyOrderInStore: (orderId: string, price: number, qty: number) => void;
  fillPendingOrder: (orderId: string, fillPrice?: number) => void;
}

type OMSStore = OMSState & OMSActions;

export const useOMSStore = create<OMSStore>((set, get) => ({
  orders: [],
  fills: [],
  marketPrices: {},

  addOrder: (order) => set((state) => ({
    orders: [order, ...state.orders]
  })),

  updateOrderStatus: (orderId, status) => set((state) => ({
    orders: state.orders.map((o) => o.id === orderId ? { ...o, status } : o)
  })),

  addFill: (fill) => set((state) => ({
    fills: [...state.fills, fill]
  })),

  updateMarketPrice: (positionKey, ltp) => set((state) => {
    if (positionKey === '__proto__' || positionKey === 'constructor' || positionKey === 'prototype') {
      return {};
    }
    const existing = state.marketPrices[positionKey];
    return {
      marketPrices: {
        ...state.marketPrices,
        [positionKey]: {
          positionKey,
          ltp,
          lastUpdated: Date.now(),
          bid: existing?.bid,
          ask: existing?.ask,
        }
      }
    };
  }),

  clearAll: () => set({
    orders: [],
    fills: [],
    marketPrices: {}
  }),

  getDerivedPositions: () => {
    const { fills } = get();
    return computePositionsFromFills(fills);
  },

  getPositionSummaries: () => {
    const { fills, marketPrices } = get();
    const derived = computePositionsFromFills(fills);
    return calculatePositionSummaries(derived, marketPrices);
  },

  modifyOrderInStore: (orderId, price, qty) => set((state) => ({
    orders: state.orders.map((o) => o.id === orderId ? { ...o, price, qty } : o)
  })),

  fillPendingOrder: (orderId, fillPrice) => set((state) => {
    const order = state.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'PENDING') return {};

    const price = fillPrice ?? order.price;
    const fillId = `fill_${Math.random().toString(36).substr(2, 9)}`;
    const newFill: Fill = {
      id: fillId,
      orderId: order.id,
      instrument: order.instrument,
      side: order.side,
      qty: order.qty,
      price,
      timestamp: Date.now(),
    };

    return {
      orders: state.orders.map((o) => o.id === orderId ? { ...o, status: 'FILLED' as any } : o),
      fills: [...state.fills, newFill]
    };
  })
}));
