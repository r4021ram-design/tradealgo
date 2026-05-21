import { useState, useEffect } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';

/**
 * Returns live positions and metrics from the backend.
 * Synchronizes the fetched backend legs and metrics directly to the Zustand store.
 */
export function useLiveData() {
  const positions = useTerminalStore((state) => state.positions);
  const setPositions = useTerminalStore((state) => state.setPositions);
  
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
        const response = await fetch('http://localhost:8000/sync-state');
        if (!response.ok) throw new Error('Backend unavailable');

        const data = await response.json();

        // Map backend legs to position format expected by NetPositionGrid
        const mapped = Object.entries(data.legs || {}).map(([symbol, leg]) => {
          const ltp = data.market_data[symbol]?.ltp || leg.entry_price || 0;
          const delta = data.market_data[symbol]?.delta || 0;
          const theta = data.market_data[symbol]?.theta || 0;
          
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
            theta,
            status: leg.status || 'CLOSED'
          };
        });

        // Dispatch to Zustand store
        setPositions(mapped);

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
