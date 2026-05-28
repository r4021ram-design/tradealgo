import React, { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ColDef } from 'ag-grid-community';
import { ClosedTrade } from '../../engine/types';
import { displayName } from '../../engine/instrumentRegistry';

interface ClosedTradesGridProps {
  closedTrades: ClosedTrade[];
}

export const ClosedTradesGrid: React.FC<ClosedTradesGridProps> = ({ closedTrades }) => {
  const columnDefs: ColDef<any>[] = useMemo(() => [
    {
      headerName: 'Instrument',
      valueGetter: (params: any) => displayName(params.data.instrument),
      width: 200,
    },
    { field: 'instrument.segment', headerName: 'Segment', width: 90 },
    {
      field: 'entrySide',
      headerName: 'Entry Side',
      width: 100,
      cellStyle: (params: any) => ({
        color: params.value === 'BUY' ? '#10B981' : '#EF4444',
        fontWeight: 'bold',
      }),
    },
    {
      field: 'exitSide',
      headerName: 'Exit Side',
      width: 100,
      cellStyle: (params: any) => ({
        color: params.value === 'BUY' ? '#10B981' : '#EF4444',
        fontWeight: 'bold',
      }),
    },
    { field: 'qty', headerName: 'Qty Matched', width: 110, type: 'numericColumn' },
    {
      field: 'entryPrice',
      headerName: 'Entry Price',
      width: 110,
      type: 'numericColumn',
      valueFormatter: (params: any) => params.value.toFixed(2),
    },
    {
      field: 'exitPrice',
      headerName: 'Exit Price',
      width: 110,
      type: 'numericColumn',
      valueFormatter: (params: any) => params.value.toFixed(2),
    },
    {
      field: 'pnl',
      headerName: 'Realized PnL',
      width: 120,
      type: 'numericColumn',
      valueFormatter: (params: any) => params.value.toFixed(2),
      cellStyle: (params: any) => ({
        color: params.value >= 0 ? '#10B981' : '#EF4444',
        fontWeight: 'bold',
      }),
    },
    {
      field: 'entryTime',
      headerName: 'Entry Time',
      width: 120,
      valueFormatter: (params: any) => new Date(params.value).toLocaleTimeString(),
    },
    {
      field: 'exitTime',
      headerName: 'Exit Time',
      width: 120,
      valueFormatter: (params: any) => new Date(params.value).toLocaleTimeString(),
    },
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: true,
  }), []);

  return (
    <div className="w-full h-full flex flex-col">
      <h2 className="text-md font-semibold text-slate-100 mb-2">Closed Trades (FIFO Matched Pairs)</h2>
      <div className="flex-1 ag-theme-alpine-dark rounded-lg overflow-hidden border border-slate-800">
        <AgGridReact
          rowData={closedTrades}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          headerHeight={32}
          rowHeight={30}
          suppressCellFocus={true}
          animateRows={true}
        />
      </div>
    </div>
  );
};
