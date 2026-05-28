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
      sell: 'Sell'
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
