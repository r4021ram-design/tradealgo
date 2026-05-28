import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ColDef } from 'ag-grid-community';
import { Order } from '../../engine/types';
import { displayName } from '../../engine/instrumentRegistry';
import { useOMSStore } from '../../store/useOMSStore';

interface OrderBookGridProps {
  orders: Order[];
}

export const OrderBookGrid: React.FC<OrderBookGridProps> = ({ orders }) => {
  const { modifyOrderInStore, fillPendingOrder, updateOrderStatus } = useOMSStore();

  const [modifyingOrder, setModifyingOrder] = useState<Order | null>(null);
  const [modifyPrice, setModifyPrice] = useState('');
  const [modifyQty, setModifyQty] = useState('');

  const handleModifyClick = (order: Order) => {
    setModifyingOrder(order);
    setModifyPrice(String(order.price));
    setModifyQty(String(order.qty));
  };

  const handleCancelClick = (orderId: string) => {
    if (window.confirm('Are you sure you want to cancel this order?')) {
      updateOrderStatus(orderId, 'CANCELLED' as any);
    }
  };

  const handleFillClick = (orderId: string) => {
    fillPendingOrder(orderId);
  };

  const submitModify = () => {
    if (!modifyingOrder) return;
    modifyOrderInStore(modifyingOrder.id, parseFloat(modifyPrice), parseInt(modifyQty, 10));
    setModifyingOrder(null);
  };

  const ActionRenderer = (props: any) => {
    const data = props.data as Order;
    if (!data || data.status !== 'PENDING') return null;

    return (
      <div className="flex gap-1 items-center h-full">
        <button
          onClick={() => handleFillClick(data.id)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 rounded font-bold transition"
        >
          FILL
        </button>
        <button
          onClick={() => handleModifyClick(data)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] px-1.5 py-0.5 rounded font-bold transition"
        >
          MOD
        </button>
        <button
          onClick={() => handleCancelClick(data.id)}
          className="bg-rose-600 hover:bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded font-bold transition"
        >
          DEL
        </button>
      </div>
    );
  };

  const columnDefs: ColDef<any>[] = useMemo(() => [
    { field: 'id', headerName: 'Order ID', width: 140 },
    {
      headerName: 'Instrument',
      valueGetter: (params: any) => displayName(params.data.instrument),
      width: 200,
    },
    { field: 'instrument.segment', headerName: 'Segment', width: 90 },
    {
      field: 'side',
      headerName: 'Side',
      width: 80,
      cellStyle: (params: any) => ({
        color: params.value === 'BUY' ? '#10B981' : '#EF4444',
        fontWeight: 'bold',
      }),
    },
    { field: 'qty', headerName: 'Quantity', width: 90, type: 'numericColumn' },
    {
      field: 'price',
      headerName: 'Price',
      width: 100,
      type: 'numericColumn',
      valueFormatter: (params: any) => params.value.toFixed(2),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 110,
      cellStyle: (params: any) => {
        let color = '#94A3B8';
        if (params.value === 'FILLED') color = '#10B981';
        if (params.value === 'PENDING') color = '#3B82F6';
        if (params.value === 'CANCELLED' || params.value === 'REJECTED') color = '#EF4444';
        return { color, fontWeight: 'bold' };
      },
    },
    {
      field: 'timestamp',
      headerName: 'Time',
      width: 120,
      valueFormatter: (params: any) => new Date(params.value).toLocaleTimeString(),
    },
    {
      headerName: 'Actions',
      width: 130,
      cellRenderer: ActionRenderer,
      sortable: false,
      filter: false,
    },
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: true,
  }), []);

  const title = 'Order Book (Trade History)';

  return (
    <div className="w-full h-full flex flex-col relative">
      <h2 className="text-md font-semibold text-slate-100 mb-2">{title}</h2>
      <div className="flex-1 ag-theme-alpine-dark rounded-lg overflow-hidden border border-slate-800">
        <AgGridReact
          rowData={orders}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          headerHeight={32}
          rowHeight={30}
          suppressCellFocus={true}
          animateRows={true}
        />
      </div>

      {modifyingOrder && (
        <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-800 p-4 shadow-lg w-80 rounded-lg">
            <h3 className="font-bold border-b border-slate-800 pb-2 mb-4 text-indigo-400">
              Modify Order: {displayName(modifyingOrder.instrument)}
            </h3>
            
            <div className="space-y-4 text-sm text-slate-200">
              <div className="flex flex-col">
                <label className="text-slate-400 font-semibold mb-1">Price</label>
                <input 
                  type="number" 
                  value={modifyPrice} 
                  onChange={(e) => setModifyPrice(e.target.value)}
                  className="bg-slate-850 border border-slate-750 text-slate-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
                />
              </div>
              
              <div className="flex flex-col">
                <label className="text-slate-400 font-semibold mb-1">Quantity</label>
                <input 
                  type="number" 
                  value={modifyQty} 
                  onChange={(e) => setModifyQty(e.target.value)}
                  className="bg-slate-850 border border-slate-750 text-slate-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button 
                onClick={() => setModifyingOrder(null)}
                className="bg-slate-800 border border-slate-750 text-slate-300 px-4 py-1 hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button 
                onClick={submitModify}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1 font-bold rounded transition"
              >
                Submit Modify
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
