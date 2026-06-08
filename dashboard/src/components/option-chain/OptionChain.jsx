import React, { useEffect, useRef, useMemo, useState } from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { useOptionChainData } from '../../hooks/useOptionChainData';
import { calculateIVAndGreeks, impliedVolatility, calculateBlackScholes } from '../../utils/blackScholes';
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

// CE sub-columns: OI Chg | OI | Vol | IV | Δ | θ | ν | LTP | Chg% | Bid Q | Bid | Ask | Ask Q
const CE_COLS = ['oiChange', 'oi', 'volume', 'iv', 'delta', 'theta', 'vega', 'ltp', 'changePct', 'bidQty', 'bidPrice', 'askPrice', 'askQty'];
const CE_LABELS = ['OI Chg', 'OI', 'Vol', 'IV', 'Δ', 'θ', 'ν', 'LTP', 'Chg%', 'Bid Q', 'Bid', 'Ask', 'Ask Q'];
// PE sub-columns mirror: Ask Q | Ask | Bid | Bid Q | Chg% | LTP | ν | θ | Δ | IV | Vol | OI | OI Chg
const PE_COLS = ['askQty', 'askPrice', 'bidPrice', 'bidQty', 'changePct', 'ltp', 'vega', 'theta', 'delta', 'iv', 'volume', 'oi', 'oiChange'];
const PE_LABELS = ['Ask Q', 'Ask', 'Bid', 'Bid Q', 'Chg%', 'LTP', 'ν', 'θ', 'Δ', 'IV', 'Vol', 'OI', 'OI Chg'];

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
  const lastScrolledKey = useRef('');
  const [showGreeks, setShowGreeks] = useState(true);
  const [showFullChain, setShowFullChain] = useState(false);

  // Greeks columns to toggle
  const greeksCols = ['iv', 'delta', 'theta', 'vega'];
  
  const activeCeCols = useMemo(() => showGreeks ? CE_COLS : CE_COLS.filter(c => !greeksCols.includes(c)), [showGreeks]);
  const activeCeLabels = useMemo(() => showGreeks ? CE_LABELS : CE_LABELS.filter((_, i) => !greeksCols.includes(CE_COLS[i])), [showGreeks]);
  const activePeCols = useMemo(() => showGreeks ? PE_COLS : PE_COLS.filter(c => !greeksCols.includes(c)), [showGreeks]);
  const activePeLabels = useMemo(() => showGreeks ? PE_LABELS : PE_LABELS.filter((_, i) => !greeksCols.includes(PE_COLS[i])), [showGreeks]);

  const handleTradeClick = (e, type, row, optType, price) => {
    e.stopPropagation();
    if (!selectedExpiry) {
      alert('Please select a valid expiry date first.');
      return;
    }
    // Use the real trading symbol from the API response (resolved from contracts.db)
    const symbol = optType === 'CE' ? row.ce_symbol : row.pe_symbol;
    const token = optType === 'CE' ? row.ce_token : row.pe_token;
    openOrderModal(type, symbol, price, {
      token,
      exchangeSegment: row.exchangeSegment || 'nse_fo',
      expiry: selectedExpiry,
      lotSize: row.lot_size || 0,
    });
  };

  const atmIndex = useMemo(() => {
    const idx = optionChain.findIndex(r => r.isATM);
    if (idx !== -1) return idx;
    if (!spotPrice || !optionChain.length) return -1;
    let closestIdx = 0;
    let minDiff = Math.abs(optionChain[0].strike - spotPrice);
    for (let i = 1; i < optionChain.length; i++) {
      const diff = Math.abs(optionChain[i].strike - spotPrice);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    return closestIdx;
  }, [optionChain, spotPrice]);

  // Calculate DTE (Days to Expiry) from selected expiry
  const daysToExpiry = useMemo(() => {
    if (!selectedExpiry) return 5;
    try {
      const parts = selectedExpiry.split('-');
      if (parts.length === 3) {
        const expiryDate = new Date(selectedExpiry);
        if (!isNaN(expiryDate.getTime())) {
          // Set expiry time to 15:30 IST
          expiryDate.setHours(15, 30, 0, 0);
          const now = new Date();
          const diffMs = expiryDate - now;
          return Math.max(0.01, diffMs / (1000 * 60 * 60 * 24));
        }
      }
      // Try dd-MMM-yyyy format (e.g., "02-Jun-2026")
      const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
      const [day, mon, year] = parts;
      const monthIdx = months[mon];
      if (monthIdx !== undefined) {
        const expiryDate = new Date(parseInt(year), monthIdx, parseInt(day), 15, 30, 0);
        const now = new Date();
        const diffMs = expiryDate - now;
        return Math.max(0.01, diffMs / (1000 * 60 * 60 * 24));
      }
    } catch (e) {
      console.warn('[OptionChain] Failed to parse expiry for DTE:', selectedExpiry);
    }
    return 5;
  }, [selectedExpiry]);

  const visibleChain = useMemo(() => {
    let chain = optionChain || [];
    if (!showFullChain && atmIndex !== -1) {
      const start = Math.max(0, atmIndex - 20);
      const end = Math.min(chain.length, atmIndex + 21);
      chain = chain.slice(start, end);
    }

    const defaultSideData = {
      ltp: 0,
      oi: 0,
      oiChange: 0,
      iv: 0,
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      bidPrice: 0,
      bidQty: 0,
      askPrice: 0,
      askQty: 0,
      volume: 0,
      tickDirection: 0,
      changePct: 0
    };

    return chain.map(row => {
      if (!row) return row;
      let ce = row.ce ? { ...defaultSideData, ...row.ce } : { ...defaultSideData };
      let pe = row.pe ? { ...defaultSideData, ...row.pe } : { ...defaultSideData };

      if (!spotPrice || !showGreeks) {
        return { ...row, ce, pe };
      }

      const ceMid = (ce.bidPrice > 0 && ce.askPrice > 0) ? (ce.bidPrice + ce.askPrice) / 2 : ce.ltp;
      const peMid = (pe.bidPrice > 0 && pe.askPrice > 0) ? (pe.bidPrice + pe.askPrice) / 2 : pe.ltp;

      const T = daysToExpiry / 365.25;

      // 1. Resolve IVs for CE and PE using OTM mirroring logic for deep ITM options
      let ceIV = ce.iv ? ce.iv / 100 : 0;
      let peIV = pe.iv ? pe.iv / 100 : 0;

      if (row.strike < spotPrice) {
        // CE is ITM, PE is OTM. Calculate PE first (stable OTM side)
        if (peMid > 0 && peIV === 0) {
          peIV = impliedVolatility('PE', spotPrice, row.strike, T, 0.0525, peMid);
        }
        // Mirror PE IV to CE IV
        if (peIV > 0.001) {
          ceIV = peIV;
        }
      } else {
        // CE is OTM, PE is ITM. Calculate CE first (stable OTM side)
        if (ceMid > 0 && ceIV === 0) {
          ceIV = impliedVolatility('CE', spotPrice, row.strike, T, 0.0525, ceMid);
        }
        // Mirror CE IV to PE IV
        if (ceIV > 0.001) {
          peIV = ceIV;
        }
      }

      // Direct calculation fallback if mirroring did not resolve
      if (ceMid > 0 && ceIV === 0) {
        ceIV = impliedVolatility('CE', spotPrice, row.strike, T, 0.0525, ceMid);
      }
      if (peMid > 0 && peIV === 0) {
        peIV = impliedVolatility('PE', spotPrice, row.strike, T, 0.0525, peMid);
      }

      // 2. Compute Greeks using the resolved implied volatilities
      if (ceIV > 0.001) {
        const g = calculateBlackScholes('CE', spotPrice, row.strike, T, 0.0525, ceIV);
        ce = {
          ...ce,
          iv: +(ceIV * 100).toFixed(2),
          delta: +g.delta.toFixed(4),
          gamma: +g.gamma.toFixed(6),
          theta: +g.theta.toFixed(2),
          vega: +g.vega.toFixed(2)
        };
      }
      if (peIV > 0.001) {
        const g = calculateBlackScholes('PE', spotPrice, row.strike, T, 0.0525, peIV);
        pe = {
          ...pe,
          iv: +(peIV * 100).toFixed(2),
          delta: +g.delta.toFixed(4),
          gamma: +g.gamma.toFixed(6),
          theta: +g.theta.toFixed(2),
          vega: +g.vega.toFixed(2)
        };
      }

      return { ...row, ce, pe };
    });
  }, [optionChain, showFullChain, atmIndex, spotPrice, showGreeks, daysToExpiry]);

  // Auto-scroll to ATM when underlying, expiry, or ATM strike changes
  useEffect(() => {
    if (!optionChain.length || !selectedUnderlying || !selectedExpiry) return;
    
    // Find the ATM row strike
    const atm = optionChain.find(r => r.isATM);
    const atmStrikeVal = atm ? atm.strike : null;
    if (!atmStrikeVal) return;

    const key = `${selectedUnderlying}-${selectedExpiry}-${atmStrikeVal}`;
    if (lastScrolledKey.current === key) return;

    const timer = setTimeout(() => {
      const atmEl = document.querySelector('.oc-atm-row');
      if (atmEl && tableRef.current) {
        const container = tableRef.current;
        const containerRect = container.getBoundingClientRect();
        const atmRect = atmEl.getBoundingClientRect();
        
        // Calculate relative top of ATM row within the container's scroll height
        const relativeTop = atmRect.top - containerRect.top + container.scrollTop;
        
        // Center the ATM row in the container
        container.scrollTop = relativeTop - container.clientHeight / 2 + (atmRect.height / 2);
        
        lastScrolledKey.current = key;
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [optionChain, selectedUnderlying, selectedExpiry]);

  // Totals
  const totals = useMemo(() => {
    let ceOiTotal = 0, peOiTotal = 0, ceVolTotal = 0, peVolTotal = 0;
    let maxCeOi = 0, maxPeOi = 0;
    let maxCeOiChg = 0, maxPeOiChg = 0;
    let maxCeVol = 0, maxPeVol = 0;
    let pcr = 0;

    const defaultSideData = {
      ltp: 0,
      oi: 0,
      oiChange: 0,
      iv: 0,
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      bidPrice: 0,
      bidQty: 0,
      askPrice: 0,
      askQty: 0,
      volume: 0,
      tickDirection: 0,
      changePct: 0
    };

    (optionChain || []).forEach(r => {
      if (!r) return;
      const ce = r.ce ? { ...defaultSideData, ...r.ce } : { ...defaultSideData };
      const pe = r.pe ? { ...defaultSideData, ...r.pe } : { ...defaultSideData };

      ceOiTotal += ce.oi || 0;
      peOiTotal += pe.oi || 0;
      ceVolTotal += ce.volume || 0;
      peVolTotal += pe.volume || 0;
      if (ce.oi > maxCeOi) maxCeOi = ce.oi;
      if (pe.oi > maxPeOi) maxPeOi = pe.oi;
      if (ce.oiChange > maxCeOiChg) maxCeOiChg = ce.oiChange;
      if (pe.oiChange > maxPeOiChg) maxPeOiChg = pe.oiChange;
      if (ce.volume > maxCeVol) maxCeVol = ce.volume;
      if (pe.volume > maxPeVol) maxPeVol = pe.volume;
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

          <button
            onClick={() => setShowFullChain(prev => !prev)}
            className={`oc-btn-show-full ${showFullChain ? 'active' : ''}`}
            style={{
              padding: '3px 8px',
              fontSize: '11px',
              fontWeight: 'bold',
              cursor: 'pointer',
              border: '1px solid #ccc',
              borderRadius: '2px',
              background: showFullChain ? '#e6e6e6' : '#fff',
              color: '#333',
              marginLeft: '8px',
              fontFamily: 'Calibri, Arial, sans-serif',
              transition: 'all 0.2s ease'
            }}
          >
            {showFullChain ? 'Show Filtered (ATM ± 20)' : 'Show Full Chain'}
          </button>
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
            {visibleChain.map(row => {
              const lotSize = row.lot_size || getLotSize(selectedUnderlying) || 1;
              return (
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
                        (['iv', 'delta', 'theta', 'vega'].includes(col) ? ' oc-greek' : '') +
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
                            <button className="oc-btn-buy" onClick={(e) => handleTradeClick(e, 'BUY', row, 'CE', row.ce[col])}>B</button>
                            <button className="oc-btn-sell" onClick={(e) => handleTradeClick(e, 'SELL', row, 'CE', row.ce[col])}>S</button>
                          </div>
                        </div>
                      ) :
                       col === 'oiChange' ? ((row.ce.oiChange > 0 ? '+' : '') + fmtOI(row.ce.oiChange)) :
                       col === 'volume' ? fmtVol(row.ce.volume) :
                       col === 'iv' ? fmtNum(row.ce.iv, 2) + '%' :
                       col === 'delta' ? fmtNum(row.ce.delta, 4) :
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
                        (['iv', 'delta', 'theta', 'vega'].includes(col) ? ' oc-greek' : '') +
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
                            <button className="oc-btn-buy" onClick={(e) => handleTradeClick(e, 'BUY', row, 'PE', row.pe[col])}>B</button>
                            <button className="oc-btn-sell" onClick={(e) => handleTradeClick(e, 'SELL', row, 'PE', row.pe[col])}>S</button>
                          </div>
                        </div>
                      ) :
                       col === 'oiChange' ? ((row.pe.oiChange > 0 ? '+' : '') + fmtOI(row.pe.oiChange)) :
                       col === 'volume' ? fmtVol(row.pe.volume) :
                       col === 'iv' ? fmtNum(row.pe.iv, 2) + '%' :
                       col === 'delta' ? fmtNum(row.pe.delta, 4) :
                       col === 'theta' ? fmtNum(row.pe.theta, 2) :
                       col === 'vega' ? fmtNum(row.pe.vega, 2) :
                       col === 'changePct' ? ((row.pe.changePct > 0 ? '+' : '') + fmtNum(row.pe.changePct, 2) + '%') :
                       col === 'bidQty' || col === 'askQty' ? (row.pe[col]?.toLocaleString() || '-') :
                       '-'}
                    </td>
                  );
                })}
              </tr>
            )})}
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
