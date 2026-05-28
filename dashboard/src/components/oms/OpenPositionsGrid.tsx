import React, { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ColDef } from 'ag-grid-community';
import { PositionSummary } from '../../engine/types';
import { displayName } from '../../engine/instrumentRegistry';

interface OpenPositionsGridProps {
  positions: PositionSummary[];
}

export const OpenPositionsGrid: React.FC<OpenPositionsGridProps> = ({ positions }) => {
  const columnDefs: ColDef<any>[] = useMemo(() => [
    {
      headerName: 'Instrument',
      valueGetter: (params: any) => displayName(params.data.instrument),
      width: 220,
    },
    { field: 'instrument.segment', headerName: 'Segment', width: 90 },
    {
      field: 'side',
      headerName: 'Position',
      width: 90,
      cellStyle: (params: any) => {
        let color = '#94A3B8';
        if (params.value === 'LONG') color = '#10B981';
        if (params.value === 'SHORT') color = '#F59E0B';
        return { color, fontWeight: 'bold' };
      },
    },
    {
      field: 'netQty',
      headerName: 'Net Qty',
      width: 100,
      type: 'numericColumn',
      valueFormatter: (params: any) => Math.abs(params.value).toString(),
    },
    {
      field: 'avgPrice',
      headerName: 'Avg Entry',
      width: 110,
      type: 'numericColumn',
      valueFormatter: (params: any) => params.value.toFixed(2),
    },
    {
      field: 'ltp',
      headerName: 'LTP',
      width: 110,
      type: 'numericColumn',
      valueFormatter: (params: any) => params.value.toFixed(2),
    },
    {
      field: 'realizedPnl',
      headerName: 'Realized PnL',
      width: 120,
      type: 'numericColumn',
      valueFormatter: (params: any) => params.value.toFixed(2),
      cellStyle: (params: any) => ({
        color: params.value >= 0 ? '#10B981' : '#EF4444',
      }),
    },
    {
      field: 'unrealizedPnl',
      headerName: 'Unrealized PnL',
      width: 120,
      type: 'numericColumn',
      valueFormatter: (params: any) => params.value.toFixed(2),
      cellStyle: (params: any) => ({
        color: params.value >= 0 ? '#10B981' : '#EF4444',
      }),
    },
    {
      field: 'mtm',
      headerName: 'MTM',
      width: 120,
      type: 'numericColumn',
      valueFormatter: (params: any) => params.value.toFixed(2),
      cellStyle: (params: any) => ({
        color: params.value >= 0 ? '#10B981' : '#EF4444',
        fontWeight: 'bold',
      }),
    },
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: true,
  }), []);

  return (
    <div className="w-full h-full flex flex-col">
      <h2 className="text-md font-semibold text-slate-100 mb-2">Open Positions</h2>
      <div className="flex-1 ag-theme-alpine-dark rounded-lg overflow-hidden border border-slate-800">
        <AgGridReact
          rowData={positions}
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
