import React, { useMemo, useState, useEffect } from 'react';
import { usePortfolioStore } from '../../store/usePortfolioStore';
import { calculateExpirationPayoff } from '../../utils/blackScholes';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

const STRATEGY_GROUPS = {
  'Single Leg': ['Long Call', 'Short Call', 'Long Put', 'Short Put'],
  'Directional Spreads': ['Bull Call Spread', 'Bear Call Spread', 'Bull Put Spread', 'Bear Put Spread'],
  'Volatility': ['Straddle', 'Short Straddle', 'Strangle', 'Short Strangle', 'Iron Condor', 'Iron Butterfly', 'Call Butterfly', 'Put Butterfly'],
  'Hedging & Income': ['Covered Call', 'Protective Put', 'Collar']
};

const STRATEGY_INFO = {
  'Long Call': { motivation: 'Capitalize on a bullish move.', outlook: 'Strongly Bullish.', gain: 'Unlimited.', loss: 'Limited to premium paid.', timeDecay: 'Harmful (Negative Theta).', volatility: 'Helpful (Positive Vega).' },
  'Short Call': { motivation: 'Generate income from a stagnant or falling market.', outlook: 'Bearish to Neutral.', gain: 'Limited to premium received.', loss: 'Unlimited if stock rises.', timeDecay: 'Helpful (Positive Theta).', volatility: 'Harmful (Negative Vega).' },
  'Long Put': { motivation: 'Capitalize on a bearish move.', outlook: 'Strongly Bearish.', gain: 'Substantial (down to zero).', loss: 'Limited to premium paid.', timeDecay: 'Harmful (Negative Theta).', volatility: 'Helpful (Positive Vega).' },
  'Short Put': { motivation: 'Generate income or buy stock lower.', outlook: 'Bullish to Neutral.', gain: 'Limited to premium received.', loss: 'Substantial if stock drops.', timeDecay: 'Helpful (Positive Theta).', volatility: 'Harmful (Negative Vega).' },
  
  'Bull Call Spread': { motivation: 'Profit from a moderate rise.', outlook: 'Moderately Bullish.', gain: 'Limited (Difference in strikes - net premium).', loss: 'Limited to net premium paid.', timeDecay: 'Mixed (depends on spot).', volatility: 'Mixed.' },
  'Bear Call Spread': { motivation: 'Generate income if stock falls/stalls.', outlook: 'Moderately Bearish.', gain: 'Limited to net premium received.', loss: 'Limited (Difference in strikes - net premium).', timeDecay: 'Helpful.', volatility: 'Harmful.' },
  'Bull Put Spread': { motivation: 'Generate income if stock rises/stalls.', outlook: 'Moderately Bullish.', gain: 'Limited to net premium received.', loss: 'Limited (Difference in strikes - net premium).', timeDecay: 'Helpful.', volatility: 'Harmful.' },
  'Bear Put Spread': { motivation: 'Profit from a moderate fall.', outlook: 'Moderately Bearish.', gain: 'Limited (Difference in strikes - net premium).', loss: 'Limited to net premium paid.', timeDecay: 'Mixed.', volatility: 'Mixed.' },

  'Straddle': { motivation: 'Profit from a massive breakout in either direction.', outlook: 'Highly Volatile (Direction Neutral).', gain: 'Unlimited.', loss: 'Limited to premium paid.', timeDecay: 'Very Harmful.', volatility: 'Very Helpful.' },
  'Short Straddle': { motivation: 'Profit from zero movement.', outlook: 'Strictly Neutral.', gain: 'Limited to premium received.', loss: 'Unlimited.', timeDecay: 'Very Helpful.', volatility: 'Very Harmful.' },
  'Strangle': { motivation: 'Profit from a large breakout (cheaper than straddle).', outlook: 'Highly Volatile (Direction Neutral).', gain: 'Unlimited.', loss: 'Limited to premium paid.', timeDecay: 'Harmful.', volatility: 'Helpful.' },
  'Short Strangle': { motivation: 'Profit from a trading range.', outlook: 'Neutral.', gain: 'Limited to premium received.', loss: 'Unlimited.', timeDecay: 'Helpful.', volatility: 'Harmful.' },
  'Iron Condor': { motivation: 'Profit from a defined trading range with capped risk.', outlook: 'Neutral.', gain: 'Limited to net premium received.', loss: 'Limited to strike width - premium.', timeDecay: 'Helpful.', volatility: 'Harmful.' },
  'Iron Butterfly': { motivation: 'Profit from stock pinning exactly at the short strikes.', outlook: 'Strictly Neutral.', gain: 'Limited to net premium received.', loss: 'Limited to strike width - premium.', timeDecay: 'Helpful.', volatility: 'Harmful.' },
  'Call Butterfly': { motivation: 'Low cost, high reward if stock pins a specific strike.', outlook: 'Neutral or Target-Specific.', gain: 'Limited (Max at middle strike).', loss: 'Limited to premium paid.', timeDecay: 'Helpful (if near middle strike).', volatility: 'Harmful.' },
  'Put Butterfly': { motivation: 'Low cost, high reward if stock pins a specific strike.', outlook: 'Neutral or Target-Specific.', gain: 'Limited (Max at middle strike).', loss: 'Limited to premium paid.', timeDecay: 'Helpful (if near middle strike).', volatility: 'Harmful.' },

  'Covered Call': { motivation: 'Enhance yield on a long stock position.', outlook: 'Moderately Bullish.', gain: 'Limited to strike price + premium.', loss: 'Substantial (down to zero).', timeDecay: 'Helpful.', volatility: 'Harmful.' },
  'Protective Put': { motivation: 'Insure a long stock position against a crash.', outlook: 'Bullish (but risk-averse).', gain: 'Unlimited.', loss: 'Limited to put premium.', timeDecay: 'Harmful.', volatility: 'Helpful.' },
  'Collar': { motivation: 'Finance downside protection by selling upside potential.', outlook: 'Moderately Bullish (risk-averse).', gain: 'Limited to short call strike.', loss: 'Limited to long put strike.', timeDecay: 'Mixed.', volatility: 'Mixed.' },
};

