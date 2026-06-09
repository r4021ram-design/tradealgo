import { StoreApi, UseBoundStore } from 'zustand';

export interface OrderModalState {
  isOpen: boolean;
  type: 'BUY' | 'SELL';
  symbol: string;
  price: number;
  token: string;
  exchangeSegment: string;
  expiry: string;
  lotSize: number;
}

export interface TerminalStore {
  positions: any[];
  marketWatch: any[];
  addedSymbols: any[];
  availableMargin: number;
  marginUsed: number;
  niftySpot: number;
  bankNiftySpot: number;
  nifty: { ltp: number; change: number; percentChange: number };
  banknifty: { ltp: number; change: number; percentChange: number };
  sensex: { ltp: number; change: number; percentChange: number };
  indiavix: { ltp: number; change: number; percentChange: number };
  activeView: string;
  setActiveView: (view: string) => void;
  selectedUnderlying: string;
  selectedExpiry: string;
  availableExpiries: string[];
  availableUnderlyings: string[];
  spotPrice: number;
  optionChain: any[];
  setUnderlying: (underlying: string) => void;
  setExpiry: (expiry: string) => void;
  setSpotPrice: (price: number) => void;
  setAvailableExpiries: (expiries: string[]) => void;
  setAvailableUnderlyings: (underlyings: string[]) => void;
  setOptionChain: (chain: any[]) => void;
  setMarketWatch: (data: any[]) => void;
  addSymbolToWatchlist: (symbolObj: any) => void;
  removeSymbolFromWatchlist: (symbolName: string) => void;
  setPositions: (positions: any[]) => void;
  setMargins: (availableMargin: number, marginUsed: number) => void;
  setNiftySpot: (niftySpot: number) => void;
  setBankNiftySpot: (bankNiftySpot: number) => void;
  setNifty: (nifty: { ltp: number; change: number; percentChange: number }) => void;
  setBankNifty: (banknifty: { ltp: number; change: number; percentChange: number }) => void;
  setSensex: (sensex: { ltp: number; change: number; percentChange: number }) => void;
  setIndiaVix: (indiavix: { ltp: number; change: number; percentChange: number }) => void;
  updateOptionChainRow: (strike: number, side: 'ce' | 'pe', updates: any) => void;
  orderModal: OrderModalState;
  openOrderModal: (type: 'BUY' | 'SELL', symbol?: string, price?: number, extra?: Partial<OrderModalState>) => void;
  closeOrderModal: () => void;
  updateTick: (symbol: string, newLtp: number, extraData?: any) => void;
  updateMarketWatchTick: (symbol: string, updates: any) => void;
  squareOff: (symbol: string) => void;
  executeStrategy: (name: string, legs: any[]) => Promise<any>;
  theme: string;
  toggleTheme: () => void;
}

export declare const useTerminalStore: UseBoundStore<StoreApi<TerminalStore>>;
