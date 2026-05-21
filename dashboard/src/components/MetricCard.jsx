import React from 'react';

export function MetricCard({ label, value, isCurrency = false, colorize = false }) {
  const formattedValue = isCurrency 
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value)
    : value;

  let valueClass = 'metric-value';
  if (colorize) {
    if (value > 0) valueClass += ' value-positive';
    else if (value < 0) valueClass += ' value-negative';
  }

  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={valueClass}>{formattedValue}</div>
    </div>
  );
}
