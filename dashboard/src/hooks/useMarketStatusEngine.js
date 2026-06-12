import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { MarketHoursEngine } from '../services/MarketHoursEngine';
import { MarketSnapshotCache } from '../services/MarketSnapshotCache';
import { getApiUrl } from '../utils/api';

/**
 * Hook to manage market status, connection monitoring, data failover, and snapshot cache sync.
 * Mount at the root level of the application.
 */
export const useMarketStatusEngine = () => {
  const store = useTerminalStore();
  const stateRef = useRef({
    marketState: store.marketState,
    wsConnectionStatus: store.wsConnectionStatus
  });

  // Keep ref synchronized
  useEffect(() => {
    stateRef.current = {
      marketState: store.marketState,
      wsConnectionStatus: store.wsConnectionStatus
    };
  }, [store.marketState, store.wsConnectionStatus]);

  // Periodic Market Clock & Status Check (1-second intervals)
  useEffect(() => {
    const evaluateMarketStatus = () => {
      const evaluation = MarketHoursEngine.isMarketOpen();
      const currentWsStatus = stateRef.current.wsConnectionStatus;

      // Update next open time
      if (evaluation.nextOpenTime) {
        store.setNextMarketOpen(
          evaluation.nextOpenTime instanceof Date 
            ? evaluation.nextOpenTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + ' ' + evaluation.nextOpenTime.toLocaleDateString('en-IN')
            : String(evaluation.nextOpenTime)
        );
      }

      if (!evaluation.marketOpen) {
        // Market is Closed or Holiday
        const closedState = evaluation.marketStatus === 'HOLIDAY' ? 'HOLIDAY' : 'MARKET_CLOSED';
        store.setMarketState(closedState);
        store.setDataSource('SNAPSHOT');
        
        // Restore snapshot cache to the store if options chain or spots are unpopulated
        if (store.optionChain.length === 0) {
          const cachedChain = MarketSnapshotCache.load('optionChain');
          if (cachedChain) store.setOptionChain(cachedChain);
        }
        if (store.nifty.ltp === 0) {
          const cachedNifty = MarketSnapshotCache.load('index_NIFTY');
          if (cachedNifty) store.setNifty(cachedNifty);
        }
        if (store.banknifty.ltp === 0) {
          const cachedBankNifty = MarketSnapshotCache.load('index_BANKNIFTY');
          if (cachedBankNifty) store.setBankNifty(cachedBankNifty);
        }
        if (store.positions.length === 0) {
          const cachedPositions = MarketSnapshotCache.load('positions');
          if (cachedPositions) store.setPositions(cachedPositions);
        }
      } else {
        // Market is Open - Evaluate Data Source Failover
        if (currentWsStatus === 'connected') {
          store.setMarketState('LIVE');
          store.setDataSource('WEBSOCKET');
          store.setLastUpdateTimestamp(new Date().toLocaleTimeString('en-IN', { hour12: false }));
        } else if (currentWsStatus === 'connecting' || currentWsStatus === 'reconnecting') {
          store.setMarketState('RECONNECTING');
          store.setDataSource('POLLING');
        } else {
          // WS Disconnected -> Fallback to REST Polling
          store.setMarketState('DELAYED');
          store.setDataSource('POLLING');
        }
      }
    };

    evaluateMarketStatus();
    const clockTimer = setInterval(evaluateMarketStatus, 1000);
    return () => clearInterval(clockTimer);
  }, [store.setMarketState, store.setDataSource, store.setNextMarketOpen, store.setLastUpdateTimestamp]);

  // Sync WebSocket ticks and poll data to Snapshot Cache when active
  useEffect(() => {
    if (store.dataSource === 'WEBSOCKET' || store.dataSource === 'POLLING') {
      if (store.optionChain && store.optionChain.length > 0) {
        MarketSnapshotCache.save('optionChain', store.optionChain);
      }
      if (store.positions && store.positions.length > 0) {
        MarketSnapshotCache.save('positions', store.positions);
      }
      if (store.nifty && store.nifty.ltp > 0) {
        MarketSnapshotCache.save('index_NIFTY', store.nifty);
      }
      if (store.banknifty && store.banknifty.ltp > 0) {
        MarketSnapshotCache.save('index_BANKNIFTY', store.banknifty);
      }
    }
  }, [store.dataSource, store.optionChain, store.positions, store.nifty, store.banknifty]);

  // REST Polling Backup Loop (Active during DELAYED / RECONNECTING states when market is open)
  useEffect(() => {
    let pollingTimer = null;

    const pollState = async () => {
      // Avoid REST polling if market is CLOSED/HOLIDAY
      const evaluation = MarketHoursEngine.isMarketOpen();
      if (!evaluation.marketOpen) return;

      try {
        const response = await fetch(getApiUrl('/sync-state'));
        if (response.ok) {
          const data = await response.json();
          // Dispatch spots, margins, and legs
          if (data.market_data) {
            const niftyData = data.market_data["NIFTY"];
            if (niftyData) {
              store.setNifty({
                ltp: niftyData.ltp,
                change: niftyData.change ?? 0,
                percentChange: niftyData.percent_change ?? 0
              });
            }
            const bankniftyData = data.market_data["BANKNIFTY"];
            if (bankniftyData) {
              store.setBankNifty({
                ltp: bankniftyData.ltp,
                change: bankniftyData.change ?? 0,
                percentChange: bankniftyData.percent_change ?? 0
              });
            }
          }
          
          if (data.legs) {
            // Map legs to store positions
            const mapped = Object.entries(data.legs).map(([symbol, leg]) => {
              const symbolData = (data.market_data && data.market_data[symbol]) || {};
              const ltp = symbolData.ltp || leg.entry_price || 0;
              const netQty = leg.status === "OPEN" ? (leg.side === "SHORT" ? -leg.quantity : leg.quantity) : 0;
              return {
                id: symbol,
                underlying: symbol.split(' ')[0] || 'NIFTY',
                symbol,
                netQty,
                avgBuyPrice: leg.buy_avg || 0,
                avgSellPrice: leg.sell_avg || 0,
                ltp,
                realizedPnl: leg.realized_pnl || 0,
                status: leg.status || 'CLOSED',
                paper_trade: leg.paper_trade || false
              };
            });
            store.setPositions(mapped);
          }

          store.setLastUpdateTimestamp(new Date().toLocaleTimeString('en-IN', { hour12: false }));
        } else {
          // If REST API fails as well, escalate to disconnected state
          if (store.wsConnectionStatus === 'disconnected') {
            store.setMarketState('DISCONNECTED');
            store.setDataSource('SNAPSHOT');
          }
        }
      } catch (err) {
        if (store.wsConnectionStatus === 'disconnected') {
          store.setMarketState('DISCONNECTED');
          store.setDataSource('SNAPSHOT');
        }
      }
    };

    const runPollingLoop = () => {
      // Only poll REST when we don't have WebSocket feed flowing and market is open
      if (store.dataSource === 'POLLING') {
        pollState();
        pollingTimer = setInterval(pollState, 3000); // 3-second REST polling interval
      }
    };

    runPollingLoop();

    return () => {
      if (pollingTimer) clearInterval(pollingTimer);
    };
  }, [store.dataSource, store.wsConnectionStatus, store.setPositions, store.setNifty, store.setBankNifty, store.setMarketState, store.setDataSource]);
};
