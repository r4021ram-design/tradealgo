import React, { useState, useEffect, useMemo } from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { getApiUrl } from '../../utils/api';

export const OrderModal = () => {
  const { isOpen, type, symbol, price, token, exchangeSegment, expiry, lotSize: storeLotSize } = useTerminalStore(state => state.orderModal);
  const availableMargin = useTerminalStore(state => state.availableMargin);
  const closeOrderModal = useTerminalStore(state => state.closeOrderModal);
  
  const [activeTab, setActiveTab] = useState('Regular');
  
  // Form State
  const [product, setProduct] = useState('MIS');
  const [orderType, setOrderType] = useState('Limit');
  const [qty, setQty] = useState(1);
  const [orderPrice, setOrderPrice] = useState(price || 0);
  const [triggerPrice, setTriggerPrice] = useState(0);
  
  // Iceberg State
  const [icebergLegs, setIcebergLegs] = useState(2);
  const [icebergLegQty, setIcebergLegQty] = useState(1);

  // GTT State
  const [gttStoploss, setGttStoploss] = useState(false);
  const [gttStoplossPct, setGttStoplossPct] = useState(-5);
  const [gttTarget, setGttTarget] = useState(false);
  const [gttTargetPct, setGttTargetPct] = useState(10);

  // Validation state
  const [error, setError] = useState(null);

  const [resolvedMetadata, setResolvedMetadata] = useState(null);

  useEffect(() => {
    if (isOpen && symbol) {
      const fetchMetadata = async () => {
        try {
          const response = await fetch(getApiUrl(`/api/contracts/details?trading_symbol=${encodeURIComponent(symbol)}`));
          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              setResolvedMetadata(data);
            }
          }
        } catch (e) {
          console.error('[OrderModal] Failed to fetch contract details:', e);
        }
      };
      fetchMetadata();
    } else {
      setResolvedMetadata(null);
    }
  }, [isOpen, symbol]);

  // Determine lot size based on symbol prefix
  const getLotSize = (sym) => {
    if (!sym) return 1;
    if (sym.startsWith('NIFTY')) return 65;
    if (sym.startsWith('BANKNIFTY')) return 30;
    if (sym.startsWith('FINNIFTY')) return 60;
    if (sym.startsWith('MIDCPNIFTY')) return 120;
    if (sym.startsWith('SENSEX')) return 20;
    if (sym.startsWith('BANKEX')) return 30;
    return 1; // Default for equity
  };
  
  const lotSize = (resolvedMetadata && resolvedMetadata.lot_size) ? resolvedMetadata.lot_size : (storeLotSize || getLotSize(symbol));

  // Update lot size and price when symbol or price changes
  useEffect(() => {
    if (isOpen) {
      const priceNum = Number(price) || 0;
      const effectiveLotSize = storeLotSize || (resolvedMetadata ? resolvedMetadata.lot_size : getLotSize(symbol));
      setQty(effectiveLotSize);
      setOrderPrice(priceNum);
      setTriggerPrice(priceNum ? Number((priceNum * 0.98).toFixed(2)) : 0); // Default SL 2% below
      setError(null);
      // Reset defaults based on tab
      if (activeTab === 'Cover') {
        setProduct('MIS');
        setOrderType('Limit');
      } else if (activeTab === 'MTF') {
        setProduct('CNC');
      } else if (activeTab === 'Quick') {
        setOrderType('Market');
      }
    }
  }, [isOpen, symbol, price, storeLotSize, activeTab]);

  // Sync Qty if metadata updates after open
  useEffect(() => {
    if (isOpen && resolvedMetadata && resolvedMetadata.lot_size) {
      const guessedLotSize = storeLotSize || getLotSize(symbol);
      if (qty === guessedLotSize || qty === 1) {
        setQty(resolvedMetadata.lot_size);
      }
    }
  }, [resolvedMetadata, isOpen, storeLotSize]);

  // Handle Tab changes and enforce constraints
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setError(null);
    if (tab === 'Quick') {
      setOrderType('Market');
    } else if (tab === 'MTF') {
      setProduct('CNC');
    } else if (tab === 'Cover') {
      setProduct('MIS');
      setOrderType('Limit');
    } else if (tab === 'AMO' && orderType === 'Market') {
      setOrderType('Limit');
    }
  };

  if (!isOpen) return null;

  const isBuy = type === 'BUY';
  const headerBg = isBuy ? 'bg-[#4a90e2]' : 'bg-[#e24a4a]';
  const btnBg = isBuy ? 'bg-[#4a90e2] text-white' : 'bg-[#e24a4a] text-white';

  // Field disable logic
  const isPriceDisabled = orderType === 'Market' || orderType === 'SL-M';
  const isTriggerDisabled = orderType !== 'SL' && orderType !== 'SL-M' && activeTab !== 'Cover';
  
  // Computed values
  const priceNum = Number(price) || 0;
  const orderPriceNum = Number(orderPrice) || 0;
  const requiredMargin = isPriceDisabled ? priceNum * qty : orderPriceNum * qty;
  const requiredMarginVal = isNaN(requiredMargin) ? 0 : requiredMargin;

  // Dynamically generate market depth around price
  const depth = useMemo(() => {
    const basePrice = priceNum || 10.0;
    const result = [];
    for (let i = 0; i < 5; i++) {
      const bidPrice = Math.max(0.05, basePrice - (i * 0.05) - 0.05);
      const offerPrice = basePrice + (i * 0.05) + 0.05;
      
      const bidOrders = Math.floor((20 - i * 3) * (1 + (i % 2) * 0.15));
      const offerOrders = Math.floor((18 - i * 2.5) * (1 + (i % 2) * 0.2));
      
      const bidQty = bidOrders * lotSize * Math.floor((Math.sin(i) * 2 + 3));
      const offerQty = offerOrders * lotSize * Math.floor((Math.cos(i) * 2 + 3));
      
      result.push({
        bid: Number(bidPrice.toFixed(2)),
        bidOrders,
        bidQty,
        offer: Number(offerPrice.toFixed(2)),
        offerOrders,
        offerQty
      });
    }
    return result;
  }, [price, lotSize]);

  const totalBidQty = useMemo(() => depth.reduce((sum, r) => sum + r.bidQty, 0), [depth]);
  const totalOfferQty = useMemo(() => depth.reduce((sum, r) => sum + r.offerQty, 0), [depth]);

  const validate = () => {
    if (qty <= 0) return 'Quantity must be greater than 0';
    if (qty % lotSize !== 0) return `Quantity must be a multiple of lot size (${lotSize})`;
    if (!isPriceDisabled && orderPrice <= 0) return 'Price must be greater than 0';
    if (!isTriggerDisabled && triggerPrice <= 0) return 'Trigger price must be greater than 0';
    
    // SL logic validation
    if (!isTriggerDisabled && activeTab !== 'Cover') {
      if (isBuy && orderType === 'SL' && triggerPrice <= orderPrice) return 'For Buy SL, Trigger must be > Price';
      if (!isBuy && orderType === 'SL' && triggerPrice >= orderPrice) return 'For Sell SL, Trigger must be < Price';
    }

    // Cover logic validation
    if (activeTab === 'Cover') {
       if (isBuy && triggerPrice >= orderPrice) return 'Cover order Stoploss must be < Buy Price';
       if (!isBuy && triggerPrice <= orderPrice) return 'Cover order Stoploss must be > Sell Price';
    }

    if (activeTab === 'Iceberg') {
      if (icebergLegs < 2) return 'Iceberg must have at least 2 legs';
      if (icebergLegQty * icebergLegs !== qty) return `Total Qty (${qty}) must equal Legs (${icebergLegs}) × Leg Qty (${icebergLegQty})`;
    }

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    
    const resolvedSegment = (resolvedMetadata && resolvedMetadata.exchange_segment) ? resolvedMetadata.exchange_segment : (exchangeSegment || ((symbol && (symbol.startsWith('SENSEX') || symbol.startsWith('BANKEX'))) ? 'bse_fo' : 'nse_fo'));
    const resolvedToken = (resolvedMetadata && resolvedMetadata.token) ? resolvedMetadata.token : (token || symbol);
    const resolvedExpiry = (resolvedMetadata && resolvedMetadata.expiry) ? resolvedMetadata.expiry : (expiry || null);

    const apiPayload = {
      trading_symbol: symbol,
      token: resolvedToken,
      side: isBuy ? 'B' : 'S',
      exchange_segment: resolvedSegment,
      product: product === 'CNC' ? 'CNC' : 'NRML',
      order_type: orderType === 'Limit' ? 'L' : orderType === 'Market' ? 'MKT' : orderType,
      quantity: qty,
      opt_type: (symbol && symbol.endsWith('PE')) ? 'PE' : 'CE',
      transaction_type: isBuy ? 'B' : 'S',
      price: String(orderPrice),
      trigger_price: String(triggerPrice),
      expiry: resolvedExpiry
    };

    try {
      setError(null);
      const response = await fetch(getApiUrl('/api/order/place'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiPayload)
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const result = await response.json();
      console.log('Order Placed successfully:', result);
      closeOrderModal();
    } catch (err) {
      console.error('Failed to place order:', err);
      setError(err.message || 'Failed to place order');
    }
  };

  const tabs = ['Quick', 'Regular', 'AMO', 'MTF', 'Iceberg', 'Cover'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>
      
      {/* Modal Container */}
      <div className="flex bg-white shadow-2xl rounded-sm overflow-hidden" style={{ width: '850px' }}>
        
        {/* Left Pane - Order Entry */}
        <div className="flex-3 flex flex-col border-r border-[#ccc]">
          
          {/* Header */}
          <div className={clsx("flex items-center justify-between px-4 py-3 text-white", headerBg)}>
            <div className="flex items-center gap-6 font-bold text-sm">
               <span className="uppercase">{symbol || 'Select Symbol'}</span>
               <span className="flex items-center gap-1">
                 <div className="w-2 h-2 bg-white rounded-full"></div>
                 {(((resolvedMetadata && resolvedMetadata.exchange_segment) || exchangeSegment || '').split('_')[0] || 'NSE').toUpperCase()} ₹{priceNum.toFixed(2)}
               </span>
               <span className="ml-4 text-xs font-normal opacity-80">Lot size: {lotSize}</span>
            </div>
          </div>

          {/* Body Tabs */}
          <div className="flex bg-finance-panel border-b border-[#ccc] text-xs">
            {tabs.map(tab => (
              <button 
                key={tab}
                type="button"
                onClick={() => handleTabChange(tab)}
                className={clsx(
                  "px-4 py-2 font-semibold",
                  activeTab === tab 
                    ? "border-b-2 border-[#4a90e2] text-[#4a90e2] bg-white" 
                    : "text-[#888] hover:bg-[#e6e6e6]"
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-5 flex-1 relative">
            
            {/* Error Message */}
            {error && (
              <div className="absolute top-0 left-0 right-0 bg-red-100 text-red-600 px-4 py-1.5 text-xs font-bold border-b border-red-200">
                ⚠️ {error}
              </div>
            )}

            {/* Product Type (Hidden for Quick/Cover/MTF as they force a type) */}
            {activeTab !== 'Quick' && activeTab !== 'Cover' && activeTab !== 'MTF' && (
              <div className="flex justify-between items-center text-sm mt-2">
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="radio" 
                      name="product" 
                      value="MIS"
                      checked={product === 'MIS'}
                      onChange={(e) => setProduct(e.target.value)}
                      className="accent-[#4a90e2]" 
                    />
                    <span>Intraday <span className="text-[#888] text-xs ml-1">MIS</span></span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="radio" 
                      name="product" 
                      value="CNC"
                      checked={product === 'CNC'}
                      onChange={(e) => setProduct(e.target.value)}
                      className="accent-[#4a90e2]" 
                    />
                    <span>Longterm <span className="text-[#888] text-xs ml-1">CNC</span></span>
                  </label>
                </div>
                <span className="text-[#4a90e2] cursor-pointer text-xs">Advanced ⌄</span>
              </div>
            )}

            {activeTab === 'MTF' && (
              <div className="text-sm text-[#555] bg-yellow-50 p-2 border border-yellow-200 rounded-sm mt-2">
                <strong>Margin Trading Facility (MTF)</strong> enables you to buy delivery stocks by paying only a fraction of the value.
                Product type is forced to CNC.
              </div>
            )}

            {/* Main Inputs: Qty, Price, Trigger */}
            <div className={clsx("flex gap-4", activeTab === 'Quick' || activeTab === 'Cover' || activeTab === 'MTF' ? "mt-4" : "")}>
              <div className="flex-1">
                <label className="block text-xs text-[#555] mb-1">Qty. <span className="text-[#888]">(Lot: {lotSize})</span></label>
                <input 
                  type="number" 
                  value={qty}
                  onChange={e => setQty(Number(e.target.value))}
                  step={lotSize}
                  min={lotSize}
                  className="excel-input w-full border border-[#ccc] px-2 py-1.5 outline-none font-bold" 
                />
              </div>
              
              {activeTab !== 'Quick' && (
                <>
                  <div className={clsx("flex-1", isPriceDisabled && "opacity-50")}>
                    <label className="block text-xs text-[#555] mb-1">Price</label>
                    <input 
                      type="number" 
                      step="0.05"
                      value={orderPrice}
                      onChange={e => setOrderPrice(Number(e.target.value))}
                      disabled={isPriceDisabled}
                      className={clsx("w-full border border-[#ccc] px-2 py-1.5 outline-none", !isPriceDisabled && "excel-input font-bold")} 
                    />
                  </div>
                  
                  {(activeTab === 'Cover' || orderType === 'SL' || orderType === 'SL-M') ? (
                    <div className="flex-1">
                      <label className="block text-xs mb-1 font-bold text-red-500">Trigger price *</label>
                      <input 
                        type="number" 
                        step="0.05"
                        value={triggerPrice}
                        onChange={e => setTriggerPrice(Number(e.target.value))}
                        className="excel-input w-full border border-red-300 px-2 py-1.5 outline-none font-bold" 
                      />
                    </div>
                  ) : (
                    <div className="flex-1 opacity-50 pointer-events-none">
                      <label className="block text-xs text-[#555] mb-1">Trigger price</label>
                      <input 
                        type="number" 
                        value={0} 
                        className="bg-finance-panel border border-[#ccc] px-2 py-1.5 w-full outline-none" 
                        disabled
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Iceberg specific inputs */}
            {activeTab === 'Iceberg' && (
              <div className="flex gap-4 bg-blue-50 p-3 border border-blue-100 rounded-sm">
                <div className="flex-1">
                  <label className="block text-xs text-[#555] mb-1">Number of Legs</label>
                  <input 
                    type="number" 
                    value={icebergLegs}
                    onChange={e => {
                      const legs = Number(e.target.value);
                      setIcebergLegs(legs);
                      if (legs > 0) setIcebergLegQty(Math.floor(qty / legs));
                    }}
                    min="2"
                    max="10"
                    className="w-full border border-[#ccc] px-2 py-1.5 outline-none font-bold" 
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-[#555] mb-1">Leg Qty</label>
                  <input 
                    type="number" 
                    value={icebergLegQty}
                    onChange={e => setIcebergLegQty(Number(e.target.value))}
                    className="w-full border border-[#ccc] px-2 py-1.5 outline-none" 
                  />
                </div>
                <div className="flex-1 flex items-end pb-2">
                  <span className="text-xs text-[#555]">
                    Total: {icebergLegs * icebergLegQty} / {qty}
                  </span>
                </div>
              </div>
            )}

            {/* Order Type Radios */}
            {activeTab !== 'Quick' && activeTab !== 'Cover' && (
              <div className="flex gap-6 text-sm">
                {activeTab !== 'AMO' && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="radio" 
                      name="orderType" 
                      value="Market"
                      checked={orderType === 'Market'}
                      onChange={(e) => setOrderType(e.target.value)}
                      className="accent-[#4a90e2]" 
                    />
                    <span>Market</span>
                  </label>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="orderType" 
                    value="Limit"
                    checked={orderType === 'Limit'}
                    onChange={(e) => setOrderType(e.target.value)}
                    className="accent-[#4a90e2]" 
                  />
                  <span>Limit</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer ml-auto">
                  <input 
                    type="radio" 
                    name="orderType" 
                    value="SL"
                    checked={orderType === 'SL'}
                    onChange={(e) => setOrderType(e.target.value)}
                    className="accent-[#4a90e2]" 
                  />
                  <span>SL</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="orderType" 
                    value="SL-M"
                    checked={orderType === 'SL-M'}
                    onChange={(e) => setOrderType(e.target.value)}
                    className="accent-[#4a90e2]" 
                  />
                  <span>SL-M</span>
                </label>
              </div>
            )}

            {/* Cover Order Note */}
            {activeTab === 'Cover' && (
              <div className="text-xs text-[#888] bg-finance-panel p-2 border border-[#eee]">
                Cover orders require a mandatory stop-loss. The order is placed as a Limit order, with an attached Stop-Loss Market order.
              </div>
            )}

            {/* Advanced GTT / Stoploss - Only on Regular Tab */}
            {activeTab === 'Regular' && (
              <div className="flex items-center gap-4 text-sm mt-2 border-t border-[#eee] pt-4">
                <span className="text-[#4a90e2] font-bold italic text-xs">GTT</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={gttStoploss}
                    onChange={e => setGttStoploss(e.target.checked)}
                    className="accent-[#4a90e2]" 
                  />
                  <span>Stoploss</span>
                </label>
                <input 
                  type="number" 
                  disabled={!gttStoploss} 
                  value={gttStoplossPct}
                  onChange={e => setGttStoplossPct(Number(e.target.value))}
                  className={clsx("w-16 border px-1 text-xs outline-none", gttStoploss ? "border-[#ccc] bg-white" : "border-[#eee] bg-finance-panel opacity-50")} 
                />
                <span className="text-xs text-[#888]">%</span>
                
                <label className="flex items-center gap-2 cursor-pointer ml-4">
                  <input 
                    type="checkbox" 
                    checked={gttTarget}
                    onChange={e => setGttTarget(e.target.checked)}
                    className="accent-[#4a90e2]" 
                  />
                  <span>Target</span>
                </label>
                <input 
                  type="number" 
                  disabled={!gttTarget} 
                  value={gttTargetPct}
                  onChange={e => setGttTargetPct(Number(e.target.value))}
                  className={clsx("w-16 border px-1 text-xs outline-none", gttTarget ? "border-[#ccc] bg-white" : "border-[#eee] bg-finance-panel opacity-50")} 
                />
                <span className="text-xs text-[#888]">%</span>
              </div>
            )}

            {/* Footer Buttons */}
            <div className="mt-auto pt-4 border-t border-[#ccc] flex justify-between items-center bg-finance-panel -mx-4 -mb-4 px-4 py-3">
              <div className="flex items-center gap-4 text-xs text-[#555]">
                 <span>Margin Req: <span className="text-[#4a90e2] font-bold">₹{requiredMarginVal.toFixed(2)}</span></span>
                 <div className="border border-black px-2 py-1 bg-white font-bold text-black flex items-center gap-1">
                   Available <span className={clsx((Number(availableMargin) || 0) < requiredMarginVal ? "text-red-500" : "text-[#4a90e2]")}>
                     ₹{(Number(availableMargin) || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}
                   </span>
                 </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className={clsx("px-8 py-1.5 font-bold rounded-sm text-sm transition-colors", btnBg, "hover:opacity-90")}>
                  {type === 'BUY' ? 'Buy' : 'Sell'}
                </button>
                <button type="button" onClick={closeOrderModal} className="px-6 py-1.5 font-bold bg-white border border-[#ccc] text-[#333] hover:bg-[#e6e6e6] rounded-sm text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </form>

        </div>

        {/* Right Pane - Market Depth */}
        <div className="flex-2 bg-[#fcfcfc] flex flex-col">
           {/* Close Button Header */}
           <div className="flex justify-end bg-finance-panel border-b border-[#ccc] px-2 py-1 h-11 items-center">
             <button onClick={closeOrderModal} className="text-[#888] hover:text-black transition-colors">
               <X size={18} />
             </button>
           </div>
           
           <div className="p-3 bg-finance-panel border-b border-[#eee] text-sm text-[#333] font-semibold">
             Market depth
           </div>

           <div className="p-2">
             <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
               <thead>
                 <tr className="text-[#888] border-b border-[#eee]">
                   <th className="text-left font-normal pb-1 w-[16%]">Bid</th>
                   <th className="text-right font-normal pb-1 w-[16%]">Orders</th>
                   <th className="text-right font-normal pb-1 w-[18%]">Qty.</th>
                   <th className="text-left font-normal pb-1 w-[16%] pl-2">Offer</th>
                   <th className="text-right font-normal pb-1 w-[16%]">Orders</th>
                   <th className="text-right font-normal pb-1 w-[18%]">Qty.</th>
                 </tr>
               </thead>
               <tbody>
                 {depth.map((row, i) => (
                   <tr key={i} className="border-b border-[#eee] hover:bg-gray-50">
                     <td className="text-[#4a90e2] py-1">{row.bid.toFixed(2)}</td>
                     <td className="text-[#4a90e2] text-right">{row.bidOrders}</td>
                     <td className="text-[#4a90e2] text-right font-bold relative">
                       {/* Mock Depth Bar background */}
                       <div className="absolute inset-y-0 right-0 bg-[#4a90e2]/10" style={{ width: `${Math.random()*60 + 20}%`}}></div>
                       <span className="relative z-10 pr-1">{row.bidQty.toLocaleString('en-IN')}</span>
                     </td>
                     <td className="text-[#e24a4a] py-1 pl-2">{row.offer.toFixed(2)}</td>
                     <td className="text-[#e24a4a] text-right">{row.offerOrders}</td>
                     <td className="text-[#e24a4a] text-right font-bold relative">
                       {/* Mock Depth Bar background */}
                       <div className="absolute inset-y-0 right-0 bg-[#e24a4a]/10" style={{ width: `${Math.random()*60 + 20}%`}}></div>
                       <span className="relative z-10 pr-1">{row.offerQty.toLocaleString('en-IN')}</span>
                     </td>
                   </tr>
                 ))}
               </tbody>
               <tfoot>
                 <tr className="border-t border-[#eee]">
                   <td className="text-[#4a90e2] py-2">Total</td>
                   <td></td>
                   <td className="text-[#4a90e2] text-right font-bold pr-1">{totalBidQty.toLocaleString('en-IN')}</td>
                   <td className="text-[#e24a4a] py-2 pl-2">Total</td>
                   <td></td>
                   <td className="text-[#e24a4a] text-right font-bold pr-1">{totalOfferQty.toLocaleString('en-IN')}</td>
                 </tr>
               </tfoot>
             </table>
           </div>

        </div>
      </div>
    </div>
  );
};
