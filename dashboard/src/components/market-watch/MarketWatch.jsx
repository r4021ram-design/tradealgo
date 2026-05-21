import React, { useMemo, useRef, useState, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useTerminalStore } from '../../store/useTerminalStore';
import { Search } from 'lucide-react';

function fmtOI(val) {
  if (!val && val !== 0) return '-';
  if (Math.abs(val) >= 10000000) return (val / 10000000).toFixed(2) + ' Cr';
  if (Math.abs(val) >= 100000) return (val / 100000).toFixed(2) + ' L';
  if (Math.abs(val) >= 1000) return (val / 1000).toFixed(1) + 'K';
  return val.toLocaleString();
}

export const MarketWatch = () => {
  const gridRef = useRef();
  const marketWatch = useTerminalStore(state => state.marketWatch);
  const [filterText, setFilterText] = useState('');

  // Define column definitions
  const columnDefs = useMemo(() => [
    { field: 'symbol', headerName: 'Symbol', width: 180, pinned: 'left' },
    { field: 'bidQty', headerName: 'Bid Q', width: 70, type: 'numericColumn' },
    { field: 'bidPrice', headerName: 'Bid', width: 80, type: 'numericColumn', valueFormatter: p => p.value.toFixed(2) },
    { field: 'askPrice', headerName: 'Ask', width: 80, type: 'numericColumn', valueFormatter: p => p.value.toFixed(2) },
    { field: 'askQty', headerName: 'Ask Q', width: 70, type: 'numericColumn' },
    { 
      field: 'ltp', 
      headerName: 'LTP', 
      width: 90, 
      type: 'numericColumn',
      valueFormatter: p => p.value.toFixed(2),
      cellClassRules: {
        'flash-up': params => params.data.tickDirection === 1,
        'flash-down': params => params.data.tickDirection === -1,
      }
    },
    { 
      field: 'change', 
      headerName: '% Chg', 
      width: 80, 
      type: 'numericColumn',
      valueFormatter: p => p.value.toFixed(2) + '%',
      cellStyle: params => ({ color: params.value > 0 ? '#008800' : params.value < 0 ? '#cc0000' : '#555' })
    },
    { field: 'volume', headerName: 'Vol', width: 90, type: 'numericColumn', valueFormatter: p => p.value ? fmtOI(p.value) : '-' },
    { 
      field: 'oi', 
      headerName: 'OI', 
      width: 90, 
      type: 'numericColumn', 
      valueFormatter: p => p.value ? fmtOI(p.value) : '-' 
    },
    { 
      field: 'oiChange', 
      headerName: 'OI Chg', 
      width: 90, 
      type: 'numericColumn', 
      valueFormatter: p => p.value ? (p.value > 0 ? '+' : '') + fmtOI(p.value) : '-',
      cellStyle: params => ({ color: params.value > 0 ? '#008800' : params.value < 0 ? '#cc0000' : '#555' })
    },
    { field: 'iv', headerName: 'IV', width: 70, type: 'numericColumn', valueFormatter: p => p.value ? p.value.toFixed(2) + '%' : '-' },
    { field: 'delta', headerName: 'Delta', width: 70, type: 'numericColumn', valueFormatter: p => p.value ? p.value.toFixed(2) : '-' },
    { field: 'gamma', headerName: 'Gamma', width: 80, type: 'numericColumn', valueFormatter: p => p.value ? p.value.toFixed(4) : '-' },
    { 
      field: 'theta', 
      headerName: 'Theta', 
      width: 70, 
      type: 'numericColumn', 
      valueFormatter: p => p.value ? p.value.toFixed(2) : '-',
      cellStyle: params => ({ color: params.value < 0 ? '#cc0000' : params.value > 0 ? '#008800' : '#555' })
    },
    { field: 'vega', headerName: 'Vega', width: 70, type: 'numericColumn', valueFormatter: p => p.value ? p.value.toFixed(2) : '-' }
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    suppressMovable: true,
  }), []);

  // Use the grid API to trigger redraw for flashing cells if tickDirection changes
  useEffect(() => {
    if (gridRef.current && gridRef.current.api) {
      setTimeout(() => {
        gridRef.current.api.refreshCells({ force: true, columns: ['ltp'] });
      }, 0);
    }
  }, [marketWatch]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Search Bar */}
      <div className="flex items-center bg-finance-panel border-b border-[#ccc] px-2 py-1">
        <Search size={14} className="text-[#555] mr-2" />
        <input 
          type="text" 
          placeholder="Search e.g. NIFTY 24 APR 22000 CE" 
          className="bg-transparent text-sm w-full outline-none text-black placeholder-[#888] py-1 uppercase"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          style={{ fontFamily: 'Calibri, Arial, sans-serif' }}
        />
      </div>

      {/* AG Grid */}
      <div className="flex-1 ag-theme-alpine">
        <AgGridReact
          ref={gridRef}
          rowData={marketWatch}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          headerHeight={28}
          rowHeight={24}
          suppressCellFocus={true}
          quickFilterText={filterText}
          animateRows={false} 
        />
      </div>
    </div>
  );
};
