import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { getWsUrl } from '../utils/api';

const WS_URL = getWsUrl('/ws/live-feed');

/**
 * Connects to the backend WebSocket for real-time tick data.
 * No mock/simulated ticks — only live feed from the algo engine.
 */
export const useTickStream = () => {
  const updateTick = useTerminalStore((state) => state.updateTick);
  const updateMarketWatchTick = useTerminalStore((state) => state.updateMarketWatchTick);
  const marketWatch = useTerminalStore((state) => state.marketWatch);
  const symbolsStr = (marketWatch || []).map(i => i.symbol).sort().join(',');
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const marketWatchRef = useRef(marketWatch);

  // Keep ref updated with latest marketWatch value
  useEffect(() => {
    marketWatchRef.current = marketWatch;
  }, [marketWatch]);

  // Handle connection and message dispatch
  useEffect(() => {
    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[TickStream] Connected to live feed');
        const currentMw = marketWatchRef.current;
        if (currentMw && currentMw.length > 0) {
          const symbols = currentMw.map(i => i.symbol);
          ws.send(JSON.stringify({ action: 'subscribe', symbols }));
          console.log('[TickStream] Sent initial subscription for:', symbols);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const symbol = data.symbol || data.trading_symbol;
          if (symbol && data.ltp !== undefined) {
            updateTick(symbol, data.ltp, data);
            updateMarketWatchTick(symbol, data);
          }
        } catch (err) {
          // Silently ignore malformed messages
        }
      };

      ws.onclose = () => {
        console.log('[TickStream] Disconnected. Reconnecting in 1s...');
        reconnectTimerRef.current = setTimeout(connect, 1000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [updateTick, updateMarketWatchTick]);

  // Dynamically update subscriptions when marketWatch symbols change (debounced by 250ms)
  useEffect(() => {
    if (!symbolsStr) return;
    const symbols = symbolsStr.split(',');
    const handler = setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'subscribe', symbols }));
        console.log('[TickStream] Sent dynamic subscription update for:', symbols);
      }
    }, 250);

    return () => {
      clearTimeout(handler);
    };
  }, [symbolsStr]);
};

