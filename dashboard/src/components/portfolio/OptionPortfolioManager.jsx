import React, { useMemo, useState, useEffect } from 'react';
import { usePortfolioStore } from '../../store/usePortfolioStore';
import { useTerminalStore } from '../../store/useTerminalStore';
import { calculateBlackScholes } from '../../utils/blackScholes';
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { parseOptionSymbol } from '../../utils/symbolParser';

const formatExpiryPremium = (dateStr) => {
  if (!dateStr || dateStr === 'N/A') return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const year = parts[0];
  const monthIdx = parseInt(parts[1]) - 1;
  const day = parts[2];
  return `${day} ${months[monthIdx]} ${year}`;
};

export const OptionPortfolioManager = () => {
  const { underlyingPrice, interestRate, dividendYield, setGlobalParams } = usePortfolioStore();
  const theme = useTerminalStore(state => state.theme);
  const livePositions = useTerminalStore(state => state.positions);
  const spotPrice = useTerminalStore(state => state.spotPrice);

  useEffect(() => {
    if (spotPrice > 0) {
      setGlobalParams({ underlyingPrice: spotPrice });
    }
  }, [spotPrice, setGlobalParams]);

  const [simDate, setSimDate] = useState(0);
  const [ivShifts, setIvShifts] = useState([0, 0.04, 0.08]); // Blue (Base), Green (+4%), Red (+8%)
  const [excludedLivePositions, setExcludedLivePositions] = useState({});

  // Filter States
  const [modeFilter, setModeFilter] = useState('ALL'); // 'ALL' | 'LIVE' | 'PAPER'
  const [underlyingFilter, setUnderlyingFilter] = useState('ALL'); // 'ALL' or specific symbol

  // Filter only active or closed positions with realized P&L from broker
  const activeLivePositions = useMemo(() => {
    return livePositions.filter(p => p.netQty !== 0 || p.realizedPnl !== 0);
  }, [livePositions]);

  // Parse active live broker positions into Portfolio Legs
  const parsedLiveLegs = useMemo(() => {
    return activeLivePositions.map(pos => {
      const parsed = parseOptionSymbol(pos.symbol) || {
        underlying: pos.underlying || 'NIFTY',
        strike: pos.avgBuyPrice || pos.avgSellPrice || underlyingPrice,
        type: 'Stock', // Fallback
        dte: 7,
        expDate: 'N/A'
      };

      const size = pos.netQty;
      const entryPrice = size > 0 ? pos.avgBuyPrice : pos.avgSellPrice;
      
      return {
        ...parsed,
        id: `live-${pos.symbol}`,
        symbol: pos.symbol,
        underlying: parsed.underlying || 'NIFTY',
        isOpen: pos.netQty !== 0 && excludedLivePositions[pos.symbol] !== false,
        isLive: true,
        isPaper: pos.paper_trade || false,
        size,
        strike: parsed.strike,
        type: parsed.type,
        expDate: pos.expiry || parsed.expDate,
        dte: pos.dte !== null && pos.dte !== undefined ? pos.dte : parsed.dte,
        entryPrice: entryPrice || pos.ltp || 0,
        exitPrice: 0,
        iv: pos.iv !== null && pos.iv !== undefined ? pos.iv : 0.16,
        ltp: pos.ltp || 0,
        delta: pos.delta || 0,
        theta: pos.theta || 0,
        realizedPnl: pos.realizedPnl || 0
      };
    });
  }, [activeLivePositions, excludedLivePositions, underlyingPrice]);

  // Combine Manually Entered Strategy Legs and Live Broker Positions
  const combinedLegs = useMemo(() => {
    return parsedLiveLegs;
  }, [parsedLiveLegs]);

  // Unique Underlyings list for filter
  const uniqueUnderlyings = useMemo(() => {
    const symbols = new Set();
    combinedLegs.forEach(leg => {
      if (leg.underlying) {
        symbols.add(leg.underlying.toUpperCase());
      }
    });
    // Add defaults
    symbols.add('NIFTY');
    symbols.add('BANKNIFTY');
    symbols.add('SENSEX');
    return Array.from(symbols).sort();
  }, [combinedLegs]);

  // Filtered Legs for analysis
  const filteredLegs = useMemo(() => {
    return combinedLegs.filter(leg => {
      // 1. Mode Filter
      if (modeFilter === 'PAPER' && !leg.isPaper) return false;
      if (modeFilter === 'LIVE' && leg.isPaper) return false;

      // 2. Underlying Filter
      if (underlyingFilter !== 'ALL') {
        const legUnd = (leg.underlying || '').toUpperCase();
        if (legUnd !== underlyingFilter.toUpperCase()) return false;
      }
      return true;
    });
  }, [combinedLegs, modeFilter, underlyingFilter]);

  // Filtered live positions for table display
  const displayedLiveLegs = useMemo(() => {
    return parsedLiveLegs.filter(leg => {
      if (modeFilter === 'PAPER' && !leg.isPaper) return false;
      if (modeFilter === 'LIVE' && leg.isPaper) return false;
      if (underlyingFilter !== 'ALL' && (leg.underlying || '').toUpperCase() !== underlyingFilter.toUpperCase()) return false;
      return true;
    });
  }, [parsedLiveLegs, modeFilter, underlyingFilter]);



  // Toggle dynamic inclusion of live broker positions in scenario risk engine
  const handleToggleLivePosition = (symbol, checked) => {
    setExcludedLivePositions(prev => ({
      ...prev,
      [symbol]: checked
    }));
  };

  // Scenario Chart Data
  const chartData = useMemo(() => {
    const activeLegs = filteredLegs.filter(l => l.isOpen);
    if (activeLegs.length === 0) return [];
    
    const strikes = activeLegs.map(l => l.strike).filter(s => s !== null && s !== undefined && s > 0 && !isNaN(s));
    const minStrike = strikes.length > 0 ? Math.min(...strikes, underlyingPrice) : underlyingPrice;
    const maxStrike = strikes.length > 0 ? Math.max(...strikes, underlyingPrice) : underlyingPrice;
    
    // Scale X-axis range to span at least 6% of the spot price (+/- 3%) for visibility
    const range = Math.max(maxStrike - minStrike, underlyingPrice * 0.06);
    const startX = minStrike - range * 0.25;
    const endX = maxStrike + range * 0.25;
    
    const data = [];
    const stepCount = 80;
    const increment = (endX - startX) / stepCount;
    for (let s = startX; s <= endX; s += increment) {
      const point = { spot: s };
      
      // Calculate Expiry PnL (T=0, final payout)
      let expiryPnl = 0;
      activeLegs.forEach(leg => {
        if (leg.type === 'Stock' || leg.type === 'Future') {
          expiryPnl += (s - leg.entryPrice) * leg.size;
        } else {
          const isCall = leg.type.toLowerCase() === 'call' || leg.type.toLowerCase() === 'ce';
          const intrinsic = isCall ? Math.max(0, s - leg.strike) : Math.max(0, leg.strike - s);
          expiryPnl += (intrinsic - leg.entryPrice) * leg.size;
        }
      });
      point['pnl_expiry'] = expiryPnl;

      ivShifts.forEach((ivShift, idx) => {
        let totalPnl = 0;
        activeLegs.forEach(leg => {
          if (leg.type === 'Stock' || leg.type === 'Future') {
            totalPnl += (s - leg.entryPrice) * leg.size;
            return;
          }

          const simDTE = Math.max(0, leg.dte - simDate);
          const simT = simDTE / 365.0;
          if (simT <= 0) {
             const isCall = leg.type.toLowerCase() === 'call' || leg.type.toLowerCase() === 'ce';
             const intrinsic = isCall ? Math.max(0, s - leg.strike) : Math.max(0, leg.strike - s);
             totalPnl += (intrinsic - leg.entryPrice) * leg.size;
          } else {
             const simIV = Math.max(0.01, leg.iv + ivShift);
             const bs = calculateBlackScholes(leg.type, s, leg.strike, simT, interestRate, simIV, dividendYield);
             totalPnl += (bs.price - leg.entryPrice) * leg.size;
          }
        });
        point[`pnl_${idx}`] = totalPnl;
      });
      data.push(point);
    }
    return data;
  }, [filteredLegs, underlyingPrice, simDate, ivShifts, interestRate, dividendYield]);

  // Calculate Breakeven points dynamically from chartData
  const breakevens = useMemo(() => {
    if (chartData.length < 2) return [];
    const points = [];
    for (let i = 0; i < chartData.length - 1; i++) {
      const p1 = chartData[i];
      const p2 = chartData[i + 1];
      if ((p1.pnl_expiry <= 0 && p2.pnl_expiry > 0) || (p1.pnl_expiry >= 0 && p2.pnl_expiry < 0)) {
        // Linear interpolation to find the exact spot price where payoff is zero
        const t = -p1.pnl_expiry / (p2.pnl_expiry - p1.pnl_expiry);
        const beSpot = p1.spot + t * (p2.spot - p1.spot);
        points.push(beSpot);
      }
    }
    return points;
  }, [chartData]);

  // Aggregate Greeks calculation across manual legs & live positions
  const aggregateGreeks = useMemo(() => {
    let delta = 0, gamma = 0, theta = 0, vega = 0, realizedPnl = 0, openPnl = 0, netPremium = 0;
    
    filteredLegs.forEach(leg => {
      if (!leg.isOpen) {
        if (leg.isLive) {
          realizedPnl += leg.realizedPnl || 0;
          return;
        }
        realizedPnl += (leg.exitPrice - leg.entryPrice) * leg.size;
        netPremium += leg.entryPrice * leg.size * -1;
        return;
      }
      netPremium += leg.entryPrice * leg.size * -1;

      if (leg.isLive) {
        realizedPnl += leg.realizedPnl || 0;
      }

      if (leg.type === 'Stock' || leg.type === 'Future') {
        const livePrice = leg.ltp || underlyingPrice;
        openPnl += (livePrice - leg.entryPrice) * leg.size;
        delta += 1 * leg.size;
      } else {
        const simDTE = Math.max(0, leg.dte - simDate);
        const simT = simDTE / 365.0;
        const bs = calculateBlackScholes(leg.type, underlyingPrice, leg.strike, simT, interestRate, leg.iv, dividendYield);
        
        openPnl += (bs.price - leg.entryPrice) * leg.size;
        delta += bs.delta * leg.size;
        gamma += bs.gamma * leg.size;
        theta += bs.theta * leg.size;
        vega += bs.vega * leg.size;
      }
    });

    return { delta, gamma, theta, vega, totalPnl: realizedPnl + openPnl, netPremium };
  }, [filteredLegs, underlyingPrice, simDate, interestRate, dividendYield]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 text-black dark:text-slate-100 overflow-y-auto p-2" style={{ fontFamily: theme === 'dark' ? 'Inter, sans-serif' : 'Calibri, Arial, sans-serif' }}>
      {/* Title */}
      <div className="flex items-center justify-between mb-2 px-1">
        <h1 className="text-xl font-bold" style={{ color: theme === 'dark' ? '#a5b4fc' : '#002060' }}>Option Portfolio Manager</h1>
        <div className="flex items-center gap-1.5 bg-[#c6efce] dark:bg-emerald-950/45 text-[#006100] dark:text-emerald-400 px-2 py-0.5 font-bold border border-finance-green dark:border-emerald-800 text-xs">
          <span>● KOTAK NEO LIVE ACTIVE</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-4 bg-[#f2f2f2] dark:bg-slate-950 border border-[#ccc] dark:border-slate-800 px-2 py-1.5 mb-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-[#555] dark:text-slate-400">TRADING MODE:</span>
          <select 
            className="bg-white dark:bg-slate-800 border border-[#ccc] dark:border-slate-700 px-2 py-0.5 outline-none font-bold text-xs text-black dark:text-slate-200"
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
          >
            <option value="ALL">ALL TRADES</option>
            <option value="LIVE">LIVE (ACTUAL) TRADES</option>
            <option value="PAPER">PAPER TRADES</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-bold text-[#555] dark:text-slate-400">UNDERLYING:</span>
          <select 
            className="bg-white dark:bg-slate-800 border border-[#ccc] dark:border-slate-700 px-2 py-0.5 outline-none font-bold text-xs text-black dark:text-slate-200"
            value={underlyingFilter}
            onChange={(e) => setUnderlyingFilter(e.target.value)}
          >
            <option value="ALL">ALL SYMBOLS</option>
            {uniqueUnderlyings.map(und => (
              <option key={und} value={und}>{und}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-row gap-2 mb-2 h-64">
        {/* Chart */}
        <div className="flex-1 border border-[#ccc] dark:border-slate-800 bg-white dark:bg-slate-900/50 relative">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 15, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="payoffBaseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={theme === 'dark' ? '#3b82f6' : '#0000ff'} stopOpacity={theme === 'dark' ? 0.25 : 0.08}/>
                  <stop offset="95%" stopColor={theme === 'dark' ? '#3b82f6' : '#0000ff'} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#1e293b' : '#e0e0e0'} />
              <XAxis dataKey="spot" stroke={theme === 'dark' ? '#94a3b8' : '#000'} tick={{ fontSize: 10 }} domain={['dataMin', 'dataMax']} type="number" tickFormatter={(v) => Math.round(v)} />
              <YAxis stroke={theme === 'dark' ? '#94a3b8' : '#000'} tick={{ fontSize: 10 }} />
              <Tooltip 
                labelFormatter={(label) => `Spot Price: ${Math.round(label)}`} 
                formatter={(value) => [`₹ ${Number(value).toFixed(2)}`]}
                contentStyle={theme === 'dark' 
                  ? { backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: 12, color: '#f8fafc' } 
                  : { backgroundColor: '#fff', borderColor: '#ccc', fontSize: 12, color: '#000' }
                } 
                itemStyle={theme === 'dark' ? { color: '#f8fafc' } : { color: '#000' }}
                labelStyle={theme === 'dark' ? { color: '#94a3b8' } : { color: '#000' }}
              />
              <ReferenceLine y={0} stroke={theme === 'dark' ? '#475569' : '#000'} />
              <ReferenceLine x={underlyingPrice} stroke={theme === 'dark' ? '#f59e0b' : '#ff9900'} strokeDasharray="3 3" label={{ value: `Spot: ${Math.round(underlyingPrice)}`, position: 'top', fill: theme === 'dark' ? '#f59e0b' : '#ff9900', fontSize: 10, fontWeight: 'bold' }} />
              
              {/* Highlight Breakeven Points as red dotted reference lines */}
              {breakevens.map((be, idx) => (
                <ReferenceLine
                  key={`be-${idx}`}
                  x={be}
                  stroke={theme === 'dark' ? '#f43f5e' : '#cc0000'}
                  strokeDasharray="3 3"
                  label={{
                    value: `BE: ${Math.round(be)}`,
                    position: 'bottom',
                    fill: theme === 'dark' ? '#f43f5e' : '#cc0000',
                    fontSize: 9,
                    fontWeight: 'bold',
                  }}
                />
              ))}

              {/* Expiry Payoff Curve (peaked dashed line, similar to Kotak Securities OneTouch) */}
              <Line type="monotone" dataKey="pnl_expiry" stroke={theme === 'dark' ? '#64748b' : '#7f7f7f'} strokeWidth={2} strokeDasharray="4 4" name="At Expiry" dot={false} isAnimationActive={false} />
              
              {/* Gradient Area under Base IV Payoff */}
              <Area type="monotone" dataKey="pnl_0" fill="url(#payoffBaseGrad)" stroke="none" dot={false} isAnimationActive={false} />

              {/* Target Date Scenario Payoff Curves */}
              <Line type="monotone" dataKey="pnl_0" stroke={theme === 'dark' ? '#3b82f6' : '#0000ff'} strokeWidth={2} name={simDate === 0 ? "Today (Base IV)" : `T+${simDate} (Base IV)`} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="pnl_1" stroke={theme === 'dark' ? '#10b981' : '#008000'} strokeWidth={1.5} name={simDate === 0 ? `Today (+${(ivShifts[1]*100).toFixed(0)}% IV)` : `T+${simDate} (+${(ivShifts[1]*100).toFixed(0)}% IV)`} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="pnl_2" stroke={theme === 'dark' ? '#f43f5e' : '#ff0000'} strokeWidth={1.5} name={simDate === 0 ? `Today (+${(ivShifts[2]*100).toFixed(0)}% IV)` : `T+${simDate} (+${(ivShifts[2]*100).toFixed(0)}% IV)`} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Right Side Settings Tables */}
        <div className="w-80 flex flex-col gap-2">
          {/* Chart Settings */}
          <table className="excel-table">
            <tbody>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400 w-24 font-bold">Chart Mode</td>
                <td>Scenario Analysis</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400 font-bold">Time Shift</td>
                <td className="flex items-center gap-1.5 px-1 bg-[#ffffcc] dark:bg-indigo-950/45">
                  <input type="range" min="0" max="30" value={simDate} onChange={e => setSimDate(Number(e.target.value))} className="w-full h-2 accent-[#002060] dark:accent-indigo-500 cursor-pointer" />
                  <span className="text-xs font-mono font-bold w-12 text-center text-black dark:text-slate-200">{simDate} Days</span>
                </td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400 font-bold">X-Axis</td>
                <td>Stock Price</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400 font-bold">Y-Axis</td>
                <td>Profit/Loss</td>
              </tr>
              <tr>
                <td colSpan="2" className="bg-[#c6efce] dark:bg-emerald-950/45 text-[#006100] dark:text-emerald-400 font-bold text-center">Chart displays Combined Risk Curve</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400 font-bold">Line Inputs</td>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400 font-bold text-center">Volatility Shift</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400 text-blue-700 dark:text-blue-400 font-bold">Blue (Flat)</td>
                <td className="excel-neutral-bg text-center font-bold">{(ivShifts[0]*100).toFixed(2)}%</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400 text-green-700 dark:text-emerald-400 font-bold">Green Shift</td>
                <td className="excel-input text-center">
                  <input type="number" step="0.5" className="w-full bg-transparent text-center outline-none" value={ivShifts[1]*100} onChange={e => { const v = [...ivShifts]; v[1] = Number(e.target.value)/100; setIvShifts(v); }} />
                </td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400 text-red-700 dark:text-rose-400 font-bold">Red Shift</td>
                <td className="excel-input text-center">
                  <input type="number" step="0.5" className="w-full bg-transparent text-center outline-none" value={ivShifts[2]*100} onChange={e => { const v = [...ivShifts]; v[2] = Number(e.target.value)/100; setIvShifts(v); }} />
                </td>
              </tr>
            </tbody>
          </table>

          {/* Combined Portfolio Risk Metrics */}
          <table className="excel-table flex-1">
            <tbody>
              <tr className="excel-header font-bold">
                <td colSpan="2">Aggregate Combined Greeks</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400 w-24">Net Delta</td>
                <td className={`font-bold text-right ${aggregateGreeks.delta >= 0 ? 'text-[#006100] dark:text-emerald-400' : 'text-[#ff0000] dark:text-rose-455'}`}>{aggregateGreeks.delta.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400">Net Gamma</td>
                <td className={`font-bold text-right ${aggregateGreeks.gamma >= 0 ? 'text-[#006100] dark:text-emerald-400' : 'text-[#ff0000] dark:text-rose-455'}`}>{aggregateGreeks.gamma.toFixed(4)}</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400">Net Theta</td>
                <td className={`font-bold text-right ${aggregateGreeks.theta >= 0 ? 'text-[#006100] dark:text-emerald-400' : 'text-[#ff0000] dark:text-rose-455'}`}>{aggregateGreeks.theta.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] dark:bg-slate-950 dark:text-slate-400">Net Vega</td>
                <td className={`font-bold text-right ${aggregateGreeks.vega >= 0 ? 'text-[#006100] dark:text-emerald-400' : 'text-[#ff0000] dark:text-rose-455'}`}>{aggregateGreeks.vega.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Global Inputs Ribbon */}
      <table className="excel-table mb-4">
        <tbody>
          <tr>
            <td className="bg-[#e6e6e6] dark:bg-slate-950 dark:text-slate-400 font-bold w-20">Symbol</td>
            <td className="excel-input font-bold text-center w-24">NIFTY</td>
            <td className="bg-[#e6e6e6] dark:bg-slate-950 dark:text-slate-400 text-center w-20 font-bold">Date</td>
            <td className="bg-[#e6e6e6] dark:bg-slate-950 dark:text-slate-400 text-center w-32">Time</td>
            <td className="bg-[#e6e6e6] dark:bg-slate-950 dark:text-slate-400 w-24 font-bold">Interest Rate</td>
            <td className="excel-input text-center w-20">
              <input type="number" step="0.01" className="w-full bg-transparent text-center outline-none" value={interestRate*100} onChange={e => setGlobalParams({interestRate: Number(e.target.value)/100})} />%
            </td>
            <td className="bg-[#e6e6e6] dark:bg-slate-950 dark:text-slate-400 text-center w-24 font-bold">Div Amount</td>
            <td className="bg-[#e6e6e6] dark:bg-slate-950 dark:text-slate-400 text-center w-24 font-bold">Ex Div Date</td>
            <td className="bg-[#e6e6e6] dark:bg-slate-950 dark:text-slate-400 w-24 font-bold">Underlying Type</td>
            <td>Index</td>
          </tr>
          <tr>
            <td className="bg-[#e6e6e6] dark:bg-slate-950 dark:text-slate-400 font-bold">Stock Price</td>
            <td className="excel-input text-center font-bold">
               <input type="number" className="w-full bg-transparent text-center outline-none" value={underlyingPrice} onChange={e => setGlobalParams({underlyingPrice: Number(e.target.value)})} />
            </td>
            <td colSpan="2" className="bg-[#c6efce] dark:bg-emerald-950/45 text-center font-bold text-black dark:text-emerald-400">2026-05-26 15:30:00 (IST)</td>
            <td className="bg-[#e6e6e6] dark:bg-slate-950 dark:text-slate-400 font-bold">Dividend Yield</td>
            <td className="excel-input text-center">
              <input type="number" step="0.01" className="w-full bg-transparent text-center outline-none" value={dividendYield*100} onChange={e => setGlobalParams({dividendYield: Number(e.target.value)/100})} />%
            </td>
            <td className="excel-input"></td>
            <td className="excel-input"></td>
            <td className="bg-[#c6efce] dark:bg-emerald-950/45 font-bold text-center text-black dark:text-slate-200">Total P/L:</td>
            <td className={`bg-[#c6efce] dark:bg-emerald-950/45 font-bold text-center ${aggregateGreeks.totalPnl >= 0 ? 'text-[#006100] dark:text-emerald-400' : 'text-[#ff0000] dark:text-rose-455'}`}>₹ {aggregateGreeks.totalPnl.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      {/* SECTION 1: LIVE BROKER POSITIONS FROM KOTAK NEO */}
      <div className="mb-4">
        <div className="bg-[#002060] dark:bg-slate-950 dark:text-indigo-400 dark:border-b dark:border-slate-800 text-white font-bold px-2 py-1 flex items-center justify-between text-xs">
          <span>🔒 LIVE BROKER POSITIONS (AUTO-SYNCING FROM KOTAK NEO)</span>
          <span className="text-[10px] text-gray-300 dark:text-slate-500">Read-Only legs mapped directly from active portfolio</span>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="excel-table" style={{ minWidth: '1200px' }}>
            <thead>
              <tr className="bg-[#f2f2f2] dark:bg-slate-950 font-bold text-slate-800 dark:text-slate-400">
                <th className="w-8">Leg</th>
                <th className="w-12">Enable</th>
                <th className="w-24">Underlying</th>
                <th className="w-32">Expiry</th>
                <th className="w-24">Strike Price</th>
                <th className="w-20">Option Type</th>
                <th className="w-20">Net Qty</th>
                <th className="w-24">Avg Entry Price</th>
                <th className="w-20">LTP</th>
                <th className="w-24">P/L</th>
                <th className="w-20">Delta</th>
                <th className="w-20">Theta</th>
                <th className="w-20">IV %</th>
                <th>DTE</th>
              </tr>
            </thead>
            <tbody>
              {displayedLiveLegs.length === 0 ? (
                <tr>
                  <td colSpan="14" className="text-center text-gray-500 py-3 bg-white dark:bg-slate-900 font-bold">
                    No active positions found matching the current filters.
                  </td>
                </tr>
              ) : (
                displayedLiveLegs.map((leg, i) => {
                  const pnl = (leg.ltp - leg.entryPrice) * leg.size + (leg.realizedPnl || 0);
                  const optType = leg.type === 'Call' || leg.type === 'CE' ? 'CE' : leg.type === 'Put' || leg.type === 'PE' ? 'PE' : leg.type;
                  
                  return (
                    <tr key={leg.id} className="bg-white dark:bg-slate-900">
                      <td className="bg-[#e6e6e6] dark:bg-slate-950 text-center font-bold text-black dark:text-slate-400">{i + 1}</td>
                      <td className="bg-[#c6efce] dark:bg-emerald-950/45 text-center">
                        <input type="checkbox" checked={leg.isOpen} onChange={e => handleToggleLivePosition(leg.symbol, e.target.checked)} disabled={leg.size === 0} />
                      </td>
                      <td className="font-bold text-center bg-gray-50 dark:bg-slate-950 text-[#002060] dark:text-indigo-400">{leg.underlying}</td>
                      <td className="text-center font-semibold text-slate-800 dark:text-slate-300">{formatExpiryPremium(leg.expDate)}</td>
                      <td className="text-right font-mono">{leg.strike ? Number(leg.strike).toFixed(2) : '-'}</td>
                      <td className={`text-center font-bold ${optType === 'CE' ? 'text-[#008800] dark:text-emerald-400' : optType === 'PE' ? 'text-[#cc0000] dark:text-rose-455' : ''}`}>{optType}</td>
                      <td className={`font-bold text-right ${leg.size > 0 ? 'text-finance-green' : 'text-finance-red'}`}>{leg.size}</td>
                      <td className="text-right">₹ {leg.entryPrice.toFixed(2)}</td>
                      <td className="text-right font-bold">₹ {leg.ltp.toFixed(2)}</td>
                      <td className={`text-right font-bold ${pnl >= 0 ? 'text-[#006100] dark:text-emerald-400' : 'text-[#ff0000] dark:text-rose-455'}`}>₹ {pnl.toFixed(2)}</td>
                      <td className={`text-right ${leg.delta * leg.size >= 0 ? 'text-[#006100] dark:text-emerald-400' : 'text-[#ff0000] dark:text-rose-455'}`}>{((leg.delta || 0) * leg.size).toFixed(2)}</td>
                      <td className={`text-right ${leg.theta * leg.size >= 0 ? 'text-[#006100] dark:text-emerald-400' : 'text-[#ff0000] dark:text-rose-455'}`}>{((leg.theta || 0) * leg.size).toFixed(2)}</td>
                      <td className="text-center">{(leg.iv * 100).toFixed(1)}%</td>
                      <td className="text-center font-bold bg-[#c6efce] dark:bg-emerald-950/45 text-[#006100] dark:text-emerald-400">{leg.dte}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>


    </div>
  );
};

