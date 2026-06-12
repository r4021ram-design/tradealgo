import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { getWsUrl } from '../utils/api';
import { MarketHoursEngine } from '../services/MarketHoursEngine';

const WS_URL = getWsUrl('/ws/live-feed');

/**
 * Connects to the backend WebSocket for real-time tick data.
 * Reports connection status to Zustand store and performs exponential backoff reconnects.
 */
export const useTickStream = () => {
  const updateTick = useTerminalStore((state) => state.updateTick);
  const updateMarketWatchTick = useTerminalStore((state) => state.updateMarketWatchTick);
  
  const wsConnectionStatus = useTerminalStore((state) => state.wsConnectionStatus);
  const reconnectAttempt = useTerminalStore((state) => state.reconnectAttempt);
  
  const setWsConnectionStatus = useTerminalStore((state) => state.setWsConnectionStatus);
  const incrementReconnectAttempt = useTerminalStore((state) => state.incrementReconnectAttempt);
  const resetReconnectAttempt = useTerminalStore((state) => state.resetReconnectAttempt);

  const marketWatch = useTerminalStore((state) => state.marketWatch);
  const symbolsStr = (marketWatch || []).map(i => i.symbol).sort().join(',');
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const marketWatchRef = useRef(marketWatch);
  const attemptRef = useRef(reconnectAttempt);

  // Keep refs synchronized
  useEffect(() => {
    marketWatchRef.current = marketWatch;
  }, [marketWatch]);

  useEffect(() => {
    attemptRef.current = reconnectAttempt;
  }, [reconnectAttempt]);

  const getReconnectDelay = (attempt) => {
    const delays = [5000, 10000, 30000, 60000, 120000];
    return delays[Math.min(attempt, delays.length - 1)];
  };

  // Handle connection and message dispatch
  useEffect(() => {
    const connect = () => {
      // If market is closed, don't attempt websocket connections
      const evaluation = MarketHoursEngine.isMarketOpen();
      if (!evaluation.marketOpen) {
        setWsConnectionStatus('disconnected');
        return;
      }

      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const currentAttempt = attemptRef.current;
      setWsConnectionStatus(currentAttempt > 0 ? 'reconnecting' : 'connecting');

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[TickStream] Connected to live feed');
        setWsConnectionStatus('connected');
        resetReconnectAttempt();
        
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
        setWsConnectionStatus('disconnected');
        incrementReconnectAttempt();
        const delay = getReconnectDelay(attemptRef.current + 1);
        console.log(`[TickStream] Disconnected. Reconnecting in ${delay / 1000}s (Attempt ${attemptRef.current + 1})...`);
        
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        // Remove event handlers to avoid state updates on unmount
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
      }
    };
  }, [updateTick, updateMarketWatchTick, setWsConnectionStatus, incrementReconnectAttempt, resetReconnectAttempt]);

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
