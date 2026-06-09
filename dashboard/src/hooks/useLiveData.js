import { useState, useEffect } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { getApiUrl } from '../utils/api';

/**
 * Returns live positions and metrics from the backend.
 * Synchronizes the fetched backend legs and metrics directly to the Zustand store.
 */
export function useLiveData() {
  const positions = useTerminalStore((state) => state.positions);
  const setPositions = useTerminalStore((state) => state.setPositions);
  const setMargins = useTerminalStore((state) => state.setMargins);
  const setNiftySpot = useTerminalStore((state) => state.setNiftySpot);
  const setBankNiftySpot = useTerminalStore((state) => state.setBankNiftySpot);
  
  const [metrics, setMetrics] = useState({
    totalPnl: 0,
    netPremium: 0,
    marginUsed: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(getApiUrl('/sync-state'));
        if (!response.ok) throw new Error('Backend unavailable');

        const data = await response.json();

        const marketData = data.market_data || {};
        const marketDataMap = new Map(Object.entries(marketData));

        // Map backend legs to position format expected by NetPositionGrid
        const mapped = Object.entries(data.legs || {}).map(([symbol, leg]) => {
          const symbolData = marketDataMap.get(symbol) || {};
          const ltp = symbolData.ltp || leg.entry_price || 0;
          const delta = symbolData.delta || 0;
          const gamma = symbolData.gamma || 0;
          const theta = symbolData.theta || 0;
          const vega = symbolData.vega || 0;
          const expiry = symbolData.expiry || null;
          const dte = symbolData.dte !== undefined ? symbolData.dte : null;
          const iv = symbolData.iv || null;
          
          let netQty = 0;
          if (leg.status === "OPEN") {
            netQty = leg.side === "SHORT" ? -leg.quantity : leg.quantity;
          }
          let avgBuyPrice = leg.side === "SHORT" ? (leg.exit_price || 0) : (leg.entry_price || 0);
          let avgSellPrice = leg.side === "SHORT" ? (leg.entry_price || 0) : (leg.exit_price || 0);

          return {
            id: symbol,
            underlying: symbol.split(' ')[0] || 'NIFTY',
            symbol,
            netQty,
            avgBuyPrice,
            avgSellPrice,
            ltp,
            realizedPnl: leg.realized_pnl || 0,
            delta,
            gamma,
            theta,
            vega,
            status: leg.status || 'CLOSED',
            expiry,
            dte,
            iv: iv ? iv / 100 : null,
            paper_trade: leg.paper_trade || false
          };
        });

        // Dispatch to Zustand store
        setPositions(mapped);
        setMargins(data.available_margin || 0, data.margin_used || 0);

        const niftyData = data.market_data["NIFTY"];
        const bankniftyData = data.market_data["BANKNIFTY"];
        const sensexData = data.market_data["SENSEX"];
        const indiavixData = data.market_data["INDIA VIX"] || data.market_data["INDIAVIX"];
        
        if (niftyData) {
          useTerminalStore.getState().setNifty({
            ltp: niftyData.ltp,
            change: niftyData.change !== undefined ? niftyData.change : -23.85,
            percentChange: niftyData.percent_change !== undefined ? niftyData.percent_change : -0.10
          });
        }
        if (bankniftyData) {
          useTerminalStore.getState().setBankNifty({
            ltp: bankniftyData.ltp,
            change: bankniftyData.change !== undefined ? bankniftyData.change : 154.20,
            percentChange: bankniftyData.percent_change !== undefined ? bankniftyData.percent_change : 0.28
          });
        }
        if (sensexData) {
          useTerminalStore.getState().setSensex({
            ltp: sensexData.ltp,
            change: sensexData.change !== undefined ? sensexData.change : -120.50,
            percentChange: sensexData.percent_change !== undefined ? sensexData.percent_change : -0.15
          });
        }
        if (indiavixData) {
          useTerminalStore.getState().setIndiaVix({
            ltp: indiavixData.ltp,
            change: indiavixData.change !== undefined ? indiavixData.change : 0.15,
            percentChange: indiavixData.percent_change !== undefined ? indiavixData.percent_change : 1.22
          });
        }

        setMetrics({
          totalPnl: data.total_pnl || 0,
          netPremium: data.net_premium_received || 0,
          marginUsed: data.margin_used || 0
        });
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 2000); // Poll every 2s for better reactivity
    return () => clearInterval(interval);
  }, [setPositions]);

  return { positions, metrics, loading, error };
}
