// ─── Enums ───────────────────────────────────────────────────────────────────

export enum Segment {
  EQ = 'EQ',
  FUT = 'FUT',
  OPT = 'OPT',
}

export enum Side {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OptionType {
  CE = 'CE',
  PE = 'PE',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

// ─── Instrument ──────────────────────────────────────────────────────────────

export interface Instrument {
  symbol: string;
  segment: Segment;
  expiry?: string;        // e.g. "27JUN2026"
  strikePrice?: number;   // e.g. 24500
  optionType?: OptionType; // CE or PE
}

// ─── Order ───────────────────────────────────────────────────────────────────

export interface Order {
  id: string;
  instrument: Instrument;
  side: Side;
  qty: number;
  price: number;
  status: OrderStatus;
  timestamp: number; // epoch ms
}

// ─── Fill / Trade ────────────────────────────────────────────────────────────

export interface Fill {
  id: string;
  orderId: string;
  instrument: Instrument;
  side: Side;
  qty: number;
  price: number;
  timestamp: number;
}

// ─── Open Trade (FIFO queue entry) ───────────────────────────────────────────

export interface OpenTrade {
  id: string;
  instrument: Instrument;
  side: Side;
  qty: number;
  remainingQty: number;
  avgPrice: number;
  timestamp: number;
}

// ─── Closed Trade (matched pair) ─────────────────────────────────────────────

export interface ClosedTrade {
  id: string;
  instrument: Instrument;
  entrySide: Side;
  exitSide: Side;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  entryTime: number;
  exitTime: number;
}

// ─── Derived Position (computed from fills) ──────────────────────────────────

export interface DerivedPosition {
  positionKey: string;
  instrument: Instrument;
  netQty: number;           // positive = LONG, negative = SHORT
  avgBuyPrice: number;
  avgSellPrice: number;
  totalBuyQty: number;
  totalSellQty: number;
  realizedPnl: number;
  openTrades: OpenTrade[];
  closedTrades: ClosedTrade[];
}

// ─── Market Price ────────────────────────────────────────────────────────────

export interface MarketPrice {
  positionKey: string;
  ltp: number;
  bid?: number;
  ask?: number;
  lastUpdated: number;
}

// ─── Position Summary (for UI display) ───────────────────────────────────────

export interface PositionSummary {
  positionKey: string;
  instrument: Instrument;
  netQty: number;
  side: 'LONG' | 'SHORT' | 'FLAT';
  avgPrice: number;
  ltp: number;
  realizedPnl: number;
  unrealizedPnl: number;
  mtm: number;
}

// ─── OMS State ───────────────────────────────────────────────────────────────

export interface OMSState {
  orders: Order[];
  fills: Fill[];
  marketPrices: Record<string, MarketPrice>;
}
