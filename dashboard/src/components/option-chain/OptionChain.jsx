import React, { useEffect, useRef, useMemo, useState } from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { useOptionChainData } from '../../hooks/useOptionChainData';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import './OptionChain.css';

// Format large numbers to lakhs (L) / crores (Cr)
function fmtOI(val) {
  if (!val && val !== 0) return '-';
  if (Math.abs(val) >= 10000000) return (val / 10000000).toFixed(2) + ' Cr';
  if (Math.abs(val) >= 100000) return (val / 100000).toFixed(2) + ' L';
  if (Math.abs(val) >= 1000) return (val / 1000).toFixed(1) + ' K';
  return val.toLocaleString();
}

function fmtVol(val) {
  if (!val && val !== 0) return '-';
  if (val >= 10000000) return (val / 10000000).toFixed(1) + 'Cr';
  if (val >= 100000) return (val / 100000).toFixed(1) + 'L';
  if (val >= 1000) return (val / 1000).toFixed(0) + 'K';
  return val;
}

function fmtNum(val, decimals = 2) {
  if (val === null || val === undefined) return '-';
  return Number(val).toFixed(decimals);
}

// CE sub-columns: OI Chg | OI | Vol | IV | Δ | Γ | θ | ν | BidQ | Bid | Ask | AskQ | LTP | Chg%
const CE_COLS = ['oiChange', 'oi', 'volume', 'iv', 'delta', 'gamma', 'theta', 'vega', 'bidQty', 'bidPrice', 'askPrice', 'askQty', 'ltp', 'changePct'];
const CE_LABELS = ['OI Chg', 'OI', 'Vol', 'IV', 'Δ', 'Γ', 'θ', 'ν', 'Bid Q', 'Bid', 'Ask', 'Ask Q', 'LTP', 'Chg%'];
// PE sub-columns mirror: Chg% | LTP | BidQ | Bid | Ask | AskQ | ν | θ | Γ | Δ | IV | Vol | OI | OI Chg
const PE_COLS = ['changePct', 'ltp', 'bidQty', 'bidPrice', 'askPrice', 'askQty', 'vega', 'theta', 'gamma', 'delta', 'iv', 'volume', 'oi', 'oiChange'];
const PE_LABELS = ['Chg%', 'LTP', 'Bid Q', 'Bid', 'Ask', 'Ask Q', 'ν', 'θ', 'Γ', 'Δ', 'IV', 'Vol', 'OI', 'OI Chg'];

function CellValue({ col, data, side }) {
  const val = data[col];
  let display, className = '';

  switch (col) {
    case 'oi':
      display = fmtOI(val);
      break;
    case 'oiChange':
      display = (val > 0 ? '+' : '') + fmtOI(val);
      className = val > 0 ? 'oc-oi-pos' : val < 0 ? 'oc-oi-neg' : 'oc-muted';
      break;
    case 'volume':
      display = fmtVol(val);
      break;
    case 'iv':
      display = fmtNum(val, 2) + '%';
      className = 'oc-greek';
      break;
    case 'delta':
      display = fmtNum(val, 4);
      className = 'oc-greek';
      break;
    case 'gamma':
      display = fmtNum(val, 5);
      className = 'oc-greek';
      break;
    case 'theta':
      display = fmtNum(val, 2);
      className = val < 0 ? 'oc-red oc-greek' : 'oc-green oc-greek';
      break;
    case 'vega':
      display = fmtNum(val, 2);
      className = 'oc-greek';
      break;
    case 'ltp':
      display = fmtNum(val, 2);
      className = 'oc-ltp' + (data.tickDirection === 1 ? ' flash-up' : data.tickDirection === -1 ? ' flash-down' : '');
      break;
    case 'changePct':
      display = (val > 0 ? '+' : '') + fmtNum(val, 2) + '%';
      className = 'oc-chg ' + (val > 0 ? 'oc-green' : val < 0 ? 'oc-red' : 'oc-muted');
      break;
    case 'bidPrice':
    case 'askPrice':
      display = fmtNum(val, 2);
      break;
    case 'bidQty':
    case 'askQty':
      display = val?.toLocaleString() || '-';
      break;
    default:
      display = val?.toString() || '-';
  }

  return <td className={className}>{display}</td>;
}

