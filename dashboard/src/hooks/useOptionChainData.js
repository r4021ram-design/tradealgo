import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { getApiUrl } from '../utils/api';

/**
 * Check if Indian market is currently open (9:15 AM – 3:30 PM IST, weekdays).
 */
export const isMarketOpen = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);

  const day = istTime.getUTCDay();
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  const isOpenTime = totalMinutes >= (9 * 60 + 15) && totalMinutes <= (15 * 60 + 30);
  const isWeekday = day >= 1 && day <= 5;

  return isWeekday && isOpenTime;
};

/**
 * Fetch live option chain data from the backend.
 * No mock data generation — only real NSE data or empty state.
 */
export function useOptionChainData() {
  const underlying = useTerminalStore(s => s.selectedUnderlying);
  const selectedExpiry = useTerminalStore(s => s.selectedExpiry);
  const availableUnderlyings = useTerminalStore(s => s.availableUnderlyings);
  const setAvailableUnderlyings = useTerminalStore(s => s.setAvailableUnderlyings);
  const setOptionChain = useTerminalStore(s => s.setOptionChain);
  const setSpotPrice = useTerminalStore(s => s.setSpotPrice);
  const setExpiry = useTerminalStore(s => s.setExpiry);
  const setAvailableExpiries = useTerminalStore(s => s.setAvailableExpiries);
  const setMarketWatch = useTerminalStore(s => s.setMarketWatch);

  // Fetch all underlyings once on mount
  useEffect(() => {
    const fetchUnderlyings = async () => {
      try {
        const response = await fetch(getApiUrl('/api/free/underlyings'));
        if (response.ok) {
          const data = await response.json();
          if (data.underlyings && data.underlyings.length > 0) {
            setAvailableUnderlyings(data.underlyings);
          }
        }
      } catch (err) {
        console.error('Failed to fetch underlyings:', err);
      }
    };
    fetchUnderlyings();
  }, [setAvailableUnderlyings]);

  const fetchData = async () => {
    try {
      const url = selectedExpiry 
        ? getApiUrl(`/api/free/option-chain/${underlying}?expiry=${encodeURIComponent(selectedExpiry)}`)
        : getApiUrl(`/api/free/option-chain/${underlying}`);
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 503) {
          console.warn('[OptionChain] data unavailable (market closed or broker offline)');
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      const spot = data.spotPrice;
      
      // Determine strike step dynamically from option chain difference
      let step = 50;
      if (data.optionChain && data.optionChain.length > 1) {
        step = Math.abs(data.optionChain[1].strike - data.optionChain[0].strike) || 50;
      } else {
        if (underlying === 'BANKNIFTY' || underlying === 'SENSEX') {
          step = 100;
        } else {
          step = 50;
        }
      }
      
      const atm = Math.round(spot / step) * step;

      const processedChain = data.optionChain.map(row => ({
        ...row,
        isATM: row.strike === atm,
        isITM_CE: row.strike < spot,
        isITM_PE: row.strike > spot,
      }));

      setOptionChain(processedChain);
      setSpotPrice(spot);
      setAvailableExpiries(data.expiryDates || []);

      if (underlying === 'NIFTY') {
        useTerminalStore.getState().setNiftySpot(spot);
      } else if (underlying === 'BANKNIFTY') {
        useTerminalStore.getState().setBankNiftySpot(spot);
      }

      // Update Market Watch with ATM legs and NIFTY/BANKNIFTY spots
      const atmRow = processedChain.find(r => r.isATM);
      if (atmRow) {
        const niftySpot = useTerminalStore.getState().niftySpot;
        const bankNiftySpot = useTerminalStore.getState().bankNiftySpot;
        const mw = [
          { symbol: 'NIFTY', ltp: niftySpot, change: 0.0, bidPrice: niftySpot, askPrice: niftySpot, volume: 0, oi: 0 },
          { symbol: 'BANKNIFTY', ltp: bankNiftySpot, change: 0.0, bidPrice: bankNiftySpot, askPrice: bankNiftySpot, volume: 0, oi: 0 },
          { 
            symbol: `${underlying} ATM CE`, 
            ltp: atmRow.ce.ltp, 
            bidPrice: atmRow.ce.bidPrice, 
            askPrice: atmRow.ce.askPrice, 
            oi: atmRow.ce.oi, 
            iv: atmRow.ce.iv,
            change: 0
          },
          { 
            symbol: `${underlying} ATM PE`, 
            ltp: atmRow.pe.ltp, 
            bidPrice: atmRow.pe.bidPrice, 
            askPrice: atmRow.pe.askPrice, 
            oi: atmRow.pe.oi, 
            iv: atmRow.pe.iv,
            change: 0
          }
        ];
        setMarketWatch(mw);
      }
      
      if (data.expiryDates && data.expiryDates.length > 0) {
        if (!selectedExpiry || !data.expiryDates.includes(selectedExpiry)) {
          setExpiry(data.expiryDates[0]);
        }
      }
    } catch (error) {
      console.error('[OptionChain] Fetch error:', error.message);
    }
  };

  useEffect(() => {
    fetchData(); // Initial fetch on load

    const intervalId = setInterval(() => {
      fetchData();
    }, 30000);

    return () => clearInterval(intervalId);
  }, [underlying, setOptionChain, setSpotPrice, selectedExpiry, setAvailableExpiries, setExpiry]);
}
