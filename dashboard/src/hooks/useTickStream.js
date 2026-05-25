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
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  useEffect(() => {
    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[TickStream] Connected to live feed');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.symbol && data.ltp !== undefined) {
            updateTick(data.symbol, data.ltp);
            updateMarketWatchTick(data.symbol, data);
          }
        } catch (err) {
          // Silently ignore malformed messages
        }
      };

      ws.onclose = () => {
        console.log('[TickStream] Disconnected. Reconnecting in 5s...');
        reconnectTimerRef.current = setTimeout(connect, 5000);
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
};
