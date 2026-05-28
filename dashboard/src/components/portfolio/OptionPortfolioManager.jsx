import React, { useMemo, useState, useEffect } from 'react';
import { usePortfolioStore } from '../../store/usePortfolioStore';
import { useTerminalStore } from '../../store/useTerminalStore';
import { calculateBlackScholes } from '../../utils/blackScholes';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

/**
 * Robust parser for Kotak Neo / NSE option trading symbols.
 * Mapped types: CE -> Call, PE -> Put.
 * Support weekly and monthly contracts.
 */
const parseOptionSymbol = (symbol) => {
  if (!symbol) return null;
  const clean = symbol.replace(/\s+/g, '').toUpperCase();
  
  // Match: [SYMBOL][EXPIRY_AND_STRIKE][CE|PE]
  const match = clean.match(/^([A-Z]+)(\d+.*)(CE|PE)$/);
  if (!match) return null;
  
  const underlying = match[1];
  const middle = match[2];
  const type = match[3] === 'CE' ? 'Call' : 'Put';
  
  const HOLIDAYS_2026 = new Set([
    "2026-01-15", "2026-01-26", "2026-03-03", "2026-03-26", "2026-03-31",
    "2026-04-03", "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-26",
    "2026-09-14", "2026-10-02", "2026-10-20", "2026-11-10", "2026-11-24",
    "2026-12-25"
  ]);

  const shiftExpiryDate = (dt) => {
    while (true) {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      const dtStr = `${y}-${m}-${d}`;
      const dayOfWeek = dt.getDay(); // 0 = Sunday, 6 = Saturday
      
      if (dayOfWeek === 0 || dayOfWeek === 6 || HOLIDAYS_2026.has(dtStr)) {
        dt.setDate(dt.getDate() - 1);
      } else {
        break;
      }
    }
    return dt;
  };

  // Find the 3-letter month (JAN, FEB, etc.)
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  let monthIdx = -1;
  let monthName = '';
  for (let m of months) {
    const idx = middle.indexOf(m);
    if (idx !== -1) {
      monthIdx = idx;
      monthName = m;
      break;
    }
  }
  
  if (monthIdx === -1) {
    // Try matching the weekly numeric format: NIFTY YY M DD STRIKE CE/PE
    // e.g. 2652822000 -> 26 (Year), 5 (Month), 28 (Day), 22000 (Strike)
    const weeklyMatch = middle.match(/^(\d{2})([0-9A-Z])(\d{2})([\d\.]+)$/);
    if (weeklyMatch) {
      const year = parseInt('20' + weeklyMatch[1]);
      const monthChar = weeklyMatch[2];
      let monthVal = 0;
      if (monthChar === 'O') monthVal = 9;
      else if (monthChar === 'N') monthVal = 10;
      else if (monthChar === 'D') monthVal = 11;
      else monthVal = parseInt(monthChar) - 1;
      
      const day = parseInt(weeklyMatch[3]);
      const strike = parseFloat(weeklyMatch[4]);
      
      const now = new Date();
      const d = new Date(year, monthVal, day, 15, 30, 0);
      const shiftedD = shiftExpiryDate(d);
      const expDate = shiftedD.toISOString().split('T')[0];
      const dte = Math.max(0, Math.ceil((shiftedD - now) / (1000 * 60 * 60 * 24)));
      
      return { underlying, expiryStr: middle.substring(0, 5), expDate, dte, strike, type };
    }
    return null;
  }
  
  // Parse month-based symbol
  const yearStr = middle.substring(0, monthIdx);
  const afterMonth = middle.substring(monthIdx + 3);
  
  // Count digits after the month
  const digitsOnly = afterMonth.replace(/\D/g, '');
  
  let day = null;
  let strikeStr = afterMonth;
  
  if (digitsOnly.length >= 7) {
    // First 2 digits are the day
    const dayStr = digitsOnly.substring(0, 2);
    day = parseInt(dayStr);
    strikeStr = afterMonth.substring(2);
  }
  
  const strike = parseFloat(strikeStr);
  const year = parseInt('20' + yearStr);
  const monthVal = months.indexOf(monthName);
  
  const now = new Date();
  let expDate = '';
  let dte = 7;
  
  // Special exception for May 2026 SENSEX/BANKEX contracts expiring on May 27 due to holiday on May 28
  if (year === 2026 && monthVal === 4) { // May is 4 (0-indexed)
    if (underlying === 'SENSEX' || underlying === 'BANKEX') {
      if (day === null || day === 28 || day === 29) {
        day = 27;
      }
    }
  }

  if (day !== null) {
    const d = new Date(year, monthVal, day, 15, 30, 0);
    const shiftedD = shiftExpiryDate(d);
    expDate = shiftedD.toISOString().split('T')[0];
    dte = Math.max(0, Math.ceil((shiftedD - now) / (1000 * 60 * 60 * 24)));
  } else {
    // Monthly option: last Tuesday of the month (last Thursday for SENSEX/BANKEX)
    const lastDay = new Date(year, monthVal + 1, 0).getDate();
    const targetDay = (underlying === 'SENSEX' || underlying === 'BANKEX') ? 4 : 2; // 4 is Thursday, 2 is Tuesday
    for (let d = lastDay; d > lastDay - 7; d--) {
      const checkDate = new Date(year, monthVal, d);
      if (checkDate.getDay() === targetDay) {
        day = d;
        break;
      }
    }
    
    // Shift monthly option if falls on Buddha Purnima holiday
    if (year === 2026 && monthVal === 4 && (underlying === 'SENSEX' || underlying === 'BANKEX') && day === 28) {
      day = 27;
    }
    
    const d = new Date(year, monthVal, day, 15, 30, 0);
    const shiftedD = shiftExpiryDate(d);
    expDate = shiftedD.toISOString().split('T')[0];
    dte = Math.max(0, Math.ceil((shiftedD - now) / (1000 * 60 * 60 * 24)));
  }
  
  return { underlying, expiryStr: middle.substring(0, monthIdx + 3), expDate, dte, strike, type };
};

