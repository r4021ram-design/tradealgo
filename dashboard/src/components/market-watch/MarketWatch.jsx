import React, { useMemo, useRef, useState, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useTerminalStore } from '../../store/useTerminalStore';
import { Search, Plus, Trash2, X } from 'lucide-react';
import { getApiUrl } from '../../utils/api';

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
  const addSymbolToWatchlist = useTerminalStore(state => state.addSymbolToWatchlist);

  const [filterText, setFilterText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Debounce-fetch search query results from Kotak Neo contract master
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(getApiUrl(`/api/contracts/search?q=${encodeURIComponent(searchQuery)}`));
        if (response.ok) {
          const data = await response.json();
          // limit to top 15 results for premium UI rendering
          setSearchResults(data.slice(0, 15) || []);
          setShowDropdown(true);
        }
      } catch (err) {
        console.error('Failed to search contracts:', err);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Define column definitions
  const columnDefs = useMemo(() => [
    { field: 'symbol', headerName: 'Symbol', width: 220, pinned: 'left', cellStyle: { fontWeight: 'bold' } },
    { field: 'bidQty', headerName: 'Bid Q', width: 70, type: 'numericColumn' },
    { field: 'bidPrice', headerName: 'Bid', width: 100, type: 'numericColumn', valueFormatter: p => p.value ? p.value.toFixed(2) : '0.00' },
    { field: 'askPrice', headerName: 'Ask', width: 100, type: 'numericColumn', valueFormatter: p => p.value ? p.value.toFixed(2) : '0.00' },
    { field: 'askQty', headerName: 'Ask Q', width: 70, type: 'numericColumn' },
    { 
      field: 'ltp', 
      headerName: 'LTP', 
      width: 100, 
      type: 'numericColumn',
      valueFormatter: p => p.value ? p.value.toFixed(2) : '0.00',
      cellClassRules: {
        'flash-up': params => params.data.tickDirection === 1,
        'flash-down': params => params.data.tickDirection === -1,
      }
    },
    { 
      field: 'percent_change', 
      headerName: '% Chg', 
      width: 80, 
      type: 'numericColumn',
      valueFormatter: p => p.value ? p.value.toFixed(2) + '%' : '0.00%',
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
    { field: 'iv', headerName: 'IV', width: 85, type: 'numericColumn', valueFormatter: p => p.value ? p.value.toFixed(2) + '%' : '-' },
    { field: 'delta', headerName: 'Delta', width: 85, type: 'numericColumn', valueFormatter: p => p.value ? p.value.toFixed(2) : '-' },
    { field: 'gamma', headerName: 'Gamma', width: 90, type: 'numericColumn', valueFormatter: p => p.value ? p.value.toFixed(4) : '-' },
    { 
      field: 'theta', 
      headerName: 'Theta', 
      width: 85, 
      type: 'numericColumn', 
      valueFormatter: p => p.value ? p.value.toFixed(2) : '-',
      cellStyle: params => ({ color: params.value < 0 ? '#cc0000' : params.value > 0 ? '#008800' : '#555' })
    },
    { field: 'vega', headerName: 'Vega', width: 85, type: 'numericColumn', valueFormatter: p => p.value ? p.value.toFixed(2) : '-' },
    {
      headerName: 'Action',
      width: 90,
      pinned: 'right',
      cellRenderer: (props) => {
        const { data } = props;
        if (!data || data.symbol === 'NIFTY' || data.symbol === 'BANKNIFTY') return null;
        return (
          <button
            onClick={() => useTerminalStore.getState().removeSymbolFromWatchlist(data.symbol)}
            className="flex items-center gap-1 bg-[#ffc7ce] text-[#9c0006] border border-[#ff8f9c] hover:bg-[#ffb3bc] px-2 py-0.5 font-bold text-[10px] mt-1 transition cursor-pointer"
          >
            <Trash2 size={10} /> REMOVE
          </button>
        );
      }
    }
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

  const handleAddSymbol = (contract) => {
    addSymbolToWatchlist({
      symbol: contract.trading_symbol,
      ltp: contract.strike || 0,
      bidPrice: contract.strike || 0,
      askPrice: contract.strike || 0,
    });
    setSearchQuery('');
    setSearchResults([]);
    setShowDropdown(false);
  };

  return (
    <div className="flex flex-col h-full bg-white relative" style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>
      
      {/* Dynamic Search & Watchlist Ribbon */}
      <div className="flex items-center justify-between bg-finance-panel border-b border-[#ccc] px-3 py-1.5 gap-4">
        
        {/* Left Side: ADD CONTRACT ENGINE */}
        <div className="flex-1 relative max-w-lg">
          <div className="flex items-center bg-white border border-[#999] rounded px-2 py-0.5 shadow-sm">
            <Search size={14} className="text-gray-500 mr-2 shrink-0" />
            <input 
              type="text" 
              placeholder="Add EQ, FUT, OPTIONS (e.g. INFY, NIFTY 24000 CE)..." 
              className="bg-transparent text-sm w-full outline-none text-black placeholder-gray-400 py-0.5 font-semibold uppercase"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => setShowDropdown(searchResults.length > 0)}
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchResults([]); setShowDropdown(false); }}>
                <X size={14} className="text-gray-400 hover:text-black cursor-pointer" />
              </button>
            )}
          </div>

          {/* Search Dropdown Overlay */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute top-full left-0 w-full bg-white border border-[#999] rounded-b shadow-xl z-50 max-h-64 overflow-y-auto mt-0.5">
              <div className="bg-[#f2f2f2] text-xs font-bold text-[#002060] px-2 py-1 border-b border-[#ccc]">
                {isSearching ? 'Searching...' : `Found ${searchResults.length} Match(es) in Instrument Master:`}
              </div>
              {searchResults.map((contract) => (
                <div 
                  key={contract.token} 
                  className="flex items-center justify-between px-3 py-1.5 hover:bg-[#ffffcc] transition-colors border-b border-gray-100 text-xs text-black"
                >
                  <div className="flex flex-col">
                    <span className="font-bold text-slate-900">{contract.trading_symbol}</span>
                    <span className="text-[10px] text-gray-500">
                      Segment: {contract.exchange_segment?.toUpperCase()} | Expiry: {contract.expiry || 'N/A'} | Lot: {contract.lot_size}
                    </span>
                  </div>
                  <button
                    onClick={() => handleAddSymbol(contract)}
                    className="flex items-center gap-1 bg-[#c6efce] text-[#006100] border border-[#7fc48b] hover:bg-[#a6dfb2] px-2 py-1 font-bold text-[10px] transition cursor-pointer"
                  >
                    <Plus size={10} /> ADD
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Side: FILTER CURRENT WATCHLIST */}
        <div className="w-64">
          <div className="flex items-center bg-[#f9f9f9] border border-[#ccc] rounded px-2 py-0.5">
            <input 
              type="text" 
              placeholder="Filter current watchlist..." 
              className="bg-transparent text-xs w-full outline-none text-black placeholder-gray-400 py-0.5"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
            />
            {filterText && (
              <button onClick={() => setFilterText('')}>
                <X size={12} className="text-gray-400 hover:text-black cursor-pointer" />
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Watchlist AG Grid */}
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
