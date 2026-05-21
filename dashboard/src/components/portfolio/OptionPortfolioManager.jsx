import React, { useMemo, useState } from 'react';
import { usePortfolioStore } from '../../store/usePortfolioStore';
import { calculateBlackScholes } from '../../utils/blackScholes';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend } from 'recharts';

export const OptionPortfolioManager = () => {
  const { legs, addLeg, updateLeg, removeLeg, underlyingPrice, interestRate, dividendYield, setGlobalParams } = usePortfolioStore();

  const [simDate, setSimDate] = useState(0);
  const [ivShifts, setIvShifts] = useState([0, 0.04, 0.08]); // Blue (Base), Green (+4%), Red (+8%)

  // Scenario Chart Data
  const chartData = useMemo(() => {
    if (legs.length === 0) return [];
    
    const strikes = legs.map(l => l.strike);
    const minStrike = Math.min(...strikes, underlyingPrice) * 0.7;
    const maxStrike = Math.max(...strikes, underlyingPrice) * 1.3;
    
    const data = [];
    for (let s = minStrike; s <= maxStrike; s += (maxStrike - minStrike) / 50) {
      const point = { spot: s };
      
      ivShifts.forEach((ivShift, idx) => {
        let totalPnl = 0;
        legs.forEach(leg => {
          if (!leg.isOpen) {
             totalPnl += (leg.exitPrice - leg.entryPrice) * leg.size;
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
  }, [legs, underlyingPrice, simDate, ivShifts, interestRate, dividendYield]);

  // Aggregate Greeks calculation
  const aggregateGreeks = useMemo(() => {
    let delta = 0, gamma = 0, theta = 0, vega = 0, realizedPnl = 0, openPnl = 0, netPremium = 0;
    
    legs.forEach(leg => {
      if (!leg.isOpen) {
        realizedPnl += (leg.exitPrice - leg.entryPrice) * leg.size;
        netPremium += leg.entryPrice * leg.size * -1; // rough CF
        return;
      }
      netPremium += leg.entryPrice * leg.size * -1;

      const simDTE = Math.max(0, leg.dte - simDate);
      const simT = simDTE / 365.0;
      const bs = calculateBlackScholes(leg.type, underlyingPrice, leg.strike, simT, interestRate, leg.iv, dividendYield);
      
      openPnl += (bs.price - leg.entryPrice) * leg.size;
      delta += bs.delta * leg.size;
      gamma += bs.gamma * leg.size;
      theta += bs.theta * leg.size;
      vega += bs.vega * leg.size;
    });

    return { delta, gamma, theta, vega, totalPnl: realizedPnl + openPnl, netPremium };
  }, [legs, underlyingPrice, simDate, interestRate, dividendYield]);

  return (
    <div className="flex flex-col h-full bg-white text-black overflow-y-auto p-2" style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>
      {/* Title */}
      <div className="flex items-center mb-2 px-1">
        <h1 className="text-xl font-bold" style={{ color: '#002060' }}>Option Portfolio Manager</h1>
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
                <td className="bg-[#f2f2f2] w-24">Chart Mode</td>
                <td>Scenario Analysis</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2]">ChartLines</td>
                <td>Volatility (Flat)</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2]">X-Axis</td>
                <td>Stock Price</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2]">Y-Axis</td>
                <td>Profit/Loss</td>
              </tr>
              <tr>
                <td colSpan="2" className="bg-[#c6efce] text-[#006100]">Chart shows Entire Position P/L</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2]">Line Inputs</td>
                <td className="bg-[#f2f2f2] font-bold text-center">Volatility</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2]">Blue</td>
                <td className="excel-input text-center">{(ivShifts[0]*100).toFixed(2)}%</td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2]">Green</td>
                <td className="excel-input text-center">
                  <input type="number" step="0.5" className="w-full bg-transparent text-center outline-none" value={ivShifts[1]*100} onChange={e => { const v = [...ivShifts]; v[1] = Number(e.target.value)/100; setIvShifts(v); }} />
                </td>
              </tr>
              <tr>
                <td className="bg-[#f2f2f2]">Red</td>
                <td className="excel-input text-center">
                  <input type="number" step="0.5" className="w-full bg-transparent text-center outline-none" value={ivShifts[2]*100} onChange={e => { const v = [...ivShifts]; v[2] = Number(e.target.value)/100; setIvShifts(v); }} />
                </td>
              </tr>
            </tbody>
          </table>

          {/* Risk Profile */}
          <table className="excel-table flex-1">
            <tbody>
              <tr>
                <td className="bg-[#e6e6e6] w-20">Risk Profile</td>
                <td colSpan="2" className="bg-[#e6e6e6]">Blue</td>
              </tr>
              <tr>
                <td className="bg-[#92d050] border-none"></td>
                <td className="bg-[#e6e6e6] text-center">Stock Price</td>
                <td className="bg-[#e6e6e6] text-center">Profit/Loss</td>
              </tr>
              <tr>
                <td className="bg-[#92d050] font-bold border-none px-2">MAX</td>
                <td className="bg-[#92d050] text-center border-[#92d050]">-</td>
                <td className="bg-[#92d050] text-center border-[#92d050]">-</td>
              </tr>
              <tr>
                <td colSpan="3" className="bg-[#92d050] border-none h-full"></td>
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
            <td className="bg-[#e6e6e6] text-center w-20">Date</td>
            <td className="bg-[#e6e6e6] text-center w-32">Time</td>
            <td className="bg-[#e6e6e6] w-24">Interest Rate</td>
            <td className="excel-input text-center w-20">
              <input type="number" step="0.01" className="w-full bg-transparent text-center outline-none" value={interestRate*100} onChange={e => setGlobalParams({interestRate: Number(e.target.value)/100})} />%
            </td>
            <td className="bg-[#e6e6e6] text-center w-24">Div Amount</td>
            <td className="bg-[#e6e6e6] text-center w-24">Ex Div Date</td>
            <td className="bg-[#e6e6e6] w-24">Underlying Type</td>
            <td>Index</td>
          </tr>
          <tr>
            <td className="bg-[#e6e6e6]">Stock Price</td>
            <td className="excel-input text-center font-bold">
               <input type="number" className="w-full bg-transparent text-center outline-none" value={underlyingPrice} onChange={e => setGlobalParams({underlyingPrice: Number(e.target.value)})} />
            </td>
            <td colSpan="2" className="bg-[#c6efce] text-center">2026-05-08 15:30:00</td>
            <td className="bg-[#e6e6e6]">Dividend Yield</td>
            <td className="excel-input text-center">
              <input type="number" step="0.01" className="w-full bg-transparent text-center outline-none" value={dividendYield*100} onChange={e => setGlobalParams({dividendYield: Number(e.target.value)/100})} />%
            </td>
            <td className="excel-input"></td>
            <td className="excel-input"></td>
            <td className="bg-[#c6efce] font-bold text-center">Min P/L</td>
            <td className="bg-[#c6efce] font-bold text-center">Max P/L</td>
          </tr>
        </tbody>
      </table>

      {/* Legs Table */}
      <div className="w-full overflow-x-auto pb-4">
        <table className="excel-table" style={{ minWidth: '1200px' }}>
          <thead>
            <tr>
              <th colSpan="7" className="bg-[#e6e6e6] border-r-2 border-r-gray-400">Leg Specs</th>
              <th colSpan="2" className="bg-[#e6e6e6] border-r-2 border-r-gray-400">Entry & Exit</th>
              <th className="bg-[#c6efce]">{aggregateGreeks.netPremium.toFixed(2)}</th>
              <th className="bg-[#e6e6e6] border-r-2 border-r-gray-400">Volatility</th>
              <th className="bg-[#e6e6e6]">Totals &gt;&gt;&gt;</th>
              <th className="bg-[#c6efce]"></th>
              <th className="bg-[#c6efce]">{aggregateGreeks.totalPnl.toFixed(2)}</th>
              <th className="bg-[#c6efce]">{aggregateGreeks.delta.toFixed(4)}</th>
              <th className="bg-[#c6efce]">{aggregateGreeks.gamma.toFixed(4)}</th>
              <th className="bg-[#c6efce]">{aggregateGreeks.theta.toFixed(4)}</th>
            </tr>
            <tr className="bg-[#e6e6e6]">
              <th className="w-8">Leg</th>
              <th className="w-12">IsOpen</th>
              <th className="w-16">Size</th>
              <th className="w-20">Strike</th>
              <th className="w-16">Type</th>
              <th className="w-24">Exp Date</th>
              <th className="w-16 border-r-2 border-r-gray-400">DTE</th>
              <th className="w-20">Entry Price</th>
              <th className="w-20 border-r-2 border-r-gray-400">Exit Price</th>
              <th className="w-20">CF</th>
              <th className="w-20 border-r-2 border-r-gray-400">Override IV</th>
              <th className="w-16">Price</th>
              <th className="w-20">Value</th>
              <th className="w-20">P/L</th>
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
                  <td className="bg-[#e6e6e6] text-center">{i + 1}</td>
                  <td className="bg-[#c6efce] text-center">
                    <input type="checkbox" checked={leg.isOpen} onChange={e => updateLeg(leg.id, {isOpen: e.target.checked})} />
                  </td>
                  <td className="excel-input">
                    <input type="number" className="w-full bg-transparent text-right outline-none" value={leg.size} onChange={e => updateLeg(leg.id, {size: Number(e.target.value)})} />
                  </td>
                  <td className="excel-input">
                    <input type="number" className="w-full bg-transparent text-right outline-none" value={leg.strike} onChange={e => updateLeg(leg.id, {strike: Number(e.target.value)})} />
                  </td>
                  <td className="excel-input text-center">
                    <select className="bg-transparent outline-none" value={leg.type} onChange={e => updateLeg(leg.id, {type: e.target.value})}>
                      <option value="Call">C</option>
                      <option value="Put">P</option>
                    </select>
                  </td>
                  <td className="excel-input text-center">{leg.expDate}</td>
                  <td className="bg-[#c6efce] text-center border-r-2 border-r-gray-400">
                     <input type="number" className="w-full bg-transparent text-center outline-none" value={leg.dte} onChange={e => updateLeg(leg.id, {dte: Number(e.target.value)})} />
                  </td>
                  <td className="excel-input">
                    <input type="number" step="0.05" className="w-full bg-transparent text-right outline-none" value={leg.entryPrice} onChange={e => updateLeg(leg.id, {entryPrice: Number(e.target.value)})} />
                  </td>
                  <td className="excel-input border-r-2 border-r-gray-400">
                    <input type="number" step="0.05" className="w-full bg-transparent text-right outline-none" value={leg.exitPrice} onChange={e => updateLeg(leg.id, {exitPrice: Number(e.target.value)})} disabled={leg.isOpen} />
                  </td>
                  <td className={`bg-[#c6efce] text-right font-bold ${cf < 0 ? 'text-[#ff0000]' : 'text-black'}`}>
                    {cf.toFixed(2)}
                  </td>
                  <td className="excel-input border-r-2 border-r-gray-400 text-center">
                    <input type="number" step="0.01" className="w-full bg-transparent text-center outline-none" value={leg.iv*100} onChange={e => updateLeg(leg.id, {iv: Number(e.target.value)/100})} />%
                  </td>
                  <td className="bg-[#c6efce] text-right text-[#006100]">{bs.price.toFixed(2)}</td>
                  <td className="bg-[#c6efce] text-right text-[#006100]">{value.toFixed(2)}</td>
                  <td className={`bg-[#c6efce] text-right font-bold ${pnl < 0 ? 'text-[#ff0000]' : 'text-[#006100]'}`}>{pnl.toFixed(2)}</td>
                  <td className={`bg-[#c6efce] text-right ${bs.delta * leg.size < 0 ? 'text-[#ff0000]' : 'text-[#006100]'}`}>{(bs.delta * leg.size).toFixed(4)}</td>
                  <td className={`bg-[#c6efce] text-right ${bs.gamma * leg.size < 0 ? 'text-[#ff0000]' : 'text-[#006100]'}`}>{(bs.gamma * leg.size).toFixed(4)}</td>
                  <td className={`bg-[#c6efce] text-right ${bs.theta * leg.size < 0 ? 'text-[#ff0000]' : 'text-[#006100]'}`}>{(bs.theta * leg.size).toFixed(4)}</td>
                </tr>
              )
            })}
            
            {/* Empty Rows Padding */}
            {Array.from({ length: Math.max(0, 10 - legs.length) }).map((_, i) => (
              <tr key={`empty-${i}`}>
                <td className="bg-[#e6e6e6] text-center">{legs.length + i + 1}</td>
                <td className="bg-[#c6efce] text-center">0</td>
                <td className="excel-input"></td>
                <td className="excel-input"></td>
                <td className="excel-input"></td>
                <td className="excel-input"></td>
                <td className="bg-[#c6efce] border-r-2 border-r-gray-400"></td>
                <td className="excel-input"></td>
                <td className="excel-input border-r-2 border-r-gray-400"></td>
                <td className="bg-[#c6efce]">0.00</td>
                <td className="excel-input border-r-2 border-r-gray-400"></td>
                <td className="bg-[#c6efce] text-right text-[#006100]">0.00</td>
                <td className="bg-[#c6efce] text-right text-[#006100]">0.00</td>
                <td className="bg-[#c6efce] text-right text-[#006100]">0.00</td>
                <td className="bg-[#c6efce] text-right text-[#006100]">0.0000</td>
                <td className="bg-[#c6efce] text-right text-[#006100]">0.0000</td>
                <td className="bg-[#c6efce] text-right text-[#006100]">0.0000</td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <div className="flex gap-2 mt-2">
           <button onClick={() => addLeg({})} className="bg-[#e6e6e6] border border-[#ccc] px-3 py-1 text-xs hover:bg-[#d9d9d9] font-bold">Add Leg</button>
           <button onClick={() => {if(legs.length > 0) removeLeg(legs[legs.length-1].id)}} className="bg-[#e6e6e6] border border-[#ccc] px-3 py-1 text-xs hover:bg-[#d9d9d9] font-bold">Remove Last</button>
        </div>
      </div>
    </div>
  );
};
