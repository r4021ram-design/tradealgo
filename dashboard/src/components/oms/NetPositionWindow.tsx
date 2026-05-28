import React, { useState } from 'react';
import { useOMSStore } from '../../store/useOMSStore';
import { Segment, Side, OptionType, OrderStatus, Order, Fill } from '../../engine/types';
import { generatePositionKey } from '../../engine/instrumentRegistry';

export const NetPositionWindow: React.FC = () => {
  const { orders, fills, addOrder, addFill, clearAll, updateMarketPrice, getPositionSummaries } = useOMSStore();

  // Local state for custom order placement
  const [symbol, setSymbol] = useState('RELIANCE');
  const [segment, setSegment] = useState<Segment>(Segment.EQ);
  const [side, setSide] = useState<Side>(Side.BUY);
  const [qty, setQty] = useState(10);
  const [price, setPrice] = useState(2500);
  const [expiry, setExpiry] = useState('27JUN2026');
  const [strike, setStrike] = useState(2500);
  const [optionType, setOptionType] = useState<OptionType>(OptionType.CE);
  const [initialStatus, setInitialStatus] = useState<'FILLED' | 'PENDING'>('FILLED');
  
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
      
      [f1, f2, f3].forEach((f, idx) => {
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
        <h3 className="text-slate-400 font-medium text-sm mb-3">Portfolio Realtime Summary</h3>
        <div className="grid grid-cols-3 gap-4 text-center my-auto">
          <div>
            <p className="text-xs text-slate-500 font-semibold uppercase">Realized PnL</p>
            <p className={`text-lg font-bold ${totalRealized >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
              ₹{totalRealized.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-semibold uppercase">Unrealized PnL</p>
            <p className={`text-lg font-bold ${totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
              ₹{totalUnrealized.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-semibold uppercase">Total MTM</p>
            <p className={`text-xl font-extrabold ${totalMtm >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
              ₹{totalMtm.toFixed(2)}
            </p>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center">
          <span className="text-xs text-slate-500">Derived from {fills.length} Fills</span>
          <button
            onClick={clearAll}
            className="text-xs font-semibold text-rose-400 hover:text-rose-300 transition"
          >
            Clear Data
          </button>
        </div>
      </div>

      {/* Simulator / Manual Order Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 shadow-lg">
        <h3 className="text-slate-200 font-semibold text-sm mb-3">Order Simulator</h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="text-slate-400">Segment</label>
            <select
              value={segment}
              onChange={(e) => setSegment(e.target.value as Segment)}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            >
              <option value={Segment.EQ}>Equity (EQ)</option>
              <option value={Segment.FUT}>Futures (FUT)</option>
              <option value={Segment.OPT}>Options (OPT)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-slate-400">Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-slate-400">Side</label>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as Side)}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            >
              <option value={Side.BUY}>BUY / LONG</option>
              <option value={Side.SELL}>SELL / SHORT</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-slate-400">Quantity</label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-slate-400">Price (₹)</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            />
          </div>

          {segment !== Segment.EQ && (
            <div className="flex flex-col gap-1">
              <label className="text-slate-400">Expiry</label>
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
                <label className="text-slate-400">Strike Price</label>
                <input
                  type="number"
                  value={strike}
                  onChange={(e) => setStrike(Number(e.target.value))}
                  className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-slate-400">Option Type</label>
                <select
                  value={optionType}
                  onChange={(e) => setOptionType(e.target.value as OptionType)}
                  className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
                >
                  <option value={OptionType.CE}>CE / CALL</option>
                  <option value={OptionType.PE}>PE / PUT</option>
                </select>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-slate-400 font-semibold">Initial Order Status</label>
            <select
              value={initialStatus}
              onChange={(e) => setInitialStatus(e.target.value as any)}
              className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
            >
              <option value="FILLED">FILLED (Auto-executes matching & PnL)</option>
              <option value="PENDING">PENDING (Allows Mod/Del/Fill in Order Book)</option>
            </select>
          </div>
        </div>
        <button
          onClick={handlePlaceOrder}
          className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 rounded transition text-xs"
        >
          {initialStatus === 'FILLED' ? 'Place & Fill Simulation Order' : 'Place Pending Simulation Order'}
        </button>
      </div>

      {/* LTP Update & Preset Case Runner */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 shadow-lg flex flex-col justify-between">
        <div>
          <h3 className="text-slate-200 font-semibold text-sm mb-3">Live LTP / Preset Testing</h3>
          
          <div className="flex gap-2 mb-4">
            <div className="flex-1 flex flex-col gap-1 text-xs">
              <label className="text-slate-400">Position Key</label>
              <select
                value={ltpUpdateKey}
                onChange={(e) => setLtpUpdateKey(e.target.value)}
                className="bg-slate-850 border border-slate-750 text-slate-200 rounded p-1"
              >
                <option value="">Select Position...</option>
                {summaries.map((p) => (
                  <option key={p.positionKey} value={p.positionKey}>
                    {p.positionKey}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="w-24 flex flex-col gap-1 text-xs">
              <label className="text-slate-400">LTP (₹)</label>
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
              Update
            </button>
          </div>
        </div>

        <div className="border-t border-slate-850 pt-3">
          <p className="text-xs text-slate-400 font-medium mb-2">Preset Scenarios:</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => runPresetScenario('fifo_match')}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 rounded text-[10px] font-semibold transition"
            >
              FIFO Matching
            </button>
            <button
              onClick={() => runPresetScenario('position_flip')}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 rounded text-[10px] font-semibold transition"
            >
              Position Flip
            </button>
            <button
              onClick={() => runPresetScenario('option_multisegment')}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 rounded text-[10px] font-semibold transition"
            >
              Multi-Segment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
