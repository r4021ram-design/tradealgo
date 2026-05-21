import React, { useEffect, useRef } from 'react';

// Formatter for currency
const formatCurrency = (val) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);

const PositionRow = ({ pos }) => {
  const rowRef = useRef(null);

  // Trigger flash animation when LTP changes
  useEffect(() => {
    if (!rowRef.current || !pos.previousLtp) return;
    
    // Remove existing classes to re-trigger animation
    rowRef.current.classList.remove('flash-up', 'flash-down');
    
    // Force a reflow to ensure the animation restarts
    void rowRef.current.offsetWidth;
    
    if (pos.ltp > pos.previousLtp) {
      rowRef.current.classList.add('flash-up');
    } else if (pos.ltp < pos.previousLtp) {
      rowRef.current.classList.add('flash-down');
    }
  }, [pos.ltp]);

  const pnlClass = pos.pnl > 0 ? 'value-positive' : pos.pnl < 0 ? 'value-negative' : '';
  const statusClass = pos.status === 'OPEN' ? 'status-open' : 'status-closed';

  return (
    <tr ref={rowRef}>
      <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{pos.symbol}</td>
      <td>{pos.entry.toFixed(2)}</td>
      <td>{pos.ltp.toFixed(2)}</td>
      <td className={pnlClass}>{formatCurrency(pos.pnl)}</td>
      <td>{pos.sl.toFixed(2)}</td>
      <td>{pos.qty}</td>
      <td>
        <span className={`status-badge ${statusClass}`}>
          {pos.status}
        </span>
      </td>
    </tr>
  );
};

export function PositionsGrid({ positions }) {
  return (
    <div className="positions-section">
      <div className="section-title">Active Positions</div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Entry</th>
              <th>LTP</th>
              <th>PnL</th>
              <th>Stop Loss</th>
              <th>Qty</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {positions.map(pos => (
              <PositionRow key={pos.id} pos={pos} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
