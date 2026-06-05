import React, { useMemo, useState, useEffect } from 'react';
import { usePortfolioStore } from '../../store/usePortfolioStore';
import { useTerminalStore } from '../../store/useTerminalStore';
import { calculateBlackScholes } from '../../utils/blackScholes';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
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
  const { legs, addLeg, updateLeg, removeLeg, underlyingPrice, interestRate, dividendYield, setGlobalParams } = usePortfolioStore();
  const livePositions = useTerminalStore(state => state.positions);
  const spotPrice = useTerminalStore(state => state.spotPrice);
  const selectedUnderlying = useTerminalStore(state => state.selectedUnderlying);

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

  // Filter only active positions from broker
  const activeLivePositions = useMemo(() => {
    return livePositions.filter(p => p.netQty !== 0);
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
        isOpen: excludedLivePositions[pos.symbol] !== false,
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
        theta: pos.theta || 0
      };
    });
  }, [activeLivePositions, excludedLivePositions, underlyingPrice]);

  // Combine Manually Entered Strategy Legs and Live Broker Positions
  const combinedLegs = useMemo(() => {
    const parsedManualLegs = legs.map(l => {
      const parsedSymbol = l.symbol ? parseOptionSymbol(l.symbol) : null;
      const legUnderlying = (parsedSymbol && parsedSymbol.underlying) || l.underlying || selectedUnderlying || 'NIFTY';
      return {
        ...l,
        underlying: legUnderlying,
        isPaper: true,
        isLive: false,
      };
    });
    return [...parsedLiveLegs, ...parsedManualLegs];
  }, [parsedLiveLegs, legs, selectedUnderlying]);

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

  // Filtered manual strategy legs for table display
  const displayedManualLegs = useMemo(() => {
    return legs.map(l => {
      const parsedSymbol = l.symbol ? parseOptionSymbol(l.symbol) : null;
      const legUnderlying = (parsedSymbol && parsedSymbol.underlying) || l.underlying || selectedUnderlying || 'NIFTY';
      return {
        ...l,
        underlying: legUnderlying,
        isPaper: true,
        isLive: false,
      };
    }).filter(leg => {
      if (modeFilter === 'LIVE') return false;
      if (underlyingFilter !== 'ALL' && (leg.underlying || '').toUpperCase() !== underlyingFilter.toUpperCase()) return false;
      return true;
    });
  }, [legs, modeFilter, underlyingFilter, selectedUnderlying]);

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

  // Aggregate Greeks calculation across manual legs & live positions
  const aggregateGreeks = useMemo(() => {
    let delta = 0, gamma = 0, theta = 0, vega = 0, realizedPnl = 0, openPnl = 0, netPremium = 0;
    
    filteredLegs.forEach(leg => {
      if (!leg.isOpen) {
        if (leg.isLive) return; // ignore inactive live positions
        realizedPnl += (leg.exitPrice - leg.entryPrice) * leg.size;
        netPremium += leg.entryPrice * leg.size * -1;
        return;
      }
      netPremium += leg.entryPrice * leg.size * -1;

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
    <div className="flex flex-col h-full bg-white text-black overflow-y-auto p-2" style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>
      {/* Title */}
      <div className="flex items-center justify-between mb-2 px-1">
        <h1 className="text-xl font-bold" style={{ color: '#002060' }}>Option Portfolio Manager</h1>
        <div className="flex items-center gap-1.5 bg-[#c6efce] text-[#006100] px-2 py-0.5 font-bold border border-finance-green text-xs">
          <span>● KOTAK NEO LIVE ACTIVE</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-4 bg-[#f2f2f2] border border-[#ccc] px-2 py-1.5 mb-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-[#555]">TRADING MODE:</span>
          <select 
            className="bg-white border border-[#ccc] px-2 py-0.5 outline-none font-bold text-xs"
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
          >
            <option value="ALL">ALL TRADES</option>
            <option value="LIVE">LIVE (ACTUAL) TRADES</option>
            <option value="PAPER">PAPER TRADES</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-bold text-[#555]">UNDERLYING:</span>
          <select 
            className="bg-white border border-[#ccc] px-2 py-0.5 outline-none font-bold text-xs"
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
        <div className="flex-1 border border-[#ccc] bg-white relative">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 15, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis dataKey="spot" stroke="#000" tick={{ fontSize: 10 }} domain={['dataMin', 'dataMax']} type="number" tickFormatter={(v) => Math.round(v)} />
              <YAxis stroke="#000" tick={{ fontSize: 10 }} />
              <Tooltip 
                labelFormatter={(label) => `Spot Price: ${Math.round(label)}`} 
                formatter={(value) => [`₹ ${Number(value).toFixed(2)}`]}
                contentStyle={{ backgroundColor: '#fff', borderColor: '#ccc', fontSize: 12, color: '#000' }} 
              />
              <ReferenceLine y={0} stroke="#000" />
              <ReferenceLine x={underlyingPrice} stroke="#ff9900" strokeDasharray="3 3" label={{ value: `Spot: ${Math.round(underlyingPrice)}`, position: 'top', fill: '#ff9900', fontSize: 10, fontWeight: 'bold' }} />
              
              {/* Expiry Payoff Curve (peaked dashed line, similar to Kotak Securities OneTouch) */}
              <Line type="monotone" dataKey="pnl_expiry" stroke="#7f7f7f" strokeWidth={2} strokeDasharray="4 4" name="At Expiry" dot={false} isAnimationActive={false} />
              
              {/* Target Date Scenario Payoff Curves */}
              <Line type="monotone" dataKey="pnl_0" stroke="#0000ff" strokeWidth={1.5} name={simDate === 0 ? "Today (Base IV)" : `T+${simDate} (Base IV)`} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="pnl_1" stroke="#008000" strokeWidth={1.5} name={simDate === 0 ? `Today (+${(ivShifts[1]*100).toFixed(0)}% IV)` : `T+${simDate} (+${(ivShifts[1]*100).toFixed(0)}% IV)`} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="pnl_2" stroke="#ff0000" strokeWidth={1.5} name={simDate === 0 ? `Today (+${(ivShifts[2]*100).toFixed(0)}% IV)` : `T+${simDate} (+${(ivShifts[2]*100).toFixed(0)}% IV)`} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Right Side Settings Tables */}
        <div className="w-80 flex flex-col gap-2">
          {/* Chart Settings */}
          <table className="excel-table">
            <tbody>
              <tr>
                <td className="bg-[#f2f2f2] w-24 font-bold">Chart Mode</td>
                <td>Scenario Analysis</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] font-bold">Time Shift</td>
                <td className="flex items-center gap-1.5 px-1 bg-[#ffffcc]">
                  <input type="range" min="0" max="30" value={simDate} onChange={e => setSimDate(Number(e.target.value))} className="w-full h-2 accent-[#002060] cursor-pointer" />
                  <span className="text-xs font-mono font-bold w-12 text-center">{simDate} Days</span>
                </td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] font-bold">X-Axis</td>
                <td>Stock Price</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] font-bold">Y-Axis</td>
                <td>Profit/Loss</td>
              </tr>
              <tr>
                <td colSpan="2" className="bg-[#c6efce] text-[#006100] font-bold text-center">Chart displays Combined Risk Curve</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] font-bold">Line Inputs</td>
                <td className="bg-[#f2f2f2] font-bold text-center">Volatility Shift</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] text-blue-700 font-bold">Blue (Flat)</td>
                <td className="excel-neutral-bg text-center font-bold">{(ivShifts[0]*100).toFixed(2)}%</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] text-green-700 font-bold">Green Shift</td>
                <td className="excel-input text-center">
                  <input type="number" step="0.5" className="w-full bg-transparent text-center outline-none" value={ivShifts[1]*100} onChange={e => { const v = [...ivShifts]; v[1] = Number(e.target.value)/100; setIvShifts(v); }} />
                </td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2] text-red-700 font-bold">Red Shift</td>
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
                <td className="bg-[#f2f2f2] w-24">Net Delta</td>
                <td className={`font-bold text-right ${aggregateGreeks.delta >= 0 ? 'text-[#006100]' : 'text-[#ff0000]'}`}>{aggregateGreeks.delta.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2]">Net Gamma</td>
                <td className={`font-bold text-right ${aggregateGreeks.gamma >= 0 ? 'text-[#006100]' : 'text-[#ff0000]'}`}>{aggregateGreeks.gamma.toFixed(4)}</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2]">Net Theta</td>
                <td className={`font-bold text-right ${aggregateGreeks.theta >= 0 ? 'text-[#006100]' : 'text-[#ff0000]'}`}>{aggregateGreeks.theta.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2]">Net Vega</td>
                <td className={`font-bold text-right ${aggregateGreeks.vega >= 0 ? 'text-[#006100]' : 'text-[#ff0000]'}`}>{aggregateGreeks.vega.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Global Inputs Ribbon */}
      <table className="excel-table mb-4">
        <tbody>
          <tr>
            <td className="bg-[#e6e6e6] font-bold w-20">Symbol</td>
            <td className="excel-input font-bold text-center w-24">NIFTY</td>
            <td className="bg-[#e6e6e6] text-center w-20 font-bold">Date</td>
            <td className="bg-[#e6e6e6] text-center w-32">Time</td>
            <td className="bg-[#e6e6e6] w-24 font-bold">Interest Rate</td>
            <td className="excel-input text-center w-20">
              <input type="number" step="0.01" className="w-full bg-transparent text-center outline-none" value={interestRate*100} onChange={e => setGlobalParams({interestRate: Number(e.target.value)/100})} />%
            </td>
            <td className="bg-[#e6e6e6] text-center w-24 font-bold">Div Amount</td>
            <td className="bg-[#e6e6e6] text-center w-24 font-bold">Ex Div Date</td>
            <td className="bg-[#e6e6e6] w-24 font-bold">Underlying Type</td>
            <td>Index</td>
          </tr>
          <tr>
            <td className="bg-[#e6e6e6] font-bold">Stock Price</td>
            <td className="excel-input text-center font-bold">
               <input type="number" className="w-full bg-transparent text-center outline-none" value={underlyingPrice} onChange={e => setGlobalParams({underlyingPrice: Number(e.target.value)})} />
            </td>
            <td colSpan="2" className="bg-[#c6efce] text-center font-bold">2026-05-26 15:30:00 (IST)</td>
            <td className="bg-[#e6e6e6] font-bold">Dividend Yield</td>
            <td className="excel-input text-center">
              <input type="number" step="0.01" className="w-full bg-transparent text-center outline-none" value={dividendYield*100} onChange={e => setGlobalParams({dividendYield: Number(e.target.value)/100})} />%
            </td>
            <td className="excel-input"></td>
            <td className="excel-input"></td>
            <td className="bg-[#c6efce] font-bold text-center">Total P/L:</td>
            <td className={`bg-[#c6efce] font-bold text-center ${aggregateGreeks.totalPnl >= 0 ? 'text-[#006100]' : 'text-[#ff0000]'}`}>₹ {aggregateGreeks.totalPnl.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      {/* SECTION 1: LIVE BROKER POSITIONS FROM KOTAK NEO */}
      <div className="mb-4">
        <div className="bg-[#002060] text-white font-bold px-2 py-1 flex items-center justify-between text-xs">
          <span>🔒 LIVE BROKER POSITIONS (AUTO-SYNCING FROM KOTAK NEO)</span>
          <span className="text-[10px] text-gray-300">Read-Only legs mapped directly from active portfolio</span>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="excel-table" style={{ minWidth: '1200px' }}>
            <thead>
              <tr className="bg-[#f2f2f2] font-bold">
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
                  <td colSpan="14" className="text-center text-gray-500 py-3 bg-white font-bold">
                    No active positions found matching the current filters.
                  </td>
                </tr>
              ) : (
                displayedLiveLegs.map((leg, i) => {
                  const pnl = (leg.ltp - leg.entryPrice) * leg.size;
                  const optType = leg.type === 'Call' || leg.type === 'CE' ? 'CE' : leg.type === 'Put' || leg.type === 'PE' ? 'PE' : leg.type;
                  
                  return (
                    <tr key={leg.id} className="bg-white">
                      <td className="bg-[#e6e6e6] text-center font-bold">{i + 1}</td>
                      <td className="bg-[#c6efce] text-center">
                        <input type="checkbox" checked={leg.isOpen} onChange={e => handleToggleLivePosition(leg.symbol, e.target.checked)} />
                      </td>
                      <td className="font-bold text-center bg-gray-50 text-[#002060]">{leg.underlying}</td>
                      <td className="text-center font-semibold text-slate-800">{formatExpiryPremium(leg.expDate)}</td>
                      <td className="text-right font-mono">{leg.strike ? Number(leg.strike).toFixed(2) : '-'}</td>
                      <td className={`text-center font-bold ${optType === 'CE' ? 'text-[#008800]' : optType === 'PE' ? 'text-[#cc0000]' : ''}`}>{optType}</td>
                      <td className={`font-bold text-right ${leg.size > 0 ? 'text-finance-green' : 'text-finance-red'}`}>{leg.size}</td>
                      <td className="text-right">₹ {leg.entryPrice.toFixed(2)}</td>
                      <td className="text-right font-bold">₹ {leg.ltp.toFixed(2)}</td>
                      <td className={`text-right font-bold ${pnl >= 0 ? 'text-[#006100]' : 'text-[#ff0000]'}`}>₹ {pnl.toFixed(2)}</td>
                      <td className={`text-right ${leg.delta * leg.size >= 0 ? 'text-[#006100]' : 'text-[#ff0000]'}`}>{((leg.delta || 0) * leg.size).toFixed(2)}</td>
                      <td className={`text-right ${leg.theta * leg.size >= 0 ? 'text-[#006100]' : 'text-[#ff0000]'}`}>{((leg.theta || 0) * leg.size).toFixed(2)}</td>
                      <td className="text-center">{(leg.iv * 100).toFixed(1)}%</td>
                      <td className="text-center font-bold bg-[#c6efce]">{leg.dte}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: STRATEGY DESIGN & ADJUSTMENT LEGS */}
      <div>
        <div className="bg-[#595959] text-white font-bold px-2 py-1 flex items-center justify-between text-xs">
          <span>🛠️ STRATEGY DESIGNER & ADJUSTMENT SIMULATION LEGS</span>
          <span className="text-[10px] text-gray-300">Add adjustment legs here to model hedging scenarios against live portfolio</span>
        </div>
        <div className="w-full overflow-x-auto pb-4">
          <table className="excel-table" style={{ minWidth: '1200px' }}>
            <thead>
              <tr className="bg-[#f2f2f2] font-bold">
                <th className="w-8">Leg</th>
                <th className="w-12">IsOpen</th>
                <th className="w-16">Size</th>
                <th className="w-20">Strike</th>
                <th className="w-16">Type</th>
                <th className="w-24">Exp Date</th>
                <th className="w-16 border-r-2 border-r-gray-400">DTE</th>
                <th className="w-20">Entry Price</th>
                <th className="w-20 border-r-2 border-r-gray-400">Exit Price</th>
                <th className="w-20">CF (Cash Flow)</th>
                <th className="w-20 border-r-2 border-r-gray-400">Override IV</th>
                <th className="w-16">Model Px</th>
                <th className="w-20">Value</th>
                <th className="w-20">Sim P/L</th>
                <th className="w-20">Delta</th>
                <th className="w-20">Gamma</th>
                <th className="w-20">Theta</th>
              </tr>
            </thead>
            <tbody>
              {displayedManualLegs.map((leg, i) => {
                const simDTE = Math.max(0, leg.dte - simDate);
                const simT = simDTE / 365.0;
                const bs = calculateBlackScholes(leg.type, underlyingPrice, leg.strike, simT, interestRate, leg.iv, dividendYield);
                const cf = leg.size * leg.entryPrice * -1;
                const value = leg.isOpen ? bs.price * leg.size : 0;
                const pnl = leg.isOpen ? (bs.price - leg.entryPrice) * leg.size : (leg.exitPrice - leg.entryPrice) * leg.size;

                return (
                  <tr key={leg.id}>
                    <td className="bg-[#e6e6e6] text-center font-bold">{i + 1}</td>
                    <td className="bg-[#c6efce] text-center">
                      <input type="checkbox" checked={leg.isOpen} onChange={e => updateLeg(leg.id, {isOpen: e.target.checked})} />
                    </td>
                    <td className="excel-input">
                      <input type="number" className="w-full bg-transparent text-right outline-none font-bold" value={leg.size} onChange={e => updateLeg(leg.id, {size: Number(e.target.value)})} />
                    </td>
                    <td className="excel-input">
                      <input type="number" className="w-full bg-transparent text-right outline-none" value={leg.strike} onChange={e => updateLeg(leg.id, {strike: Number(e.target.value)})} />
                    </td>
                    <td className="excel-input text-center font-bold">
                      <select className="bg-transparent outline-none" value={leg.type} onChange={e => updateLeg(leg.id, {type: e.target.value})}>
                        <option value="Call">CE</option>
                        <option value="Put">PE</option>
                      </select>
                    </td>
                    <td className="excel-input text-center">{leg.expDate}</td>
                    <td className="bg-[#c6efce] text-center border-r-2 border-r-gray-400 font-bold">
                       <input type="number" className="w-full bg-transparent text-center outline-none" value={leg.dte} onChange={e => updateLeg(leg.id, {dte: Number(e.target.value)})} />
                    </td>
                    <td className="excel-input">
                      <input type="number" step="0.05" className="w-full bg-transparent text-right outline-none font-bold" value={leg.entryPrice} onChange={e => updateLeg(leg.id, {entryPrice: Number(e.target.value)})} />
                    </td>
                    <td className="excel-input border-r-2 border-r-gray-400">
                      <input type="number" step="0.05" className="w-full bg-transparent text-right outline-none" value={leg.exitPrice} onChange={e => updateLeg(leg.id, {exitPrice: Number(e.target.value)})} disabled={leg.isOpen} />
                    </td>
                    <td className={`bg-[#c6efce] text-right font-bold ${cf < 0 ? 'text-[#ff0000]' : 'text-black'}`}>
                      ₹ {cf.toFixed(2)}
                    </td>
                    <td className="excel-input border-r-2 border-r-gray-400 text-center">
                      <input type="number" step="0.01" className="w-full bg-transparent text-center outline-none" value={leg.iv*100} onChange={e => updateLeg(leg.id, {iv: Number(e.target.value)/100})} />%
                    </td>
                    <td className="bg-[#c6efce] text-right text-[#006100]">₹ {bs.price.toFixed(2)}</td>
                    <td className="bg-[#c6efce] text-right text-[#006100]">₹ {value.toFixed(2)}</td>
                    <td className={`bg-[#c6efce] text-right font-bold ${pnl < 0 ? 'text-[#ff0000]' : 'text-[#006100]'}`}>₹ {pnl.toFixed(2)}</td>
                    <td className={`bg-[#c6efce] text-right ${bs.delta * leg.size < 0 ? 'text-[#ff0000]' : 'text-[#006100]'}`}>{(bs.delta * leg.size).toFixed(2)}</td>
                    <td className={`bg-[#c6efce] text-right ${bs.gamma * leg.size < 0 ? 'text-[#ff0000]' : 'text-[#006100]'}`}>{(bs.gamma * leg.size).toFixed(4)}</td>
                    <td className={`bg-[#c6efce] text-right ${bs.theta * leg.size < 0 ? 'text-[#ff0000]' : 'text-[#006100]'}`}>{(bs.theta * leg.size).toFixed(2)}</td>
                  </tr>
                )
              })}
              
              {/* Empty Rows Padding */}
              {Array.from({ length: Math.max(0, 5 - displayedManualLegs.length) }).map((_, i) => (
                <tr key={`empty-${i}`}>
                  <td className="bg-[#e6e6e6] text-center">{displayedManualLegs.length + i + 1}</td>
                  <td className="bg-[#c6efce] text-center">-</td>
                  <td className="excel-input"></td>
                  <td className="excel-input"></td>
                  <td className="excel-input"></td>
                  <td className="excel-input"></td>
                  <td className="bg-[#c6efce] border-r-2 border-r-gray-400"></td>
                  <td className="excel-input"></td>
                  <td className="excel-input border-r-2 border-r-gray-400"></td>
                  <td className="bg-[#c6efce]">₹ 0.00</td>
                  <td className="excel-input border-r-2 border-r-gray-400"></td>
                  <td className="bg-[#c6efce] text-right text-[#006100]">₹ 0.00</td>
                  <td className="bg-[#c6efce] text-right text-[#006100]">₹ 0.00</td>
                  <td className="bg-[#c6efce] text-right text-[#006100]">₹ 0.00</td>
                  <td className="bg-[#c6efce] text-right text-[#006100]">0.00</td>
                  <td className="bg-[#c6efce] text-right text-[#006100]">0.0000</td>
                  <td className="bg-[#c6efce] text-right text-[#006100]">0.00</td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div className="flex gap-2 mt-2 px-1">
             <button onClick={() => addLeg({})} className="bg-[#e6e6e6] border border-[#ccc] px-3 py-1 text-xs hover:bg-[#d9d9d9] font-bold">Add Simulation Leg</button>
             <button onClick={() => {if(legs.length > 0) removeLeg(legs[legs.length-1].id)}} className="bg-[#e6e6e6] border border-[#ccc] px-3 py-1 text-xs hover:bg-[#d9d9d9] font-bold">Remove Last Simulation Leg</button>
          </div>
        </div>
      </div>
    </div>
  );
};

