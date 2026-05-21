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

  // Calculate mock total MTM
  const positions = useTerminalStore(state => state.positions);
  const totalMtm = positions.reduce((acc, p) => {
    const unrealized = (p.ltp - p.avgBuyPrice) * p.netQty; // Simplified logic assuming Buy positions
    return acc + p.realizedPnl + unrealized;
  }, 0);

  // Fetch Nifty and BankNifty from MarketWatch for ticker tape
  const nifty = marketWatch.find(m => m.symbol.includes('NIFTY')) || { ltp: 0, change: 0 };
  const bankNifty = marketWatch.find(m => m.symbol.includes('BANKNIFTY')) || { ltp: 0, change: 0 };

  return (
    <div className="flex items-center justify-between bg-finance-panel border-b border-finance-border px-2 py-1 text-sm shrink-0">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2 font-mono">
          <span className="text-[#555]">NIFTY</span>
          <span className={nifty.change >= 0 ? "text-finance-green" : "text-finance-red"}>
            {nifty.ltp.toFixed(2)} ({nifty.change > 0 ? '+' : ''}{nifty.change}%)
          </span>
        </div>
        <div className="flex items-center space-x-2 font-mono">
          <span className="text-[#555]">BANKNIFTY</span>
          <span className={bankNifty.change >= 0 ? "text-finance-green" : "text-finance-red"}>
            {bankNifty.ltp.toFixed(2)} ({bankNifty.change > 0 ? '+' : ''}{bankNifty.change}%)
          </span>
        </div>
        <div className="flex items-center space-x-2 font-mono">
          <span className="text-[#555]">INDIA VIX</span>
          <span className="text-finance-text">12.45</span>
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
