/**
 * Central API and WebSocket URL configuration for the tradealgo dashboard.
 * Supports dynamic configuration via Vite environment variables, falling back to localhost for local development.
 */

export const getApiUrl = (path = '') => {
  const base = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  // Strip trailing slash if present, and ensure path starts with slash
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return path ? `${normalizedBase}${normalizedPath}` : normalizedBase;
};

export const getWsUrl = (path = '/ws/live-feed') => {
  const base = import.meta.env.VITE_WS_URL;
  if (base) {
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }
  
  // Derive from VITE_API_URL if defined
  const apiBase = import.meta.env.VITE_API_URL;
  if (apiBase) {
    const wsProto = apiBase.startsWith('https://') ? 'wss://' : 'ws://';
    const host = apiBase.replace(/^https?:\/\//, '');
    const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${wsProto}${normalizedHost}${normalizedPath}`;
  }
  
  return `ws://localhost:8000${path}`;
};
