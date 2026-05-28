import React, { useState, useMemo } from 'react';
import { useOMSStore } from '../../store/useOMSStore';
import { NetPositionWindow } from './NetPositionWindow';
import { FilterBar } from './FilterBar';
import { OpenPositionsGrid } from './OpenPositionsGrid';
import { ClosedTradesGrid } from './ClosedTradesGrid';
import { OrderBookGrid } from './OrderBookGrid';

export const OMSDashboard: React.FC = () => {
  const { orders, fills, getPositionSummaries } = useOMSStore();

  // Filters State
  const [segmentFilter, setSegmentFilter] = useState('ALL');
  const [expiryFilter, setExpiryFilter] = useState('ALL');
  const [strikeFilter, setStrikeFilter] = useState('ALL');
  const [optionTypeFilter, setOptionTypeFilter] = useState('ALL');

  // Tab State
  const [activeTab, setActiveTab] = useState<'positions' | 'closed' | 'orders'>('positions');

  // Derive unique expiries and strikes for the FilterBar
  const expiries = useMemo(() => {
    const list = new Set<string>();
    fills.forEach((f) => {
      if (f.instrument.expiry) list.add(f.instrument.expiry);
    });
    return Array.from(list).sort();
  }, [fills]);

  const strikes = useMemo(() => {
    const list = new Set<number>();
    fills.forEach((f) => {
      if (f.instrument.strikePrice !== undefined) list.add(f.instrument.strikePrice);
    });
    return Array.from(list).sort((a, b) => a - b);
  }, [fills]);

  // Apply filters to positions
  const filteredPositions = useMemo(() => {
    const raw = getPositionSummaries();
    return raw.filter((p) => {
      if (segmentFilter !== 'ALL' && p.instrument.segment !== segmentFilter) return false;
      if (expiryFilter !== 'ALL' && p.instrument.expiry !== expiryFilter) return false;
      if (strikeFilter !== 'ALL' && String(p.instrument.strikePrice) !== strikeFilter) return false;
      if (optionTypeFilter !== 'ALL' && p.instrument.optionType !== optionTypeFilter) return false;
      return true;
    });
  }, [getPositionSummaries, segmentFilter, expiryFilter, strikeFilter, optionTypeFilter]);

  // Apply filters to closed trades
  const filteredClosedTrades = useMemo(() => {
    const raw = useOMSStore.getState().getDerivedPositions();
    const allClosed: any[] = [];
    Object.values(raw).forEach((pos) => {
      allClosed.push(...pos.closedTrades);
    });
    return allClosed.filter((t) => {
      if (segmentFilter !== 'ALL' && t.instrument.segment !== segmentFilter) return false;
      if (expiryFilter !== 'ALL' && t.instrument.expiry !== expiryFilter) return false;
      if (strikeFilter !== 'ALL' && String(t.instrument.strikePrice) !== strikeFilter) return false;
      if (optionTypeFilter !== 'ALL' && t.instrument.optionType !== optionTypeFilter) return false;
      return true;
    });
  }, [fills, segmentFilter, expiryFilter, strikeFilter, optionTypeFilter]);

  // Apply filters to orders
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (segmentFilter !== 'ALL' && o.instrument.segment !== segmentFilter) return false;
      if (expiryFilter !== 'ALL' && o.instrument.expiry !== expiryFilter) return false;
      if (strikeFilter !== 'ALL' && String(o.instrument.strikePrice) !== strikeFilter) return false;
      if (optionTypeFilter !== 'ALL' && o.instrument.optionType !== optionTypeFilter) return false;
      return true;
    });
  }, [orders, segmentFilter, expiryFilter, strikeFilter, optionTypeFilter]);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 p-6 flex flex-col min-h-0">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-white">OMS / RMS Position Engine</h1>
        <p className="text-sm text-slate-400">
          Simulated trading position manager with FIFO matching, position flipping, and PnL calculation.
        </p>
      </div>

      {/* Metrics & Control Panel */}
      <NetPositionWindow />

      {/* Filter Bar */}
      <FilterBar
        segmentFilter={segmentFilter}
        setSegmentFilter={setSegmentFilter}
        expiryFilter={expiryFilter}
        setExpiryFilter={setExpiryFilter}
        strikeFilter={strikeFilter}
        setStrikeFilter={setStrikeFilter}
        optionTypeFilter={optionTypeFilter}
        setOptionTypeFilter={setOptionTypeFilter}
        expiries={expiries}
        strikes={strikes}
      />

      {/* Tabbed Navigation */}
      <div className="flex border-b border-slate-800 mb-4 shrink-0">
        <button
          onClick={() => setActiveTab('positions')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
            activeTab === 'positions'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Open Positions ({filteredPositions.length})
        </button>
        <button
          onClick={() => setActiveTab('closed')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
            activeTab === 'closed'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Closed Trades ({filteredClosedTrades.length})
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
            activeTab === 'orders'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Order Book ({filteredOrders.length})
        </button>
      </div>

      {/* Grid Content */}
      <div className="flex-1 min-h-[400px]">
        {activeTab === 'positions' && <OpenPositionsGrid positions={filteredPositions} />}
        {activeTab === 'closed' && <ClosedTradesGrid closedTrades={filteredClosedTrades} />}
        {activeTab === 'orders' && <OrderBookGrid orders={filteredOrders} />}
      </div>
    </div>
  );
};
