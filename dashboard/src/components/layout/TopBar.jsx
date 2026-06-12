import React, { useState, useEffect } from 'react';
import { Clock, Activity, Signal, Sun, Moon } from 'lucide-react';
import { useTerminalStore } from '../../store/useTerminalStore';

export const TopBar = () => {
  const [time, setTime] = useState(new Date());
  const marketWatch = useTerminalStore(state => state.marketWatch);
  const wsConnectionStatus = useTerminalStore(state => state.wsConnectionStatus);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Calculate total MTM
  const positions = useTerminalStore(state => state.positions);
  const totalMtm = positions.reduce((acc, p) => {
    const unrealized = p.netQty > 0 
      ? (p.ltp - p.avgBuyPrice) * p.netQty 
      : (p.avgSellPrice - p.ltp) * Math.abs(p.netQty);
    return acc + p.realizedPnl + unrealized;
  }, 0);

  const nifty = useTerminalStore(state => state.nifty) || { ltp: 0, change: 0, percentChange: 0 };
  const banknifty = useTerminalStore(state => state.banknifty) || { ltp: 0, change: 0, percentChange: 0 };
  const sensex = useTerminalStore(state => state.sensex) || { ltp: 0, change: 0, percentChange: 0 };
  const indiavix = useTerminalStore(state => state.indiavix) || { ltp: 0, change: 0, percentChange: 0 };

  const renderIndexBlock = (name, indexData) => {
    const ltp = indexData?.ltp ?? 0;
    const change = indexData?.change ?? 0;
    const percentChange = indexData?.percentChange ?? 0;
    const isPositive = change >= 0;
    const colorClass = isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    const sign = isPositive ? '+' : '';
    
    return (
      <div className="flex items-center space-x-2 text-xs select-none">
        <span className="text-[#555] dark:text-slate-400 font-bold">{name}</span>
        <span className="text-slate-800 dark:text-slate-200 font-bold font-mono">{ltp.toFixed(2)}</span>
        <span className={`${colorClass} font-mono font-semibold`}>
          {sign}{change.toFixed(2)} ({sign}{percentChange.toFixed(2)}%)
        </span>
      </div>
    );
  };

  const isPaperTrade = useTerminalStore(state => state.isPaperTrade);
  const togglePaperTrade = useTerminalStore(state => state.togglePaperTrade);
  const theme = useTerminalStore(state => state.theme);
  const toggleTheme = useTerminalStore(state => state.toggleTheme);

  const handleModeChange = async (paperTrade) => {
    if (!paperTrade) {
      const confirmLive = window.confirm(
        "⚠️ WARNING: You are about to enable LIVE TRADING.\n\n" +
        "Orders placed in this mode will be executed as REAL orders with your broker (Kotak Securities) and will involve real money/financial risk.\n\n" +
        "Do you want to proceed and turn actual trading ON?"
      );
      if (!confirmLive) return;
    }
    const success = await togglePaperTrade(paperTrade);
    if (!success) {
      alert("Failed to update trading mode. Please check backend connection.");
    }
  };

  return (
    <div className="flex items-center justify-between bg-finance-panel dark:bg-slate-900 border-b border-finance-border dark:border-slate-800 px-2 py-1 text-sm shrink-0">
      <div className="flex items-center space-x-6">
        {renderIndexBlock("NIFTY", nifty)}
        {renderIndexBlock("BANKNIFTY", banknifty)}
        {renderIndexBlock("SENSEX", sensex)}
        {renderIndexBlock("INDIA VIX", indiavix)}
      </div>

      <div className="flex items-center space-x-4">
        {/* Trading Mode Switcher */}
        <div className="flex items-center bg-[#f0f0f0] dark:bg-slate-950 border border-[#ccc] dark:border-slate-800 p-0.5 rounded">
          <button
            onClick={() => handleModeChange(true)}
            className={`px-3 py-0.5 text-xs font-bold transition-all duration-250 cursor-pointer rounded-sm ${
              isPaperTrade
                ? 'bg-amber-600 text-white shadow-sm font-extrabold'
                : 'text-[#555] dark:text-slate-400 hover:text-black dark:hover:text-slate-200 hover:bg-[#e0e0e0] dark:hover:bg-slate-800'
            }`}
            style={{ fontFamily: 'Calibri, Arial, sans-serif' }}
          >
            📝 PAPER TRADING
          </button>
          <button
            onClick={() => handleModeChange(false)}
            className={`px-3 py-0.5 text-xs font-bold transition-all duration-250 cursor-pointer rounded-sm ${
              !isPaperTrade
                ? 'bg-rose-600 text-white shadow-sm font-extrabold animate-pulse'
                : 'text-[#555] dark:text-slate-400 hover:text-black dark:hover:text-slate-200 hover:bg-[#e0e0e0] dark:hover:bg-slate-800'
            }`}
            style={{ fontFamily: 'Calibri, Arial, sans-serif' }}
          >
            🔥 LIVE TRADING
          </button>
        </div>
      </div>

      
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2 font-mono font-bold">
          <span className="text-[#555]">TOTAL MTM:</span>
          <span className={totalMtm >= 0 ? "text-finance-green" : "text-finance-red"}>
            ₹ {totalMtm.toFixed(2)}
          </span>
        </div>
        
        <div className="flex items-center space-x-4 border-l border-[#ccc] pl-4">
          <button
            onClick={toggleTheme}
            className="text-[#555] hover:text-black dark:text-slate-400 dark:hover:text-slate-200 transition-colors p-1 cursor-pointer flex items-center justify-center mr-1"
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Excel Mode'}
          >
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </button>
          {wsConnectionStatus === 'connected' && (
            <div className="flex items-center space-x-1 text-finance-green font-bold">
              <Signal size={14} />
              <span className="text-xs">CONNECTED</span>
            </div>
          )}
          {(wsConnectionStatus === 'connecting' || wsConnectionStatus === 'reconnecting') && (
            <div className="flex items-center space-x-1 text-amber-500 font-bold animate-pulse">
              <Signal size={14} className="animate-bounce" />
              <span className="text-xs">CONNECTING...</span>
            </div>
          )}
          {wsConnectionStatus === 'disconnected' && (
            <div className="flex items-center space-x-1 text-rose-500 font-bold">
              <Signal size={14} className="opacity-50" />
              <span className="text-xs">OFFLINE</span>
            </div>
          )}
          <div className="flex items-center space-x-1 text-[#555] font-mono">
            <Clock size={14} />
            <span>{time.toLocaleTimeString('en-IN', { hour12: false })}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
