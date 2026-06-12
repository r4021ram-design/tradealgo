import React from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { Database, AlertTriangle, Play, HelpCircle, RefreshCw } from 'lucide-react';

export const MarketStatusBanner = () => {
  const marketState = useTerminalStore(state => state.marketState);
  const dataSource = useTerminalStore(state => state.dataSource);
  const lastUpdateTimestamp = useTerminalStore(state => state.lastUpdateTimestamp);
  const nextMarketOpen = useTerminalStore(state => state.nextMarketOpen);
  const reconnectAttempt = useTerminalStore(state => state.reconnectAttempt);

  // Styling based on state
  const config = {
    LIVE: {
      bg: 'bg-emerald-950/40 border-emerald-900/50 text-emerald-400',
      dot: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse',
      label: 'LIVE MARKET',
      sub: 'Real-Time Data Streaming'
    },
    DELAYED: {
      bg: 'bg-amber-950/40 border-amber-900/50 text-amber-400',
      dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse',
      label: 'DELAYED DATA',
      sub: 'Using REST API Backup Feed'
    },
    MARKET_CLOSED: {
      bg: 'bg-slate-900 border-slate-800 text-slate-400',
      dot: 'bg-slate-500 shadow-[0_0_8px_rgba(100,116,139,0.8)]',
      label: 'MARKET CLOSED',
      sub: 'Showing Previous Close Snapshot'
    },
    HOLIDAY: {
      bg: 'bg-blue-950/40 border-blue-900/50 text-blue-400',
      dot: 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]',
      label: 'MARKET HOLIDAY',
      sub: 'Showing Last Available Market Data'
    },
    DISCONNECTED: {
      bg: 'bg-rose-950/40 border-rose-900/50 text-rose-400',
      dot: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] animate-ping',
      label: 'DATA FEED UNAVAILABLE',
      sub: 'Attempting Recovery'
    },
    RECONNECTING: {
      bg: 'bg-amber-950/40 border-amber-900/50 text-amber-400',
      dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse',
      label: 'RECONNECTING',
      sub: `Attempting WS Recovery (Attempt ${reconnectAttempt})`
    }
  }[marketState] || {
    bg: 'bg-slate-900 border-slate-800 text-slate-400',
    dot: 'bg-slate-500',
    label: 'UNKNOWN STATE',
    sub: 'Offline'
  };

  return (
    <div className={`flex items-center justify-between px-3 py-1.5 border-b text-xs transition-colors duration-300 font-sans ${config.bg}`}>
      {/* Left section: Status indicators */}
      <div className="flex items-center space-x-3 select-none">
        <span className={`w-2.5 h-2.5 rounded-full ${config.dot}`} />
        <div className="flex items-baseline space-x-2">
          <span className="font-extrabold tracking-wider text-[11px] uppercase">
            {config.label}
          </span>
          <span className="text-[10px] opacity-80 border-l border-current pl-2">
            {config.sub}
          </span>
        </div>
      </div>

      {/* Right section: Metadata details */}
      <div className="flex items-center space-x-5 select-none text-[10px] font-mono opacity-90">
        {nextMarketOpen && (marketState === 'MARKET_CLOSED' || marketState === 'HOLIDAY') && (
          <div className="flex items-center space-x-1.5">
            <span className="opacity-60">NEXT OPEN:</span>
            <span className="font-bold text-slate-300">{nextMarketOpen}</span>
          </div>
        )}

        <div className="flex items-center space-x-1.5">
          <span className="opacity-60">FEED SOURCE:</span>
          <span className="font-bold uppercase tracking-wider">{dataSource}</span>
        </div>

        <div className="flex items-center space-x-1.5">
          <span className="opacity-60">LAST UPDATED:</span>
          <span className="font-bold">
            {lastUpdateTimestamp 
              ? lastUpdateTimestamp 
              : "Displaying Last Available Market Snapshot"
            }
          </span>
        </div>
      </div>
    </div>
  );
};
