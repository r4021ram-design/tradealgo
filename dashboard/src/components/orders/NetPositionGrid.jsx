import React, { useMemo, useRef, useState, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { OptionChain } from '../option-chain/OptionChain';
import { StrategyBuilder } from '../strategy/StrategyBuilder';
import { OptionPortfolioManager } from '../portfolio/OptionPortfolioManager';
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
      className="bg-[#e6e6e6] border border-[#ccc] hover:bg-[#ffc7ce] hover:text-[#9c0006] text-black text-xs px-2 py-0.5 font-bold transition-colors"
    >
      SQ OFF
    </button>
  );
};

export const NetPositionGrid = () => {
  const gridRef = useRef();
  const positions = useTerminalStore(state => state.positions);
  const [activeTab, setActiveTab] = useState('Net Position');
  const { pendingOrders, executedOrders, cancelOrder, modifyOrder } = useOrdersData();

  const tabs = ['Net Position', 'Option Chain', 'Strategy Builder', 'Portfolio Manager', 'Pending Orders', 'Executed Trades'];

  const columnDefs = useMemo(() => [
    { field: 'underlying', headerName: 'Underlying', width: 110 },
    { field: 'symbol', headerName: 'Symbol', width: 200 },
    { 
      field: 'netQty', 
      headerName: 'Net Qty', 
      width: 90, 
      type: 'numericColumn',
      cellStyle: params => ({ color: params.value > 0 ? '#008800' : params.value < 0 ? '#cc0000' : '#555' })
    },
    { field: 'avgBuyPrice', headerName: 'Avg Buy', width: 100, type: 'numericColumn', valueFormatter: p => p.value.toFixed(2) },
    { field: 'avgSellPrice', headerName: 'Avg Sell', width: 100, type: 'numericColumn', valueFormatter: p => p.value.toFixed(2) },
    { 
      field: 'ltp', 
      headerName: 'LTP', 
      width: 100, 
      type: 'numericColumn',
      valueFormatter: p => p.value ? p.value.toFixed(2) : '',
      cellClassRules: {
        'flash-up': params => params.data && params.data.tickDirection === 1,
        'flash-down': params => params.data && params.data.tickDirection === -1,
      }
    },
    { 
      field: 'realizedPnl', 
      headerName: 'Realized', 
      width: 110, 
      type: 'numericColumn',
      valueFormatter: p => p.value ? p.value.toFixed(2) : '0.00',
      cellStyle: params => ({ color: params.value > 0 ? '#008800' : params.value < 0 ? '#cc0000' : '#000' })
    },
    { 
      headerName: 'Unrealized (MTM)', 
      width: 140, 
      type: 'numericColumn',
      valueGetter: params => {
        if (!params.data) return 0;
        const p = params.data;
        if (p.netQty === 0) return 0;
        return p.netQty > 0 
          ? (p.ltp - p.avgBuyPrice) * p.netQty 
          : (p.avgSellPrice - p.ltp) * Math.abs(p.netQty);
      },
      valueFormatter: p => p.value ? p.value.toFixed(2) : '0.00',
      cellStyle: params => ({ color: params.value > 0 ? '#008800' : params.value < 0 ? '#cc0000' : '#555', fontWeight: 'bold' }),
      aggFunc: 'sum'
    },
    {
      headerName: 'Net Delta',
      width: 100,
      type: 'numericColumn',
      valueGetter: params => {
        if (!params.data || !params.data.delta || params.data.netQty === 0) return null;
        return params.data.delta * params.data.netQty;
      },
      valueFormatter: p => p.value ? p.value.toFixed(2) : '-',
      aggFunc: 'sum'
    },
    {
      headerName: 'Net Theta',
      width: 100,
      type: 'numericColumn',
      valueGetter: params => {
        if (!params.data || !params.data.theta || params.data.netQty === 0) return null;
        return params.data.theta * params.data.netQty;
      },
      valueFormatter: p => p.value ? p.value.toFixed(2) : '-',
      cellStyle: params => ({ color: params.value < 0 ? '#cc0000' : params.value > 0 ? '#008800' : '#555' }),
      aggFunc: 'sum'
    },
    {
      headerName: 'Action',
      width: 100,
      cellRenderer: SquareOffRenderer,
      sortable: false,
      filter: false
    }
  ], []);

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
  }, [positions]);

  return (
    <div className="flex flex-col flex-1 bg-white">
      {/* Tabs */}
      <div className="flex bg-finance-panel border-b border-[#ccc]">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              "px-4 py-2 text-sm font-semibold transition-colors border-b-2",
              activeTab === tab 
                ? "border-finance-green text-finance-green bg-white font-bold" 
                : "border-transparent text-[#555] hover:text-black hover:bg-[#e6e6e6]"
            )}
            style={{ fontFamily: 'Calibri, Arial, sans-serif' }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'Net Position' ? (
          <div className="h-full ag-theme-alpine">
            <AgGridReact
              ref={gridRef}
              rowData={positions}
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
          <div className="flex items-center justify-center h-full text-[#888] bg-white">
            {activeTab} data not available in demo.
          </div>
        )}
      </div>
    </div>
  );
};
