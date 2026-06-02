import React, { useState, useEffect } from 'react';
import { useOMSStore } from '../../store/useOMSStore';
import { useTerminalStore } from '../../store/useTerminalStore';
import { Segment, Side, OptionType, OrderStatus, Order, Fill } from '../../engine/types';
import { generatePositionKey } from '../../engine/instrumentRegistry';
import { useTranslation } from 'react-i18next';

export const NetPositionWindow: React.FC = () => {
  const { t } = useTranslation();
  const { fills, addOrder, addFill, clearAll, updateMarketPrice, getPositionSummaries } = useOMSStore();

  // Local state for custom order placement
  const [symbol, setSymbol] = useState('RELIANCE');
  const [segment, setSegment] = useState<Segment>(Segment.EQ);
  const [side, setSide] = useState<Side>(Side.BUY);
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(2500);
  const [expiry, setExpiry] = useState('27JUN2026');
  const [strike, setStrike] = useState(2500);
  const [optionType, setOptionType] = useState<OptionType>(OptionType.CE);
  const [initialStatus, setInitialStatus] = useState<'FILLED' | 'PENDING'>('FILLED');

  // Helper to determine single lot size based on symbol prefix
  const getLotSize = (sym: string) => {
    if (!sym) return 1;
    const upperSym = sym.toUpperCase();
    if (upperSym.startsWith('NIFTY')) return 65;
    if (upperSym.startsWith('BANKNIFTY')) return 30;
    if (upperSym.startsWith('FINNIFTY')) return 60;
    if (upperSym.startsWith('MIDCPNIFTY')) return 120;
    if (upperSym.startsWith('SENSEX')) return 20;
    if (upperSym.startsWith('BANKEX')) return 30;
    return 1; // Default for equity
  };

  // Helper to calculate At-The-Money (ATM) strike price based on live spot prices
  const getAtmStrike = (sym: string) => {
    const upperSym = sym.toUpperCase();
    const niftySpot = useTerminalStore.getState().niftySpot || 24000;
    const bankNiftySpot = useTerminalStore.getState().bankNiftySpot || 55100;
    
    if (upperSym.startsWith('NIFTY')) {
      return Math.round(niftySpot / 50) * 50;
    } else if (upperSym.startsWith('BANKNIFTY')) {
      return Math.round(bankNiftySpot / 100) * 100;
    } else if (upperSym.startsWith('FINNIFTY')) {
      return Math.round(niftySpot / 50) * 50;
    } else if (upperSym.startsWith('MIDCPNIFTY')) {
      return Math.round(niftySpot / 25) * 25;
    } else if (upperSym.startsWith('SENSEX')) {
      return Math.round(78000 / 100) * 100;
    } else if (upperSym.startsWith('BANKEX')) {
      return Math.round(55100 / 100) * 100;
    }
    return 2500; // Default for stock options (like RELIANCE)
  };

  // Sync Quantity, Bid/Ask Price, and ATM Strike when Segment, Symbol, or Side changes
  useEffect(() => {
    // 1. Update Quantity: 1 for EQ, single lot size for FUT/OPT
    if (segment === Segment.EQ) {
      setQty(1);
    } else {
      setQty(getLotSize(symbol));
    }

    // 2. Update ATM Strike for Options
    if (segment === Segment.OPT) {
      setStrike(getAtmStrike(symbol));
    }

    // 3. Fetch or estimate Bid/Ask rate
    const mw = useTerminalStore.getState().marketWatch || [];
    const positions = useTerminalStore.getState().positions || [];
    
    // Find the symbol in live market watch or active positions to get live bid/ask rate
    const liveMatch = mw.find((item: any) => item.symbol === symbol) || 
                      positions.find((item: any) => item.symbol === symbol);

    let defaultPrice = 2500;
    if (segment === Segment.EQ) {
      if (symbol === 'RELIANCE') defaultPrice = 2500;
      else if (symbol === 'INFY') defaultPrice = 1500;
      else if (symbol === 'TCS') defaultPrice = 3800;
      else defaultPrice = 100;
    } else if (segment === Segment.FUT) {
      if (symbol.startsWith('NIFTY')) defaultPrice = 23900;
      else if (symbol.startsWith('BANKNIFTY')) defaultPrice = 55000;
      else if (symbol.startsWith('SENSEX')) defaultPrice = 78000;
      else defaultPrice = 1000;
    } else { // Segment.OPT
      defaultPrice = 150;
    }

    if (liveMatch) {
      // In trading:
      // BUY side -> pays Ask / Offer price (sellers' price)
      // SELL side -> gets Bid price (buyers' price)
      const bidRate = liveMatch.bid || liveMatch.ltp || defaultPrice;
      const askRate = liveMatch.ask || liveMatch.ltp || defaultPrice;
      
      setPrice(side === Side.BUY ? askRate : bidRate);
    } else {
      setPrice(defaultPrice);
    }
  }, [segment, symbol, side]);

  // Custom LTP update state
  const [ltpUpdateKey, setLtpUpdateKey] = useState('');
  const [ltpUpdateValue, setLtpUpdateValue] = useState(2500);

  const summaries = getPositionSummaries();
  const totalRealized = summaries.reduce((sum, p) => sum + p.realizedPnl, 0);
  const totalUnrealized = summaries.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const totalMtm = totalRealized + totalUnrealized;

  const handlePlaceOrder = () => {
    const orderId = `ord_${Math.random().toString(36).substr(2, 9)}`;
    const instrument = {
      symbol,
      segment,
      ...(segment !== Segment.EQ ? { expiry } : {}),
      ...(segment === Segment.OPT ? { strikePrice: strike, optionType } : {}),
    };

    const newOrder: Order = {
      id: orderId,
      instrument,
      side,
      qty,
      price,
      status: initialStatus as any,
      timestamp: Date.now(),
    };

    addOrder(newOrder);

    if (initialStatus === 'FILLED') {
      const fillId = `fill_${Math.random().toString(36).substr(2, 9)}`;
      const newFill: Fill = {
        id: fillId,
        orderId,
        instrument,
        side,
        qty,
        price,
        timestamp: Date.now(),
      };

      // Auto-update LTP to match the transaction price initially
      const key = generatePositionKey(instrument);
      updateMarketPrice(key, price);
      addFill(newFill);
    }
  };

  const handleUpdateLtp = () => {
    if (!ltpUpdateKey) return;
    updateMarketPrice(ltpUpdateKey, ltpUpdateValue);
  };

  // Preset scenarios to make testing a breeze
  const runPresetScenario = (type: string) => {
    clearAll();
    const now = Date.now();
    const mockInstrumentEQ = { symbol: 'INFY', segment: Segment.EQ };
    const mockInstrumentFUT = { symbol: 'NIFTY', segment: Segment.FUT, expiry: '30JUN2026' };
    const mockInstrumentOPT = { symbol: 'BANKNIFTY', segment: Segment.OPT, expiry: '30JUN2026', strikePrice: 52000, optionType: OptionType.CE };

    if (type === 'fifo_match') {
      // Scenario 1: FIFO partial square off and profit taking
      const key = generatePositionKey(mockInstrumentEQ);
      
      const f1: Fill = { id: 'f1', orderId: 'o1', instrument: mockInstrumentEQ, side: Side.BUY, qty: 100, price: 1500, timestamp: now };
      const f2: Fill = { id: 'f2', orderId: 'o2', instrument: mockInstrumentEQ, side: Side.SELL, qty: 60, price: 1550, timestamp: now + 1000 };
      const f3: Fill = { id: 'f3', orderId: 'o3', instrument: mockInstrumentEQ, side: Side.SELL, qty: 40, price: 1580, timestamp: now + 2000 };
      
      [f1, f2, f3].forEach((f) => {
        addOrder({ id: f.orderId, instrument: f.instrument, side: f.side, qty: f.qty, price: f.price, status: OrderStatus.FILLED, timestamp: f.timestamp });
        addFill(f);
      });
      updateMarketPrice(key, 1580);

    } else if (type === 'position_flip') {
      // Scenario 2: Position Flipping (Long to Short)
      const key = generatePositionKey(mockInstrumentFUT);
      
      const f1: Fill = { id: 'f1', orderId: 'o1', instrument: mockInstrumentFUT, side: Side.BUY, qty: 50, price: 23000, timestamp: now };
      const f2: Fill = { id: 'f2', orderId: 'o2', instrument: mockInstrumentFUT, side: Side.SELL, qty: 120, price: 23100, timestamp: now + 1000 };
      
      [f1, f2].forEach((f) => {
        addOrder({ id: f.orderId, instrument: f.instrument, side: f.side, qty: f.qty, price: f.price, status: OrderStatus.FILLED, timestamp: f.timestamp });
        addFill(f);
      });
      updateMarketPrice(key, 23080); // Current LTP is 23080, showing short position profit/loss

    } else if (type === 'option_multisegment') {
      // Scenario 3: Multi-segment options and futures
      const keyOpt = generatePositionKey(mockInstrumentOPT);
      const keyFut = generatePositionKey(mockInstrumentFUT);

      const f1: Fill = { id: 'f1', orderId: 'o1', instrument: mockInstrumentOPT, side: Side.BUY, qty: 15, price: 350, timestamp: now };
      const f2: Fill = { id: 'f2', orderId: 'o2', instrument: mockInstrumentOPT, side: Side.BUY, qty: 30, price: 380, timestamp: now + 500 };
      const f3: Fill = { id: 'f3', orderId: 'o3', instrument: mockInstrumentOPT, side: Side.SELL, qty: 25, price: 410, timestamp: now + 1000 };

      const f4: Fill = { id: 'f4', orderId: 'o4', instrument: mockInstrumentFUT, side: Side.SELL, qty: 50, price: 23200, timestamp: now + 1500 };

      [f1, f2, f3, f4].forEach((f) => {
        addOrder({ id: f.orderId, instrument: f.instrument, side: f.side, qty: f.qty, price: f.price, status: OrderStatus.FILLED, timestamp: f.timestamp });
        addFill(f);
      });

      updateMarketPrice(keyOpt, 420);
      updateMarketPrice(keyFut, 23150);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      {/* Metrics Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col justify-between shadow-lg">
        <h3 className="text-slate-400 font-medium text-sm mb-3">{t('portfolioRealtimeSummary')}</h3>
        <div className="grid grid-cols-3 gap-4 text-center my-auto">
          <div>
            <p className="text-xs text-slate-500 font-semibold uppercase">{t('realizedPnl')}</p>
            <p className={`text-lg font-bold ${totalRealized >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
              ₹{totalRealized.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-semibold uppercase">{t('unrealizedPnl')}</p>
            <p className={`text-lg font-bold ${totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
              ₹{totalUnrealized.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-semibold uppercase">{t('totalMtm')}</p>
            <p className={`text-xl font-extrabold ${totalMtm >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
              ₹{totalMtm.toFixed(2)}
            </p>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center">
          <span className="text-xs text-slate-500">{t('derivedFrom', { count: fills.length })}</span>
          <button
            onClick={clearAll}
            className="text-xs font-semibold text-rose-400 hover:text-rose-300 transition"
          >
            {t('clearData')}
          </button>
        </div>
      </div>

      {/* Simulator / Manual Order Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 shadow-lg">
        <h3 className="text-slate-200 font-semibold text-sm mb-3">{t('orderSimulator')}</h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="text-slate-400">{t('segment')}</label>
            <select
              value={segment}
              onChange={(e) => setSegment(e.target.value as Segment)}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            >
              <option value={Segment.EQ}>{t('equityEq')}</option>
              <option value={Segment.FUT}>{t('futuresFut')}</option>
              <option value={Segment.OPT}>{t('optionsOpt')}</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-slate-400">{t('symbol')}</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-slate-400">{t('side')}</label>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as Side)}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            >
              <option value={Side.BUY}>{t('buyLong')}</option>
              <option value={Side.SELL}>{t('sellShort')}</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-slate-400">{t('quantity')}</label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-slate-400">{t('priceRupees')}</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            />
          </div>

          {segment !== Segment.EQ && (
            <div className="flex flex-col gap-1">
              <label className="text-slate-400">{t('expiry')}</label>
              <input
                type="text"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value.toUpperCase())}
                className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
              />
            </div>
          )}

          {segment === Segment.OPT && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-slate-400">{t('strikePrice')}</label>
                <input
                  type="number"
                  value={strike}
                  onChange={(e) => setStrike(Number(e.target.value))}
                  className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-slate-400">{t('optionType')}</label>
                <select
                  value={optionType}
                  onChange={(e) => setOptionType(e.target.value as OptionType)}
                  className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
                >
                  <option value={OptionType.CE}>{t('ceCall')}</option>
                  <option value={OptionType.PE}>{t('pePut')}</option>
                </select>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-slate-400 font-semibold">{t('initialOrderStatus')}</label>
            <select
              value={initialStatus}
              onChange={(e) => setInitialStatus(e.target.value as any)}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            >
              <option value="FILLED">{t('filledAuto')}</option>
              <option value="PENDING">{t('pendingAllows')}</option>
            </select>
          </div>
        </div>
        <button
          onClick={handlePlaceOrder}
          className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 rounded transition text-xs"
        >
          {initialStatus === 'FILLED' ? t('placeFillSimulationOrder') : t('placePendingSimulationOrder')}
        </button>
      </div>

      {/* LTP Update & Preset Case Runner */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 shadow-lg flex flex-col justify-between">
        <div>
          <h3 className="text-slate-200 font-semibold text-sm mb-3">{t('liveLtpPreset')}</h3>
          
          <div className="flex gap-2 mb-4">
            <div className="flex-1 flex flex-col gap-1 text-xs">
              <label className="text-slate-400">{t('positionKey')}</label>
              <select
                value={ltpUpdateKey}
                onChange={(e) => setLtpUpdateKey(e.target.value)}
                className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
              >
                <option value="">{t('selectPosition')}</option>
                {summaries.map((p) => (
                  <option key={p.positionKey} value={p.positionKey}>
                    {p.positionKey}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="w-24 flex flex-col gap-1 text-xs">
              <label className="text-slate-400">{t('ltpRupees')}</label>
              <input
                type="number"
                value={ltpUpdateValue}
                onChange={(e) => setLtpUpdateValue(Number(e.target.value))}
                className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
              />
            </div>
            
            <button
              onClick={handleUpdateLtp}
              className="mt-5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 rounded text-xs transition"
            >
              {t('update')}
            </button>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800">
            <span className="block text-slate-400 text-xs font-semibold mb-2">{t('runPresetScenario')}</span>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => runPresetScenario('fifo_match')}
                className="bg-slate-800 hover:bg-slate-700 text-indigo-300 font-bold py-1 px-3 rounded text-xs text-left transition"
              >
                {t('fifoPositionMatching')}
              </button>
              <button
                onClick={() => runPresetScenario('position_flip')}
                className="bg-slate-800 hover:bg-slate-700 text-indigo-300 font-bold py-1 px-3 rounded text-xs text-left transition"
              >
                {t('positionFlipLongShort')}
              </button>
              <button
                onClick={() => runPresetScenario('option_multisegment')}
                className="bg-slate-800 hover:bg-slate-700 text-indigo-300 font-bold py-1 px-3 rounded text-xs text-left transition"
              >
                {t('multiSegmentOptFut')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