import { useTerminalStore } from '../../store/useTerminalStore';

const getLotSize = (symbol) => {
  if (!symbol) return 1;
  const upper = symbol.toUpperCase();
  if (upper.startsWith('NIFTY')) return 65;
  if (upper.startsWith('BANKNIFTY')) return 30;
  if (upper.startsWith('FINNIFTY')) return 60;
  if (upper.startsWith('MIDCPNIFTY')) return 120;
  if (upper.startsWith('SENSEX')) return 20;
  if (upper.startsWith('BANKEX')) return 30;
  return 1;
};

export const StrategyBuilder = () => {
  const { legs, updateLeg, loadStrategyPreset, clearLegs } = usePortfolioStore();
  const optionChain = useTerminalStore(s => s.optionChain);
  const liveSpotPrice = useTerminalStore(s => s.spotPrice);
  const selectedUnderlying = useTerminalStore(s => s.selectedUnderlying);
  const [spotPrice, setSpotPrice] = useState(liveSpotPrice || 22000);
  const [selectedGroup, setSelectedGroup] = useState('Volatility');
  const [selectedStrategy, setSelectedStrategy] = useState('Iron Condor');

  // Load selected strategy
  const handleStrategyChange = (e) => {
    const strategy = e.target.value;
    setSelectedStrategy(strategy);
    loadStrategyPreset(strategy, liveSpotPrice || spotPrice, optionChain);
  };

  // Auto-load default strategy on first mount or when live spot price / option chain becomes available
  useEffect(() => {
    if (liveSpotPrice && optionChain && optionChain.length > 0) {
      const isDefault = legs.length === 0 || legs.every(l => l.entryPrice === 100);
      if (isDefault) {
        loadStrategyPreset(selectedStrategy, liveSpotPrice, optionChain);
      }
    }
  }, [liveSpotPrice, optionChain, selectedStrategy]);

  // Sync with live spot price
  useEffect(() => {
    if (liveSpotPrice) {
      setSpotPrice(liveSpotPrice);
    }
  }, [liveSpotPrice]);

  // Reload strategy preset when underlying changes
  useEffect(() => {
    if (liveSpotPrice && optionChain && optionChain.length > 0) {
      loadStrategyPreset(selectedStrategy, liveSpotPrice, optionChain);
    }
  }, [selectedUnderlying]);

  const chartData = useMemo(() => {
    if (legs.length === 0) return [];
    
    const strikes = legs.map(l => l.strike);
    const minStrike = Math.min(...strikes) || spotPrice;
    const maxStrike = Math.max(...strikes) || spotPrice;
    
    const range = Math.max(maxStrike - minStrike, spotPrice * 0.1);
    
    // Determine step size dynamically based on underlying and spot price scale
    let step = 50;
    if (selectedUnderlying === 'BANKNIFTY' || selectedUnderlying === 'SENSEX') {
      step = 100;
    } else if (spotPrice < 1000) {
      step = 5;
    } else if (spotPrice < 5000) {
      step = 10;
    } else {
      step = 50;
    }

    const startX = Math.floor((minStrike - range * 0.5) / step) * step;
    const endX = Math.ceil((maxStrike + range * 0.5) / step) * step;
    
    const data = [];
    // Dynamically calculate increment to keep around 100 data points for Recharts rendering
    const totalSteps = 100;
    const increment = Math.max(1, Math.round((endX - startX) / totalSteps));
    for (let s = startX; s <= endX; s += increment) {
      const pnl = calculateExpirationPayoff(legs, s);
      data.push({ spot: s, pnl });
    }
    return data;
  }, [legs, spotPrice, selectedUnderlying]);

  const metrics = useMemo(() => {
    if (chartData.length === 0) return { maxProfit: 0, maxLoss: 0, netPremium: 0, keyPoints: [] };
    
    const pnls = chartData.map(d => d.pnl);
    let maxProfit = Math.max(...pnls);
    let maxLoss = Math.min(...pnls);
    
    if (pnls[pnls.length - 1] > pnls[pnls.length - 2] && pnls[pnls.length - 1] === maxProfit) maxProfit = Infinity;
    if (pnls[0] > pnls[1] && pnls[0] === maxProfit) maxProfit = Infinity;
    if (pnls[pnls.length - 1] < pnls[pnls.length - 2] && pnls[pnls.length - 1] === maxLoss) maxLoss = -Infinity;
    if (pnls[0] < pnls[1] && pnls[0] === maxLoss) maxLoss = -Infinity;

    let netPremium = 0;
    let totalInitialCF = 0;
    
    // Key points (Strikes)
    const strikes = [...new Set(legs.map(l => l.strike))].sort((a,b)=>a-b);
    const keyPoints = [];
    keyPoints.push({ label: 'Zero', spot: 0, pnl: calculateExpirationPayoff(legs, 0) });
    
    strikes.forEach((k, i) => {
      keyPoints.push({ label: `Strike ${i+1}`, spot: k, pnl: calculateExpirationPayoff(legs, k) });
    });
    
    // Break-even points detection
    for (let i = 0; i < chartData.length - 1; i++) {
        if ((chartData[i].pnl < 0 && chartData[i+1].pnl >= 0) || (chartData[i].pnl > 0 && chartData[i+1].pnl <= 0)) {
            keyPoints.push({ label: 'Break-even', spot: chartData[i].spot, pnl: 0 });
        }
    }
    
    keyPoints.push({ label: 'Infinite', spot: Infinity, pnl: pnls[pnls.length-1] });

    return { maxProfit, maxLoss, netPremium, keyPoints: keyPoints.sort((a,b) => a.spot - b.spot) };
  }, [chartData, legs]);

  // Aggregate legs math with Live Value integration
  let totalCF = 0;
  let totalValue = 0;
  legs.forEach(leg => {
    const cf = leg.size * leg.entryPrice * -1;
    totalCF += cf;
    
    // Find live LTP for valuation
    const marketData = optionChain.find(o => o.strike === leg.strike);
    const ltp = leg.type === 'Call' ? marketData?.ce?.ltp : marketData?.pe?.ltp;
    if (ltp) {
        totalValue += leg.size * ltp;
    }
  });

  return (
    <div className="flex flex-col h-full bg-white text-black overflow-y-auto p-2" style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>
      {/* Title */}
      <div className="flex items-center mb-4">
        <h1 className="text-xl font-bold" style={{ color: '#002060' }}>Option Strategy Payoff Calculator</h1>
      </div>

      <div className="flex flex-row gap-4">
        {/* Left Column: Inputs and Chart */}
        <div className="flex-1 flex flex-col gap-4">
          
          {/* Strategy Selection & Underlying */}
          <div className="flex gap-4">
            <table className="excel-table w-72">
              <tbody>
                <tr>
                  <td className="bg-[#e6e6e6]">Select Group</td>
                  <td>
                    <select 
                      className="w-full bg-transparent outline-none"
                      value={selectedGroup}
                      onChange={(e) => {
                        const newGroup = e.target.value;
                        setSelectedGroup(newGroup);
                        if (newGroup !== 'All') {
                          const firstStrategy = STRATEGY_GROUPS[newGroup][0];
                          setSelectedStrategy(firstStrategy);
                          loadStrategyPreset(firstStrategy, liveSpotPrice || spotPrice, optionChain);
                        }
                      }}
                    >
                      <option value="All">All Groups</option>
                      {Object.keys(STRATEGY_GROUPS).map(group => (
                        <option key={group} value={group}>{group}</option>
                      ))}
                    </select>
                  </td>
                </tr>
                <tr>
                  <td className="bg-[#e6e6e6]">Select Strategy</td>
                  <td>
                    <select className="w-full bg-transparent outline-none" value={selectedStrategy} onChange={handleStrategyChange}>
                      {selectedGroup === 'All' 
                        ? Object.values(STRATEGY_GROUPS).flat().map(strat => (
                            <option key={strat} value={strat}>{strat}</option>
                          ))
                        : STRATEGY_GROUPS[selectedGroup].map(strat => (
                            <option key={strat} value={strat}>{strat}</option>
                          ))
                      }
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
            
            <div className="flex flex-col gap-1 justify-center">
              <button onClick={clearLegs} className="bg-[#e6e6e6] border border-[#ccc] px-4 py-2 font-bold text-xs h-full hover:bg-[#d9d9d9]">
                Reset<br/>Position
              </button>
            </div>

            <div className="flex flex-col gap-1 justify-center">
              <button 
                onClick={() => {
                   const executeStrategy = useTerminalStore.getState().executeStrategy;
                   const selectedUnderlying = useTerminalStore.getState().selectedUnderlying || 'NIFTY';
                   const selectedExpiry = useTerminalStore.getState().selectedExpiry;
                   
                   const formatExpiry = (expiryStr) => {
                     if (!expiryStr) return '';
                     const clean = expiryStr.replace(/-/g, ' ').trim();
                     const parts = clean.split(/\s+/);
                     if (parts.length >= 3) {
                       const day = parts[0].padStart(2, '0');
                       const month = parts[1].substring(0, 3).toUpperCase();
                       const year = parts[2].substring(parts[2].length - 2);
                       return `${day}${month}${year}`;
                     }
                     return expiryStr.replace(/-/g, '').toUpperCase();
                   };

                   const payloadLegs = legs.map(l => {
                     const row = optionChain.find(r => r.strike === l.strike);
                     let legSymbol = row ? (l.type === 'Call' ? row.ce_symbol : row.pe_symbol) : null;
                     
                     if (!legSymbol) {
                       const expiryFormatted = formatExpiry(selectedExpiry);
                       const optType = l.type === 'Call' ? 'CE' : 'PE';
                       legSymbol = `${selectedUnderlying} ${expiryFormatted} ${l.strike} ${optType}`;
                     }

                     const lotSize = row ? (row.lot_size || getLotSize(selectedUnderlying)) : getLotSize(selectedUnderlying);

                     return {
                       symbol: legSymbol,
                       side: l.size > 0 ? 'BUY' : 'SELL',
                       quantity: Math.abs(l.size) * lotSize,
                       strike: l.strike,
                       type: l.type
                     };
                   });
                   executeStrategy(selectedStrategy, payloadLegs)
                    .then(() => alert('Strategy executed successfully!'))
                    .catch(err => alert(`Execution failed: ${err.message}`));
                }}
                className="bg-finance-green text-white px-4 py-2 font-bold text-xs h-full hover:opacity-90 flex items-center justify-center text-center"
              >
                EXECUTE<br/>STRATEGY
              </button>
            </div>

            <table className="excel-table w-48 h-fit self-end">
              <tbody>
                <tr>
                  <td className="bg-[#e6e6e6]">Underlying Price</td>
                  <td className="excel-input text-center font-bold">
                    <input type="number" value={spotPrice} onChange={e => setSpotPrice(Number(e.target.value))} className="w-full bg-transparent text-center outline-none" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Legs Table */}
          <table className="excel-table">
            <thead>
              <tr className="bg-[#e6e6e6]">
                <th className="w-12">Leg</th>
                <th className="w-20">Position</th>
                <th className="w-24">Type</th>
                <th className="w-24">Strike</th>
                <th className="w-24">Initial Price</th>
                <th className="w-24">Initial CF</th>
                <th className="w-24">Value</th>
                <th className="w-24">P/L</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((leg, i) => {
                const cf = leg.size * leg.entryPrice * -1;
                const marketData = optionChain.find(o => o.strike === leg.strike);
                const ltp = leg.type === 'Call' ? marketData?.ce?.ltp : marketData?.pe?.ltp;
                const value = ltp ? leg.size * ltp : 0;
                const pnl = ltp ? (value + cf) : cf;

                return (
                  <tr key={leg.id}>
                    <td className="bg-[#e6e6e6] text-center">{i + 1}</td>
                    <td className="excel-input">
                      <input type="number" className="w-full bg-transparent text-right outline-none font-bold" value={leg.size} onChange={e => updateLeg(leg.id, {size: Number(e.target.value)})} />
                    </td>
                    <td className="excel-input text-center">
                      <select className="bg-transparent outline-none" value={leg.type} onChange={e => updateLeg(leg.id, {type: e.target.value})}>
                        <option value="Call">Call</option>
                        <option value="Put">Put</option>
                      </select>
                    </td>
                    <td className="excel-input">
                      <input type="number" className="w-full bg-transparent text-right outline-none" value={leg.strike} onChange={e => updateLeg(leg.id, {strike: Number(e.target.value)})} />
                    </td>
                    <td className="excel-input">
                      <input type="number" step="0.05" className="w-full bg-transparent text-right outline-none" value={leg.entryPrice} onChange={e => updateLeg(leg.id, {entryPrice: Number(e.target.value)})} />
                    </td>
                    <td className={`bg-[#c6efce] text-right font-bold ${cf < 0 ? 'text-[#ff0000]' : 'text-black'}`}>
                      {cf.toFixed(2)}
                    </td>
                    <td className="bg-[#c6efce] text-right text-[#006100]">{value.toFixed(2)}</td>
                    <td className={`bg-[#c6efce] text-right font-bold ${pnl < 0 ? 'text-[#ff0000]' : 'text-[#006100]'}`}>{pnl.toFixed(2)}</td>
                  </tr>
                );
              })}
              {/* Padding rows */}
              {Array.from({ length: Math.max(0, 4 - legs.length) }).map((_, i) => (
                <tr key={`empty-${i}`}>
                  <td className="bg-[#e6e6e6] text-center">{legs.length + i + 1}</td>
                  <td className="bg-[#e6e6e6]"></td>
                  <td className="bg-[#e6e6e6]"></td>
                  <td className="bg-[#e6e6e6]"></td>
                  <td className="bg-[#e6e6e6]"></td>
                  <td className="bg-[#e6e6e6]"></td>
                  <td className="bg-[#e6e6e6]"></td>
                  <td className="bg-[#e6e6e6]"></td>
                </tr>
              ))}
              <tr>
                <td colSpan="4" className="bg-[#e6e6e6] text-right font-bold pr-4">Total</td>
                <td className="bg-[#e6e6e6]"></td>
                <td className="bg-[#c6efce] text-right text-[#006100] font-bold">{totalCF.toFixed(2)}</td>
                <td className="bg-[#c6efce] text-right text-[#006100] font-bold">{totalValue.toFixed(2)}</td>
                <td className={`bg-[#c6efce] text-right font-bold ${(totalValue + totalCF) < 0 ? 'text-[#ff0000]' : 'text-[#006100]'}`}>{(totalValue + totalCF).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          {/* Chart */}
          <div className="h-64 border border-[#ccc] bg-white relative">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 20, right: 20, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="spot" stroke="#000" tick={{ fontSize: 10 }} type="number" domain={['dataMin', 'dataMax']} />
                <YAxis stroke="#000" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#ccc', fontSize: 12, color: '#000' }} />
                <ReferenceLine y={0} stroke="#000" strokeWidth={1} />
                <Line type="monotone" dataKey="pnl" stroke="#25517e" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column: Key Points & Risk */}
        <div className="w-80 flex flex-col gap-4">
          
          {/* Risk Profile */}
          <table className="excel-table">
            <tbody>
              <tr>
                <td className="bg-[#e6e6e6] font-bold">Maximum Profit</td>
                <td className="bg-[#c6efce] text-right text-[#006100] font-bold">
                  {metrics.maxProfit === Infinity ? 'Infinite' : metrics.maxProfit.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td className="bg-[#e6e6e6] font-bold">Maximum Loss</td>
                <td className="bg-[#c6efce] text-right text-[#ff0000] font-bold">
                  {metrics.maxLoss === -Infinity ? 'Infinite' : metrics.maxLoss.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td className="bg-[#e6e6e6] font-bold">Reward to Risk</td>
                <td className="bg-[#c6efce] text-right text-[#006100] font-bold">
                  {metrics.maxLoss === -Infinity ? '0.00' : 
                   metrics.maxProfit === Infinity ? 'Infinite' : 
                   metrics.maxLoss === 0 ? 'Infinite' :
                   Math.abs(metrics.maxProfit / metrics.maxLoss).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Key Points Table */}
          <table className="excel-table flex-1">
            <thead>
              <tr className="bg-[#e6e6e6]">
                <th className="text-left">Key Points</th>
                <th className="text-right">Und Price</th>
                <th className="text-right">%</th>
                <th className="text-right">P/L</th>
              </tr>
            </thead>
            <tbody>
              {metrics.keyPoints.map((kp, i) => {
                const pct = kp.spot === 0 ? -100 : 
                            kp.spot === Infinity ? 'Infinite' : 
                            ((kp.spot - spotPrice) / spotPrice * 100).toFixed(2) + '%';
                
                return (
                  <tr key={i}>
                    <td className="bg-[#e6e6e6]">{kp.label}</td>
                    <td className="bg-[#c6efce] text-right text-black">
                      {kp.spot === Infinity ? 'Infinite' : kp.spot.toFixed(2)}
                    </td>
                    <td className="bg-[#c6efce] text-right text-black">
                      {pct}
                    </td>
                    <td className={`bg-[#c6efce] text-right ${kp.pnl < 0 ? 'text-[#ff0000]' : 'text-[#006100]'}`}>
                      {kp.pnl.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
              {/* Padding */}
              {Array.from({ length: Math.max(0, 10 - metrics.keyPoints.length) }).map((_, i) => (
                <tr key={`empty-kp-${i}`}>
                  <td className="bg-[#e6e6e6] h-[22px]"></td>
                  <td className="bg-[#c6efce]"></td>
                  <td className="bg-[#c6efce]"></td>
                  <td className="bg-[#c6efce]"></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Strategy Info Panel */}
          {STRATEGY_INFO[selectedStrategy] && (
            <div className="border border-[#ccc] bg-finance-panel mt-auto">
              <div className="bg-[#e6e6e6] px-2 py-1 font-bold border-b border-[#ccc] flex justify-between">
                <span>Strategy Profile</span>
                <span className="text-[#002060]">{selectedStrategy}</span>
              </div>
              <table className="excel-table border-none w-full text-xs">
                <tbody>
                  <tr>
                    <td className="font-bold bg-[#f2f2f2] w-28">Outlook</td>
                    <td>{STRATEGY_INFO[selectedStrategy].outlook}</td>
                  </tr>
                  <tr>
                    <td className="font-bold bg-[#f2f2f2]">Motivation</td>
                    <td>{STRATEGY_INFO[selectedStrategy].motivation}</td>
                  </tr>
                  <tr>
                    <td className="font-bold bg-[#f2f2f2]">Max Gain</td>
                    <td className="text-[#006100]">{STRATEGY_INFO[selectedStrategy].gain}</td>
                  </tr>
                  <tr>
                    <td className="font-bold bg-[#f2f2f2]">Max Loss</td>
                    <td className="text-[#ff0000]">{STRATEGY_INFO[selectedStrategy].loss}</td>
                  </tr>
                  <tr>
                    <td className="font-bold bg-[#f2f2f2]">Time Decay</td>
                    <td>{STRATEGY_INFO[selectedStrategy].timeDecay}</td>
                  </tr>
                  <tr>
                    <td className="font-bold bg-[#f2f2f2]">Volatility</td>
                    <td>{STRATEGY_INFO[selectedStrategy].volatility}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
