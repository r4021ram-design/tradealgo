import React, { useState, useEffect } from 'react';
import { Clock, Activity, Signal } from 'lucide-react';
import { useTerminalStore } from '../../store/useTerminalStore';

export const TopBar = () => {
  const [time, setTime] = useState(new Date());
  const marketWatch = useTerminalStore(state => state.marketWatch);

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

  const niftySpot = useTerminalStore(state => state.niftySpot);
  const bankNiftySpot = useTerminalStore(state => state.bankNiftySpot);
  const activeView = useTerminalStore(state => state.activeView);
  const setActiveView = useTerminalStore(state => state.setActiveView);

  return (
    <div className="flex items-center justify-between bg-finance-panel border-b border-finance-border px-2 py-1 text-sm shrink-0">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2 font-mono">
          <span className="text-[#555]">NIFTY</span>
          <span className="text-finance-green font-bold">
            {niftySpot.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center space-x-2 font-mono">
          <span className="text-[#555]">BANKNIFTY</span>
          <span className="text-finance-green font-bold">
            {bankNiftySpot.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center space-x-2 font-mono">
          <span className="text-[#555]">INDIA VIX</span>
          <span className="text-finance-text">12.45</span>
        </div>
      </div>

      {/* Active Mode Switcher */}
      <div className="flex items-center bg-[#f0f0f0] border border-[#ccc] p-0.5 rounded">
        <button
          onClick={() => setActiveView('terminal')}
          className={`px-3 py-0.5 text-xs font-bold transition-all duration-250 cursor-pointer rounded-sm ${
            activeView === 'terminal'
              ? 'bg-[#002060] text-white shadow-sm'
              : 'text-[#555] hover:text-black hover:bg-[#e0e0e0]'
          }`}
          style={{ fontFamily: 'Calibri, Arial, sans-serif' }}
        >
          LIVE TERMINAL
        </button>
        <button
          onClick={() => setActiveView('oms')}
          className={`px-3 py-0.5 text-xs font-bold transition-all duration-250 cursor-pointer rounded-sm ${
            activeView === 'oms'
              ? 'bg-[#002060] text-white shadow-sm'
              : 'text-[#555] hover:text-black hover:bg-[#e0e0e0]'
          }`}
          style={{ fontFamily: 'Calibri, Arial, sans-serif' }}
        >
          OMS SIMULATOR
        </button>
      </div>

      
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2 font-mono font-bold">
          <span className="text-[#555]">TOTAL MTM:</span>
          <span className={totalMtm >= 0 ? "text-finance-green" : "text-finance-red"}>
            ₹ {totalMtm.toFixed(2)}
          </span>
        </div>
        
        <div className="flex items-center space-x-4 border-l border-[#ccc] pl-4">
          <div className="flex items-center space-x-1 text-finance-green">
            <Signal size={14} />
            <span className="text-xs">CONNECTED</span>
          </div>
          <div className="flex items-center space-x-1 text-[#555] font-mono">
            <Clock size={14} />
            <span>{time.toLocaleTimeString('en-IN', { hour12: false })}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
