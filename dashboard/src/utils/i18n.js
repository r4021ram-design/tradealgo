import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      lotSize: 'Lot size:',
      intraday: 'Intraday',
      longterm: 'Longterm',
      advanced: 'Advanced ⌄',
      mtfTitle: 'Margin Trading Facility (MTF)',
      mtfDesc: 'enables you to buy delivery stocks by paying only a fraction of the value. Product type is forced to CNC.',
      qty: 'Qty.',
      price: 'Price',
      triggerPriceRequired: 'Trigger price *',
      triggerPrice: 'Trigger price',
      numberOfLegs: 'Number of Legs',
      legQty: 'Leg Qty',
      totalColon: 'Total:',
      market: 'Market',
      limit: 'Limit',
      coverOrderNote: 'Cover orders require a mandatory stop-loss. The order is placed as a Limit order, with an attached Stop-Loss Market order.',
      gtt: 'GTT',
      stoploss: 'Stoploss',
      target: 'Target',
      marginReq: 'Margin Req:',
      available: 'Available',
      cancel: 'Cancel',
      marketDepth: 'Market depth',
      bid: 'Bid',
      orders: 'Orders',
      qtyAbbr: 'Qty.',
      offer: 'Offer',
      total: 'Total',
      buy: 'Buy',
      sell: 'Sell',
      portfolioRealtimeSummary: 'Portfolio Realtime Summary',
      realizedPnl: 'Realized PnL',
      unrealizedPnl: 'Unrealized PnL',
      totalMtm: 'Total MTM',
      derivedFrom: 'Derived from',
      clearData: 'Clear Data',
      orderSimulator: 'Order Simulator',
      segment: 'Segment',
      equityEq: 'Equity (EQ)',
      futuresFut: 'Futures (FUT)',
      optionsOpt: 'Options (OPT)',
      symbol: 'Symbol',
      side: 'Side',
      buyLong: 'BUY / LONG',
      sellShort: 'SELL / SHORT',
      quantity: 'Quantity',
      priceRupees: 'Price (₹)',
      expiry: 'Expiry',
      strikePrice: 'Strike Price',
      optionType: 'Option Type',
      ceCall: 'CE / CALL',
      pePut: 'PE / PUT',
      initialOrderStatus: 'Initial Order Status',
      filledAuto: 'FILLED (Auto-executes matching & PnL)',
      pendingAllows: 'PENDING (Allows Mod/Del/Fill in Order Book)',
      liveLtpPreset: 'Live LTP / Preset Testing',
      positionKey: 'Position Key',
      selectPosition: 'Select Position...',
      ltpRupees: 'LTP (₹)',
      update: 'Update',
      runPresetScenario: 'Run Preset Scenario',
      fifoPositionMatching: 'FIFO Position Matching',
      positionFlipLongShort: 'Position Flip (Long to Short)',
      multiSegmentOptFut: 'Multi-segment Options & Futures',
      placeFillSimulationOrder: 'Place & Fill Simulation Order',
      placePendingSimulationOrder: 'Place Pending Simulation Order'
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
