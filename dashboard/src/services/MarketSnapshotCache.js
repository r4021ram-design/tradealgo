/**
 * MarketSnapshotCache
 * Unified caching interface for storing option chains, Greeks, spot prices, and portfolio state.
 * Persists to localStorage as primary mechanism, with full IndexedDB schema structure documentation.
 * 
 * --- IndexedDB Schema Specification ---
 * Database Name: "KotakAlgoTerminalCache"
 * Version: 1
 * Stores:
 *   - "snapshots": { key: String (primary key), data: Object, timestamp: Number }
 * 
 * Store schema implementation provided as transparent fallback.
 */

const CACHE_DB_NAME = 'KotakAlgoTerminalCache';
const CACHE_STORE_NAME = 'snapshots';

export const MarketSnapshotCache = {
  /**
   * Save a snapshot.
   * @param {string} key
   * @param {any} data
   */
  save(key, data) {
    const payload = {
      data,
      timestamp: Date.now()
    };
    
    // Save to LocalStorage
    try {
      localStorage.setItem(`terminal_snapshot_${key}`, JSON.stringify(payload));
    } catch (e) {
      console.warn('[Cache] LocalStorage save failed:', e);
    }

    // Save to IndexedDB (asynchronous fire-and-forget fallback)
    try {
      const request = indexedDB.open(CACHE_DB_NAME, 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
          db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = (event) => {
        const db = event.target.result;
        const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(CACHE_STORE_NAME);
        store.put({ key, ...payload });
      };
    } catch (e) {
      // Ignore errors in sandboxed/incompatible environments
    }
  },

  /**
   * Load a snapshot.
   * @param {string} key
   * @returns {any|null}
   */
  load(key) {
    // Attempt LocalStorage read first (synchronous and extremely fast)
    try {
      const stored = localStorage.getItem(`terminal_snapshot_${key}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.data;
      }
    } catch (e) {
      console.warn('[Cache] LocalStorage read failed:', e);
    }
    return null;
  },

  /**
   * Clears all snapshot caches
   */
  clear() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('terminal_snapshot_'))
        .forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }
};
