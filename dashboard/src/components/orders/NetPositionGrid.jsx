import React, { useMemo, useRef, useState, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { OptionChain } from '../option-chain/OptionChain';
import { StrategyBuilder } from '../strategy/StrategyBuilder';
import { OptionPortfolioManager } from '../portfolio/OptionPortfolioManager';
import { MarketWatch } from '../market-watch/MarketWatch';
import { OrdersGrid } from './OrdersGrid';
import { useOrdersData } from '../../hooks/useOrdersData';
import clsx from 'clsx';

const SquareOffRenderer = (props) => {
  const squareOff = useTerminalStore(state => state.squareOff);
  const { data } = props;

  if (!data || data.netQty === 0) return null;

  return (
    <button 
      onClick={() => squareOff(data.symbol)}
      className="bg-[#e6e6e6] dark:bg-slate-800 border border-[#ccc] dark:border-slate-700 hover:bg-[#ffc7ce] dark:hover:bg-rose-950/45 hover:text-[#9c0006] dark:hover:text-rose-400 dark:hover:border-rose-900 text-black dark:text-slate-200 text-xs px-2 py-0.5 font-bold transition-colors cursor-pointer"
    >
      SQ OFF
    </button>
  );
};

import { parseOptionSymbol } from '../../utils/symbolParser';

export const NetPositionGrid = () => {
  const gridRef = useRef();
  const positions = useTerminalStore(state => state.liveBrokerPositions || state.positions);
  const theme = useTerminalStore(state => state.theme);
  const [activeTab, setActiveTab] = useState('Market Watch');
  const { pendingOrders, executedOrders, cancelOrder, modifyOrder } = useOrdersData();

  const resolvedPositions = useMemo(() => {
    const rawPositions = positions || [];

    return rawPositions.map(p => {
      const symbol = p.symbol || p.trading_symbol || p.trdSym || '';
      let lotSize = 1;
      const upperSymbol = symbol.toUpperCase();
      if (upperSymbol.includes('BANKNIFTY')) {
        lotSize = 30;
      } else if (upperSymbol.includes('NIFTY')) {
        lotSize = 65;
      } else if (upperSymbol.includes('FINNIFTY')) {
        lotSize = 60;
      } else if (upperSymbol.includes('MIDCPNIFTY')) {
        lotSize = 120;
      } else if (upperSymbol.includes('SENSEX')) {
        lotSize = 20;
      } else if (upperSymbol.includes('BANKEX')) {
        lotSize = 30;
      }

      const netQty = p.netQty !== undefined ? p.netQty : 0;
      const ltp = p.ltp || 0;
      const avgBuyPrice = p.avgBuyPrice !== undefined ? p.avgBuyPrice : 0;
      const avgSellPrice = p.avgSellPrice !== undefined ? p.avgSellPrice : 0;
      
      let unrealizedPnl = 0;
      if (netQty > 0) {
        unrealizedPnl = netQty * (ltp - avgBuyPrice) * lotSize;
      } else if (netQty < 0) {
        unrealizedPnl = netQty * (ltp - avgSellPrice) * lotSize;
      }

      const rawRealized = p.realizedPnl !== undefined ? p.realizedPnl : 0;
      const realizedPnl = rawRealized * lotSize;

      return {
        ...p,
        symbol,
        netQty,
        avgBuyPrice,
        avgSellPrice,
        realizedPnl,
        unrealizedPnl,
        lotSize
      };
    });
  }, [positions]);

  const tabs = ['Market Watch', 'Net Position', 'Option Chain', 'Strategy Builder', 'Portfolio Manager', 'Pending Orders', 'Executed Trades'];

  const isDark = theme === 'dark';
  const greenColor = isDark ? '#10b981' : '#008800';
  const redColor = isDark ? '#f43f5e' : '#cc0000';
  const neutralColor = isDark ? '#94a3b8' : '#555';
  const textColor = isDark ? '#f8fafc' : '#000';

  const columnDefs = useMemo(() => [
    { field: 'underlying', headerName: 'Underlying', width: 100 },
    {
      headerName: 'Expiry',
      width: 120,
      valueGetter: params => {
        if (!params.data || !params.data.symbol) return '';
        return parseOptionSymbol(params.data.symbol).expiry;
      }
    },
    {
      headerName: 'Strike Price',
      width: 100,
      type: 'numericColumn',
      valueGetter: params => {
        if (!params.data || !params.data.symbol) return null;
        const val = parseOptionSymbol(params.data.symbol).strike;
        return val !== '-' ? Number(val) : null;
      },
      valueFormatter: params => params.value !== null ? params.value.toFixed(2) : '-',
      cellClass: 'font-mono-numbers'
    },
    {
      headerName: 'Option Type',
      width: 100,
      valueGetter: params => {
        if (!params.data || !params.data.symbol) return '';
        return parseOptionSymbol(params.data.symbol).type;
      },
      cellStyle: params => {
        if (params.value === 'CE') return { color: greenColor, fontWeight: 'bold' };
        if (params.value === 'PE') return { color: redColor, fontWeight: 'bold' };
        return { fontWeight: 'bold' };
      }
    },
    { 
      field: 'netQty', 
      headerName: 'Net Qty', 
      width: 90, 
      type: 'numericColumn',
      cellStyle: params => ({ color: params.value > 0 ? greenColor : params.value < 0 ? redColor : neutralColor }),
      cellClass: 'font-mono-numbers'
    },
    { field: 'avgBuyPrice', headerName: 'Avg Buy', width: 100, type: 'numericColumn', valueFormatter: p => p.value.toFixed(2), cellClass: 'font-mono-numbers' },
    { field: 'avgSellPrice', headerName: 'Avg Sell', width: 100, type: 'numericColumn', valueFormatter: p => p.value.toFixed(2), cellClass: 'font-mono-numbers' },
    { 
      field: 'ltp', 
      headerName: 'LTP', 
      width: 100, 
      type: 'numericColumn',
      valueFormatter: p => p.value ? p.value.toFixed(2) : '',
      cellClassRules: {
        'flash-up': params => params.data && params.data.tickDirection === 1,
        'flash-down': params => params.data && params.data.tickDirection === -1,
      },
      cellClass: 'font-mono-numbers'
    },
    { 
      field: 'realizedPnl', 
      headerName: 'Realized', 
      width: 110, 
      type: 'numericColumn',
      valueFormatter: p => p.value ? p.value.toFixed(2) : '0.00',
      cellStyle: params => ({ color: params.value > 0 ? greenColor : params.value < 0 ? redColor : textColor }),
      cellClass: 'font-mono-numbers'
    },
    { 
      field: 'unrealizedPnl',
      headerName: 'Unrealized (MTM)', 
      width: 140, 
      type: 'numericColumn',
      valueFormatter: p => p.value ? p.value.toFixed(2) : '0.00',
      cellStyle: params => ({ color: params.value > 0 ? greenColor : params.value < 0 ? redColor : neutralColor, fontWeight: 'bold' }),
      aggFunc: 'sum',
      cellClass: 'font-mono-numbers'
    },
    {
      headerName: 'Net Delta (₹)',
      width: 100,
      type: 'numericColumn',
      valueGetter: params => {
        if (!params.data || !params.data.delta || params.data.netQty === 0) return null;
        return params.data.delta * params.data.netQty;
      },
      valueFormatter: p => p.value ? p.value.toFixed(2) : '-',
      aggFunc: 'sum',
      cellClass: 'font-mono-numbers'
    },
    {
      headerName: 'Net Gamma',
      width: 100,
      type: 'numericColumn',
      valueGetter: params => {
        if (!params.data || !params.data.gamma || params.data.netQty === 0) return null;
        return params.data.gamma * params.data.netQty;
      },
      valueFormatter: p => p.value ? p.value.toFixed(4) : '-',
      aggFunc: 'sum',
      cellClass: 'font-mono-numbers'
    },
    {
      headerName: 'Net Theta (₹)',
      width: 100,
      type: 'numericColumn',
      valueGetter: params => {
        if (!params.data || !params.data.theta || params.data.netQty === 0) return null;
        return params.data.theta * params.data.netQty;
      },
      valueFormatter: p => p.value ? p.value.toFixed(2) : '-',
      cellStyle: params => ({ color: params.value < 0 ? redColor : params.value > 0 ? greenColor : neutralColor }),
      aggFunc: 'sum',
      cellClass: 'font-mono-numbers'
    },
    {
      headerName: 'Net Vega (₹)',
      width: 100,
      type: 'numericColumn',
      valueGetter: params => {
        if (!params.data || !params.data.vega || params.data.netQty === 0) return null;
        return params.data.vega * params.data.netQty;
      },
      valueFormatter: p => p.value ? p.value.toFixed(2) : '-',
      cellStyle: params => ({ color: params.value < 0 ? redColor : params.value > 0 ? greenColor : neutralColor }),
      aggFunc: 'sum',
      cellClass: 'font-mono-numbers'
    },
    {
      headerName: 'Action',
      width: 100,
      cellRenderer: SquareOffRenderer,
      sortable: false,
      filter: false
    }
  ], [greenColor, redColor, neutralColor, textColor]);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    suppressMovable: true,
  }), []);

  useEffect(() => {
    if (gridRef.current && gridRef.current.api) {
      setTimeout(() => {
        gridRef.current.api.refreshCells({ force: true, columns: ['ltp'] });
      }, 0);
    }
  }, [resolvedPositions]);

  return (
    <div className="flex flex-col flex-1 bg-white dark:bg-slate-900 min-h-0 overflow-hidden">
      {/* Tabs */}
      <div className="flex bg-finance-panel dark:bg-slate-950 border-b border-[#ccc] dark:border-slate-800">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              "px-4 py-2 text-sm font-semibold transition-colors border-b-2 cursor-pointer",
              activeTab === tab 
                ? "border-finance-green dark:border-indigo-500 text-finance-green dark:text-indigo-400 bg-white dark:bg-slate-900 font-bold" 
                : "border-transparent text-[#555] dark:text-slate-400 hover:text-black dark:hover:text-slate-200 hover:bg-[#e6e6e6] dark:hover:bg-slate-800"
            )}
            style={{ fontFamily: theme === 'dark' ? 'Inter, sans-serif' : 'Calibri, Arial, sans-serif' }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'Market Watch' ? (
          <MarketWatch />
        ) : activeTab === 'Net Position' ? (
          <div className="h-full ag-theme-alpine">
            <AgGridReact
              ref={gridRef}
              rowData={resolvedPositions}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              headerHeight={28}
              rowHeight={24}
              suppressCellFocus={true}
              animateRows={false}
            />
          </div>
        ) : activeTab === 'Option Chain' ? (
          <OptionChain />
        ) : activeTab === 'Strategy Builder' ? (
          <StrategyBuilder />
        ) : activeTab === 'Portfolio Manager' ? (
          <OptionPortfolioManager />
        ) : activeTab === 'Pending Orders' ? (
          <OrdersGrid orders={pendingOrders} type="pending" cancelOrder={cancelOrder} modifyOrder={modifyOrder} />
        ) : activeTab === 'Executed Trades' ? (
          <OrdersGrid orders={executedOrders} type="executed" cancelOrder={cancelOrder} modifyOrder={modifyOrder} />
        ) : (
          <div className="flex items-center justify-center h-full text-[#888] dark:text-slate-500 bg-white dark:bg-slate-900">
            {activeTab} data not available in demo.
          </div>
        )}
      </div>
    </div>
  );
};
