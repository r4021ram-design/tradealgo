export type MarketState = 'LIVE' | 'DELAYED' | 'MARKET_CLOSED' | 'HOLIDAY' | 'DISCONNECTED' | 'RECONNECTING';

export type DataSource = 'WEBSOCKET' | 'POLLING' | 'SNAPSHOT' | 'HISTORICAL';

export interface MarketStatus {
  marketOpen: boolean;
  marketStatus: string;
  nextOpenTime: Date | string;
  sessionType: string;
}
