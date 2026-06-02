import React, { useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';

import { parseOptionSymbol } from '../../utils/symbolParser';

export const OrdersGrid = ({ orders, type, cancelOrder, modifyOrder }) => {
  const gridRef = useRef();
  const [modifyingOrder, setModifyingOrder] = useState(null);
  const [modifyPrice, setModifyPrice] = useState('');
  const [modifyQty, setModifyQty] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCancelClick = async (orderId) => {
    if (window.confirm('Are you sure you want to cancel this order?')) {
      try {
        await cancelOrder(orderId);
      } catch (e) {
        alert('Failed to cancel order: ' + e.message);
      }
    }
  };

  const handleModifyClick = (data) => {
    setModifyingOrder(data);
    setModifyPrice(data.price);
    setModifyQty(data.quantity);
  };

  const submitModify = async () => {
    if (!modifyingOrder) return;
    setIsSubmitting(true);
    try {
      await modifyOrder(modifyingOrder.order_id, modifyPrice, modifyQty);
      setModifyingOrder(null);
    } catch (e) {
      alert('Failed to modify order: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const ActionRenderer = (props) => {
    const { data } = props;
    if (!data) return null;
    if (type !== 'pending' || data.status !== 'pending') return null;

    return (
      <div className="flex gap-2">
        <button 
          onClick={() => handleModifyClick(data)}
          className="bg-[#e6e6e6] border border-[#ccc] hover:bg-[#cce5ff] hover:text-[#004085] text-black text-xs px-2 py-0.5 font-bold transition-colors"
        >
          MODIFY
        </button>
        <button 
          onClick={() => handleCancelClick(data.order_id)}
          className="bg-[#e6e6e6] border border-[#ccc] hover:bg-[#ffc7ce] hover:text-[#9c0006] text-black text-xs px-2 py-0.5 font-bold transition-colors"
        >
          CANCEL
        </button>
      </div>
    );
  };

  const columnDefs = useMemo(() => [
    { field: 'order_id', headerName: 'Order ID', width: 140 },
    {
      headerName: 'Underlying',
      width: 100,
      valueGetter: params => {
        if (!params.data || !params.data.trading_symbol) return '';
        return parseOptionSymbol(params.data.trading_symbol).underlying;
      }
    },
    {
      headerName: 'Expiry',
      width: 120,
      valueGetter: params => {
        if (!params.data || !params.data.trading_symbol) return '';
        return parseOptionSymbol(params.data.trading_symbol).expiry;
      }
    },
    {
      headerName: 'Strike Price',
      width: 100,
      type: 'numericColumn',
      valueGetter: params => {
        if (!params.data || !params.data.trading_symbol) return null;
        const val = parseOptionSymbol(params.data.trading_symbol).strike;
        return val !== '-' ? Number(val) : null;
      },
      valueFormatter: params => params.value !== null ? params.value.toFixed(2) : '-'
    },
    {
      headerName: 'Option Type',
      width: 100,
      valueGetter: params => {
        if (!params.data || !params.data.trading_symbol) return '';
        return parseOptionSymbol(params.data.trading_symbol).type;
      },
      cellStyle: params => {
        if (params.value === 'CE') return { color: '#008800', fontWeight: 'bold' };
        if (params.value === 'PE') return { color: '#cc0000', fontWeight: 'bold' };
        return { fontWeight: 'bold' };
      }
    },
    { field: 'transaction_type', headerName: 'B/S', width: 80, cellStyle: params => ({ color: params.value === 'B' ? '#008800' : '#cc0000', fontWeight: 'bold' }) },
    { field: 'order_type', headerName: 'Type', width: 100 },
    { field: 'payload.tag', headerName: 'Tag', width: 120, valueFormatter: p => p.value || 'MANUAL' },
    { field: 'quantity', headerName: 'Qty', width: 100, type: 'numericColumn' },
    { field: 'price', headerName: 'Price', width: 100, type: 'numericColumn' },
    { field: 'fill_price', headerName: 'Fill Price', width: 100, type: 'numericColumn', hide: type === 'pending' },
    { field: 'status', headerName: 'Status', width: 120, cellStyle: params => {
        let color = '#555';
        if (params.value === 'filled') color = '#008800';
        if (params.value === 'cancelled' || params.value === 'rejected') color = '#cc0000';
        if (params.value === 'pending') color = '#004085';
        return { color, fontWeight: 'bold', textTransform: 'uppercase' };
    }},
    { field: 'submitted_at', headerName: 'Time', width: 150, valueFormatter: p => p.value ? new Date(p.value).toLocaleTimeString() : '' },
    {
      headerName: 'Action',
      width: 150,
      cellRenderer: ActionRenderer,
      sortable: false,
      filter: false,
      hide: type !== 'pending'
    }
  ], [type]);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    suppressMovable: true,
  }), []);

  return (
    <div className="relative flex-1 h-full w-full ag-theme-alpine">
      <AgGridReact
        ref={gridRef}
        rowData={orders}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        headerHeight={28}
        rowHeight={28}
        suppressCellFocus={true}
        animateRows={false}
      />
      
      {modifyingOrder && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-4 border border-[#ccc] shadow-lg w-80">
            <h3 className="font-bold border-b border-[#ccc] pb-2 mb-4 text-[#004085]">
              Modify Order: {modifyingOrder.trading_symbol}
            </h3>
            
            <div className="space-y-4 text-sm">
              <div className="flex flex-col">
                <label className="text-[#555] font-semibold mb-1">Price</label>
                <input 
                  type="number" 
                  value={modifyPrice} 
                  onChange={(e) => setModifyPrice(e.target.value)}
                  className="border border-[#ccc] px-2 py-1 focus:outline-none focus:border-[#004085]"
                />
              </div>
              
              <div className="flex flex-col">
                <label className="text-[#555] font-semibold mb-1">Quantity</label>
                <input 
                  type="number" 
                  value={modifyQty} 
                  onChange={(e) => setModifyQty(e.target.value)}
                  className="border border-[#ccc] px-2 py-1 focus:outline-none focus:border-[#004085]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button 
                onClick={() => setModifyingOrder(null)}
                className="bg-[#f5f5f5] border border-[#ccc] text-black px-4 py-1 hover:bg-[#e6e6e6] transition-colors"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button 
                onClick={submitModify}
                className="bg-[#cce5ff] border border-[#b8daff] text-[#004085] px-4 py-1 font-bold hover:bg-[#b8daff] transition-colors"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Modifying...' : 'Submit Modify'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