export const OptionChain = () => {
  useOptionChainData();

  const optionChain = useTerminalStore(s => s.optionChain);
  const spotPrice = useTerminalStore(s => s.spotPrice);
  const selectedUnderlying = useTerminalStore(s => s.selectedUnderlying);
  const selectedExpiry = useTerminalStore(s => s.selectedExpiry);
  const availableExpiries = useTerminalStore(s => s.availableExpiries);
  const availableUnderlyings = useTerminalStore(s => s.availableUnderlyings);
  const setUnderlying = useTerminalStore(s => s.setUnderlying);
  const setExpiry = useTerminalStore(s => s.setExpiry);
  const openOrderModal = useTerminalStore(s => s.openOrderModal);

  const tableRef = useRef(null);
  const scrolledRef = useRef(false);
  const [showGreeks, setShowGreeks] = useState(true);

  // Greeks columns to toggle
  const greeksCols = ['iv', 'delta', 'gamma', 'theta', 'vega'];
  
  const activeCeCols = useMemo(() => showGreeks ? CE_COLS : CE_COLS.filter(c => !greeksCols.includes(c)), [showGreeks]);
  const activeCeLabels = useMemo(() => showGreeks ? CE_LABELS : CE_LABELS.filter((_, i) => !greeksCols.includes(CE_COLS[i])), [showGreeks]);
  const activePeCols = useMemo(() => showGreeks ? PE_COLS : PE_COLS.filter(c => !greeksCols.includes(c)), [showGreeks]);
  const activePeLabels = useMemo(() => showGreeks ? PE_LABELS : PE_LABELS.filter((_, i) => !greeksCols.includes(PE_COLS[i])), [showGreeks]);

  const handleTradeClick = (e, type, strike, optType, price) => {
    e.stopPropagation();
    const expiryShort = selectedExpiry.split(' ').slice(0, 2).join(' ').toUpperCase();
    const symbol = `${selectedUnderlying} ${expiryShort} ${strike} ${optType}`;
    openOrderModal(type, symbol, price);
  };

  // Auto-scroll to ATM on first load
  useEffect(() => {
    if (scrolledRef.current || !optionChain.length) return;
    const timer = setTimeout(() => {
      const atmEl = document.querySelector('.oc-atm-row');
      if (atmEl && tableRef.current) {
        const container = tableRef.current;
        const rowTop = atmEl.offsetTop;
        const containerH = container.clientHeight;
        container.scrollTop = rowTop - containerH / 2 + 20;
        scrolledRef.current = true;
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [optionChain]);

  // Reset scroll flag on underlying change
  useEffect(() => {
    scrolledRef.current = false;
  }, [selectedUnderlying]);

  // Totals
  const totals = useMemo(() => {
    let ceOiTotal = 0, peOiTotal = 0, ceVolTotal = 0, peVolTotal = 0;
    let maxCeOi = 0, maxPeOi = 0;
    let maxCeOiChg = 0, maxPeOiChg = 0;
    let maxCeVol = 0, maxPeVol = 0;
    let pcr = 0;
    optionChain.forEach(r => {
      ceOiTotal += r.ce.oi || 0;
      peOiTotal += r.pe.oi || 0;
      ceVolTotal += r.ce.volume || 0;
      peVolTotal += r.pe.volume || 0;
      if (r.ce.oi > maxCeOi) maxCeOi = r.ce.oi;
      if (r.pe.oi > maxPeOi) maxPeOi = r.pe.oi;
      if (r.ce.oiChange > maxCeOiChg) maxCeOiChg = r.ce.oiChange;
      if (r.pe.oiChange > maxPeOiChg) maxPeOiChg = r.pe.oiChange;
      if (r.ce.volume > maxCeVol) maxCeVol = r.ce.volume;
      if (r.pe.volume > maxPeVol) maxPeVol = r.pe.volume;
    });
    pcr = ceOiTotal > 0 ? peOiTotal / ceOiTotal : 0;
    return { ceOiTotal, peOiTotal, ceVolTotal, peVolTotal, pcr, maxCeOi, maxPeOi, maxCeOiChg, maxPeOiChg, maxCeVol, maxPeVol };
  }, [optionChain]);

  const atmStrike = useMemo(() => {
    const atm = optionChain.find(r => r.isATM);
    return atm ? atm.strike : null;
  }, [optionChain]);

  return (
    <div className="oc-container">
      {/* Header */}
      <div className="oc-header">
        <div className="oc-header-left">
          <select
            className="oc-select"
            value={selectedUnderlying}
            onChange={e => setUnderlying(e.target.value)}
          >
            {availableUnderlyings.map(und => (
              <option key={und} value={und}>{und}</option>
            ))}
          </select>

          <select
            className="oc-select"
            value={selectedExpiry}
            onChange={e => setExpiry(e.target.value)}
          >
            {availableExpiries.map(exp => (
              <option key={exp} value={exp}>{exp}</option>
            ))}
          </select>

          <div className="oc-spot-badge">
            <Activity size={12} />
            <span>SPOT:</span>
            <span className="spot-value">{spotPrice?.toFixed(2)}</span>
          </div>

          {atmStrike && (
            <div className="oc-atm-badge">ATM: {atmStrike}</div>
          )}
        </div>

        <div className="oc-header-right">
          <div className="oc-greeks-toggle">
            <span className="oc-toggle-label">Greeks</span>
            <label className="oc-toggle-switch">
              <input 
                type="checkbox" 
                checked={showGreeks} 
                onChange={(e) => setShowGreeks(e.target.checked)} 
              />
              <span className="oc-toggle-slider"></span>
            </label>
          </div>
          <span style={{ color: '#666', marginLeft: '8px' }}>PCR:</span>
          <span style={{ color: totals.pcr > 1 ? '#008800' : '#cc0000', fontWeight: 700 }}>
            {totals.pcr.toFixed(2)}
          </span>
          <span style={{ color: '#ccc' }}>|</span>
          <span style={{ color: '#666' }}>CE OI:</span>
          <span style={{ color: '#000', fontWeight: 'bold' }}>{fmtOI(totals.ceOiTotal)}</span>
          <span style={{ color: '#666' }}>PE OI:</span>
          <span style={{ color: '#000', fontWeight: 'bold' }}>{fmtOI(totals.peOiTotal)}</span>
        </div>
      </div>

      {/* Table */}
      <div className="oc-table-wrap" ref={tableRef}>
        <table className="oc-table">
          <thead>
            {/* Main header */}
            <tr className="oc-header-row-main">
              <th colSpan={activeCeCols.length} className="oc-th-calls">
                <TrendingUp size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                CALLS (CE)
              </th>
              <th className="oc-th-strike">STRIKE</th>
              <th colSpan={activePeCols.length} className="oc-th-puts">
                PUTS (PE)
                <TrendingDown size={14} style={{ display: 'inline', marginLeft: 6, verticalAlign: 'middle' }} />
              </th>
            </tr>
            {/* Sub header */}
            <tr className="oc-header-row-sub">
              {activeCeLabels.map((label, i) => (
                <th key={'ce-' + i}>{label}</th>
              ))}
              <th className="oc-th-strike-sub">STRIKE</th>
              {activePeLabels.map((label, i) => (
                <th key={'pe-' + i}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {optionChain.map(row => (
              <tr
                key={row.strike}
                className={row.isATM ? 'oc-atm-row' : ''}
              >
                {/* CE side */}
                {activeCeCols.map((col, i) => {
                  const itmClass = row.isITM_CE ? ' oc-itm-ce' : '';
                  const isMaxOi = col === 'oi' && row.ce.oi > 0 && row.ce.oi === totals.maxCeOi;
                  const isMaxOiChg = col === 'oiChange' && row.ce.oiChange > 0 && row.ce.oiChange === totals.maxCeOiChg;
                  const isMaxVol = col === 'volume' && row.ce.volume > 0 && row.ce.volume === totals.maxCeVol;
                  return (
                    <td
                      key={'ce-' + i}
                      className={
                        (col === 'ltp' ? ('oc-ltp' + (row.ce.tickDirection === 1 ? ' oc-flash-up' : row.ce.tickDirection === -1 ? ' oc-flash-down' : '')) : '') +
                        (col === 'changePct' ? (' oc-chg ' + (row.ce.changePct > 0 ? 'oc-green' : row.ce.changePct < 0 ? 'oc-red' : 'oc-muted')) : '') +
                        (col === 'oiChange' ? (row.ce.oiChange > 0 ? ' oc-oi-pos' : row.ce.oiChange < 0 ? ' oc-oi-neg' : '') : '') +
                        (col === 'theta' ? (row.ce.theta < 0 ? ' oc-red' : ' oc-green') : '') +
                        (['iv', 'delta', 'gamma', 'theta', 'vega'].includes(col) ? ' oc-greek' : '') +
                        (isMaxOi ? ' oc-highlight-ce' : '') +
                        (isMaxOiChg ? ' oc-highlight-ce-subtle' : '') +
                        (isMaxVol ? ' oc-highlight-vol' : '') +
                        itmClass
                      }
                    >
                      {col === 'oi' ? (
                        <div className="oc-oi-bar-wrap">
                          <div className="oc-oi-bar ce-oi-bar" style={{ width: totals.maxCeOi ? `${(row.ce.oi / totals.maxCeOi) * 100}%` : '0%' }}></div>
                          <span className="oc-oi-val">{fmtOI(row.ce.oi)}</span>
                        </div>
                      ) : ['bidPrice', 'askPrice', 'ltp'].includes(col) ? (
                        <div className="oc-trade-cell">
                          <span className="oc-trade-val">{fmtNum(row.ce[col], 2)}</span>
                          <div className="oc-trade-btns">
                            <button className="oc-btn-buy" onClick={(e) => handleTradeClick(e, 'BUY', row.strike, 'CE', row.ce[col])}>B</button>
                            <button className="oc-btn-sell" onClick={(e) => handleTradeClick(e, 'SELL', row.strike, 'CE', row.ce[col])}>S</button>
                          </div>
                        </div>
                      ) :
                       col === 'oiChange' ? ((row.ce.oiChange > 0 ? '+' : '') + fmtOI(row.ce.oiChange)) :
                       col === 'volume' ? fmtVol(row.ce.volume) :
                       col === 'iv' ? fmtNum(row.ce.iv, 2) + '%' :
                       col === 'delta' ? fmtNum(row.ce.delta, 4) :
                       col === 'gamma' ? fmtNum(row.ce.gamma, 5) :
                       col === 'theta' ? fmtNum(row.ce.theta, 2) :
                       col === 'vega' ? fmtNum(row.ce.vega, 2) :
                       col === 'changePct' ? ((row.ce.changePct > 0 ? '+' : '') + fmtNum(row.ce.changePct, 2) + '%') :
                       col === 'bidQty' || col === 'askQty' ? (row.ce[col]?.toLocaleString() || '-') :
                       '-'}
                    </td>
                  );
                })}

                {/* Strike */}
                <td className="oc-strike">{row.strike}</td>

                {/* PE side */}
                {activePeCols.map((col, i) => {
                  const itmClass = row.isITM_PE ? ' oc-itm-pe' : '';
                  const isMaxOi = col === 'oi' && row.pe.oi > 0 && row.pe.oi === totals.maxPeOi;
                  const isMaxOiChg = col === 'oiChange' && row.pe.oiChange > 0 && row.pe.oiChange === totals.maxPeOiChg;
                  const isMaxVol = col === 'volume' && row.pe.volume > 0 && row.pe.volume === totals.maxPeVol;
                  return (
                    <td
                      key={'pe-' + i}
                      className={
                        (col === 'ltp' ? ('oc-ltp' + (row.pe.tickDirection === 1 ? ' oc-flash-up' : row.pe.tickDirection === -1 ? ' oc-flash-down' : '')) : '') +
                        (col === 'changePct' ? (' oc-chg ' + (row.pe.changePct > 0 ? 'oc-green' : row.pe.changePct < 0 ? 'oc-red' : 'oc-muted')) : '') +
                        (col === 'oiChange' ? (row.pe.oiChange > 0 ? ' oc-oi-pos' : row.pe.oiChange < 0 ? ' oc-oi-neg' : '') : '') +
                        (col === 'theta' ? (row.pe.theta < 0 ? ' oc-red' : ' oc-green') : '') +
                        (['iv', 'delta', 'gamma', 'theta', 'vega'].includes(col) ? ' oc-greek' : '') +
                        (isMaxOi ? ' oc-highlight-pe' : '') +
                        (isMaxOiChg ? ' oc-highlight-pe-subtle' : '') +
                        (isMaxVol ? ' oc-highlight-vol' : '') +
                        itmClass
                      }
                    >
                      {col === 'oi' ? (
                        <div className="oc-oi-bar-wrap">
                          <div className="oc-oi-bar pe-oi-bar" style={{ width: totals.maxPeOi ? `${(row.pe.oi / totals.maxPeOi) * 100}%` : '0%' }}></div>
                          <span className="oc-oi-val">{fmtOI(row.pe.oi)}</span>
                        </div>
                      ) : ['bidPrice', 'askPrice', 'ltp'].includes(col) ? (
                        <div className="oc-trade-cell">
                          <span className="oc-trade-val">{fmtNum(row.pe[col], 2)}</span>
                          <div className="oc-trade-btns">
                            <button className="oc-btn-buy" onClick={(e) => handleTradeClick(e, 'BUY', row.strike, 'PE', row.pe[col])}>B</button>
                            <button className="oc-btn-sell" onClick={(e) => handleTradeClick(e, 'SELL', row.strike, 'PE', row.pe[col])}>S</button>
                          </div>
                        </div>
                      ) :
                       col === 'oiChange' ? ((row.pe.oiChange > 0 ? '+' : '') + fmtOI(row.pe.oiChange)) :
                       col === 'volume' ? fmtVol(row.pe.volume) :
                       col === 'iv' ? fmtNum(row.pe.iv, 2) + '%' :
                       col === 'delta' ? fmtNum(row.pe.delta, 4) :
                       col === 'gamma' ? fmtNum(row.pe.gamma, 5) :
                       col === 'theta' ? fmtNum(row.pe.theta, 2) :
                       col === 'vega' ? fmtNum(row.pe.vega, 2) :
                       col === 'changePct' ? ((row.pe.changePct > 0 ? '+' : '') + fmtNum(row.pe.changePct, 2) + '%') :
                       col === 'bidQty' || col === 'askQty' ? (row.pe[col]?.toLocaleString() || '-') :
                       '-'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="oc-footer">
        <div className="oc-footer-stat">
          <span className="label">Total CE OI:</span>
          <span className="value oc-green">{fmtOI(totals.ceOiTotal)}</span>
          <span className="label" style={{ marginLeft: 12 }}>Total PE OI:</span>
          <span className="value oc-red">{fmtOI(totals.peOiTotal)}</span>
        </div>
        <div className="oc-footer-stat">
          <span className="label">CE Vol:</span>
          <span className="value">{fmtVol(totals.ceVolTotal)}</span>
          <span className="label" style={{ marginLeft: 12 }}>PE Vol:</span>
          <span className="value">{fmtVol(totals.peVolTotal)}</span>
        </div>
        <div className="oc-footer-stat">
          <span className="label">PCR (OI):</span>
          <span className="value" style={{ color: totals.pcr > 1 ? '#008800' : '#cc0000' }}>
            {totals.pcr.toFixed(3)}
          </span>
        </div>
      </div>
    </div>
  );
};