export const OptionPortfolioManager = () => {
  const { legs, addLeg, updateLeg, removeLeg, underlyingPrice, interestRate, dividendYield, setGlobalParams } = usePortfolioStore();
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
        id: `live-${pos.symbol}`,
        isLive: true,
        symbol: pos.symbol,
        isOpen: excludedLivePositions[pos.symbol] !== false,
        size,
        strike: parsed.strike,
        type: parsed.type,
        expDate: pos.expiry || parsed.expDate,
        dte: pos.dte !== null && pos.dte !== undefined ? pos.dte : parsed.dte,
        entryPrice: entryPrice || pos.ltp || 0,
        exitPrice: 0,
        iv: pos.iv !== null && pos.iv !== undefined ? pos.iv : 0.16, // live or fallback IV
        ltp: pos.ltp,
        delta: pos.delta || 0,
        theta: pos.theta || 0
      };
    });
  }, [activeLivePositions, excludedLivePositions, underlyingPrice]);

  // Combine Manually Entered Strategy Legs and Live Broker Positions
  const combinedLegs = useMemo(() => {
    return [...parsedLiveLegs, ...legs];
  }, [parsedLiveLegs, legs]);

  // Toggle dynamic inclusion of live broker positions in scenario risk engine
  const handleToggleLivePosition = (symbol, checked) => {
    setExcludedLivePositions(prev => ({
      ...prev,
      [symbol]: checked
    }));
  };

  // Scenario Chart Data
  const chartData = useMemo(() => {
    const activeLegs = combinedLegs.filter(l => l.isOpen);
    if (activeLegs.length === 0) return [];
    
    const strikes = activeLegs.map(l => l.strike);
    const minStrike = Math.min(...strikes, underlyingPrice) * 0.85;
    const maxStrike = Math.max(...strikes, underlyingPrice) * 1.15;
    
    const data = [];
    for (let s = minStrike; s <= maxStrike; s += (maxStrike - minStrike) / 50) {
      const point = { spot: s };
      
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
  }, [combinedLegs, underlyingPrice, simDate, ivShifts, interestRate, dividendYield]);

  // Aggregate Greeks calculation across manual legs & live positions
  const aggregateGreeks = useMemo(() => {
    let delta = 0, gamma = 0, theta = 0, vega = 0, realizedPnl = 0, openPnl = 0, netPremium = 0;
    
    combinedLegs.forEach(leg => {
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
  }, [combinedLegs, underlyingPrice, simDate, interestRate, dividendYield]);

  return (
    <div className="flex flex-col h-full bg-white text-black overflow-y-auto p-2" style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>
      {/* Title */}
      <div className="flex items-center justify-between mb-2 px-1">
        <h1 className="text-xl font-bold" style={{ color: '#002060' }}>Option Portfolio Manager</h1>
        <div className="flex items-center gap-1.5 bg-[#c6efce] text-[#006100] px-2 py-0.5 font-bold border border-finance-green text-xs">
          <span>● KOTAK NEO LIVE ACTIVE</span>
        </div>
      </div>

      <div className="flex flex-row gap-2 mb-2 h-64">
        {/* Chart */}
        <div className="flex-1 border border-[#ccc] bg-white relative">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis dataKey="spot" stroke="#000" tick={{ fontSize: 10 }} domain={['dataMin', 'dataMax']} type="number" tickFormatter={(v) => Math.round(v)} />
              <YAxis stroke="#000" tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(label) => `Spot Price: ${Math.round(label)}`} contentStyle={{ backgroundColor: '#fff', borderColor: '#ccc', fontSize: 12, color: '#000' }} />
              <ReferenceLine y={0} stroke="#000" />
              <Line type="monotone" dataKey="pnl_0" stroke="#0000ff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="pnl_1" stroke="#008000" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="pnl_2" stroke="#ff0000" strokeWidth={1.5} dot={false} isAnimationActive={false} />
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
                <th className="w-48">Trading Symbol</th>
                <th className="w-20">Net Qty</th>
                <th className="w-20">Strike</th>
                <th className="w-16">Type</th>
                <th className="w-20">Avg Entry Price</th>
                <th className="w-20">LTP</th>
                <th className="w-20">P/L</th>
                <th className="w-20">Delta</th>
                <th className="w-20">Theta</th>
                <th className="w-20">IV %</th>
                <th className="w-24">Expiry</th>
                <th>DTE</th>
              </tr>
            </thead>
            <tbody>
              {parsedLiveLegs.length === 0 ? (
                <tr>
                  <td colSpan="14" className="text-center text-gray-500 py-3 bg-white font-bold">
                    No active positions found in Kotak Neo Broker account.
                  </td>
                </tr>
              ) : (
                parsedLiveLegs.map((leg, i) => {
                  const pnl = (leg.ltp - leg.entryPrice) * leg.size;
                  return (
                    <tr key={leg.id} className="bg-white">
                      <td className="bg-[#e6e6e6] text-center font-bold">{i + 1}</td>
                      <td className="bg-[#c6efce] text-center">
                        <input type="checkbox" checked={leg.isOpen} onChange={e => handleToggleLivePosition(leg.symbol, e.target.checked)} />
                      </td>
                      <td className="font-bold text-left bg-gray-50">{leg.symbol}</td>
                      <td className={`font-bold text-right ${leg.size > 0 ? 'text-finance-green' : 'text-finance-red'}`}>{leg.size}</td>
                      <td className="text-right">{leg.strike}</td>
                      <td className="text-center font-bold">{leg.type}</td>
                      <td className="text-right">₹ {leg.entryPrice.toFixed(2)}</td>
                      <td className="text-right font-bold">₹ {leg.ltp.toFixed(2)}</td>
                      <td className={`text-right font-bold ${pnl >= 0 ? 'text-[#006100]' : 'text-[#ff0000]'}`}>₹ {pnl.toFixed(2)}</td>
                      <td className={`text-right ${leg.delta * leg.size >= 0 ? 'text-[#006100]' : 'text-[#ff0000]'}`}>{((leg.delta || 0) * leg.size).toFixed(2)}</td>
                      <td className={`text-right ${leg.theta * leg.size >= 0 ? 'text-[#006100]' : 'text-[#ff0000]'}`}>{((leg.theta || 0) * leg.size).toFixed(2)}</td>
                      <td className="text-center">{(leg.iv * 100).toFixed(1)}%</td>
                      <td className="text-center">{leg.expDate}</td>
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
              {legs.map((leg, i) => {
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
              {Array.from({ length: Math.max(0, 5 - legs.length) }).map((_, i) => (
                <tr key={`empty-${i}`}>
                  <td className="bg-[#e6e6e6] text-center">{legs.length + i + 1}</td>
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

