import React, { useEffect, useState } from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { SplitPane } from './components/layout/SplitPane';
import { MarketWatch } from './components/market-watch/MarketWatch';
import { NetPositionGrid } from './components/orders/NetPositionGrid';
import { OrderModal } from './components/orders/OrderModal';
import { useTickStream } from './hooks/useTickStream';
import { useTerminalStore } from './store/useTerminalStore';
import { useLiveData } from './hooks/useLiveData';
import { OMSDashboard } from './components/oms/OMSDashboard';
import { getApiUrl } from './utils/api';
import { Lock, Unlock, ShieldAlert, KeyRound, CheckCircle } from 'lucide-react';

function App() {
  const [isUnlocked, setIsUnlocked] = useState(() => {
    return sessionStorage.getItem('terminal_unlocked') === 'true';
  });
  
  const [pin, setPin] = useState('');
  const [backendStatus, setBackendStatus] = useState('checking'); // 'checking' | 'online' | 'offline'
  const [error, setError] = useState('');
  const [isCheckingPin, setIsCheckingPin] = useState(false);

  // Connection Watchdog
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch(getApiUrl('/health'));
        if (response.ok) {
          setBackendStatus('online');
        } else {
          setBackendStatus('offline');
        }
      } catch (err) {
        setBackendStatus('offline');
      }
    };
    
    checkConnection();
    const interval = setInterval(checkConnection, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleKeyPress = (num) => {
    setError('');
    if (pin.length < 4) {
      setPin(prev => prev + num);
    }
  };

  const handleBackspace = () => {
    setError('');
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setError('');
    setPin('');
  };

  // Auto-submit when PIN reaches 4 digits
  useEffect(() => {
    if (pin.length === 4) {
      const verifyPin = async () => {
        setIsCheckingPin(true);
        try {
          const response = await fetch(getApiUrl('/api/verify-pin'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
          });
          
          if (response.ok) {
            sessionStorage.setItem('terminal_unlocked', 'true');
            setIsUnlocked(true);
          } else {
            const data = await response.json();
            setError(data.detail || 'Invalid Trading PIN');
            setPin('');
          }
        } catch (err) {
          setError('Network error verifying PIN');
          setPin('');
        } finally {
          setIsCheckingPin(false);
        }
      };
      
      verifyPin();
    }
  }, [pin]);

  // Lock Page Keyboard support
  useEffect(() => {
    if (isUnlocked) return;
    const handleLockKeys = (e) => {
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
        handleClear();
      }
    };
    window.addEventListener('keydown', handleLockKeys);
    return () => window.removeEventListener('keydown', handleLockKeys);
  }, [isUnlocked, pin]);

  // Live trading hooks initialization (only runs once unlocked)
  return (
    <>
      {!isUnlocked ? (
        <div className="flex items-center justify-center min-h-screen bg-[#070b19] text-white p-4 font-sans relative overflow-hidden select-none">
          {/* Neon background grids */}
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-emerald-600/10 rounded-full blur-[120px]"></div>
          
          <div className="w-full max-w-md bg-[#0d1527]/70 backdrop-blur-xl border border-slate-800 p-8 rounded-2xl shadow-2xl flex flex-col items-center relative z-10">
            {/* Header Lock Icon */}
            <div className="mb-6 bg-slate-900 border border-slate-700 p-4 rounded-full shadow-inner relative group">
              <div className="absolute inset-0 bg-indigo-500/10 rounded-full blur group-hover:blur-md transition-all duration-300"></div>
              {backendStatus === 'online' ? (
                <Lock className="w-8 h-8 text-indigo-400 group-hover:scale-105 transition-transform duration-300" />
              ) : (
                <ShieldAlert className="w-8 h-8 text-rose-500 animate-pulse" />
              )}
            </div>
            
            <h1 className="text-2xl font-bold tracking-tight text-slate-100 text-center mb-1">KotakAlgo Terminal</h1>
            <p className="text-xs text-slate-400 text-center mb-6 max-w-xs">
              Please enter your 4-digit Trading PIN to unlock the live option trading system
            </p>
            
            {/* Connection Status Ribbon */}
            <div className="w-full mb-6 flex items-center justify-between px-3 py-2 bg-slate-900/60 border border-slate-800 rounded-lg text-xs">
              <span className="text-slate-400">System Gateway</span>
              <div className="flex items-center gap-1.5 font-bold">
                {backendStatus === 'checking' && (
                  <>
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                    <span className="text-amber-500">CHECKING GATEWAY...</span>
                  </>
                )}
                {backendStatus === 'online' && (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
                    <span className="text-emerald-400">GATEWAY ONLINE</span>
                  </>
                )}
                {backendStatus === 'offline' && (
                  <>
                    <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] animate-ping"></span>
                    <span className="text-rose-400">GATEWAY OFFLINE</span>
                  </>
                )}
              </div>
            </div>

            {/* Offline Helper Pane */}
            {backendStatus === 'offline' && (
              <div className="w-full mb-6 p-3 bg-rose-950/20 border border-rose-900/40 rounded-lg text-center">
                <p className="text-[11px] text-rose-300 leading-relaxed font-semibold">
                  🔴 Backend service is offline.
                </p>
                <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                  Double-click <code className="bg-slate-900 px-1 py-0.5 rounded text-indigo-300">start_trading.bat</code> in your workspace folder to start local trading services.
                </p>
              </div>
            )}

            {/* Passcode dots */}
            <div className="flex gap-4 mb-6">
              {[0, 1, 2, 3].map((idx) => (
                <div 
                  key={idx} 
                  className={`w-3.5 h-3.5 rounded-full border transition-all duration-300 ${
                    idx < pin.length 
                      ? 'bg-indigo-400 border-indigo-400 scale-110 shadow-[0_0_8px_rgba(129,140,248,0.8)]' 
                      : 'bg-transparent border-slate-700'
                  }`}
                />
              ))}
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 text-xs font-semibold text-rose-400 animate-shake">
                ⚠️ {error}
              </div>
            )}

            {/* Keypad */}
            <div className="w-full grid grid-cols-3 gap-2.5 max-w-[280px]">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  disabled={backendStatus !== 'online' || isCheckingPin}
                  onClick={() => handleKeyPress(String(num))}
                  className="h-14 bg-slate-900/40 hover:bg-slate-800/80 active:bg-slate-750 disabled:opacity-30 border border-slate-800/60 disabled:hover:bg-slate-900/40 text-slate-200 font-bold text-lg rounded-xl transition duration-150 flex items-center justify-center cursor-pointer shadow-sm hover:shadow-indigo-500/5"
                >
                  {num}
                </button>
              ))}
              <button
                disabled={backendStatus !== 'online' || isCheckingPin}
                onClick={handleClear}
                className="h-14 bg-slate-950/20 hover:bg-slate-900/50 disabled:opacity-30 border border-slate-850 text-slate-400 text-xs font-bold rounded-xl transition flex items-center justify-center cursor-pointer"
              >
                CLEAR
              </button>
              <button
                disabled={backendStatus !== 'online' || isCheckingPin}
                onClick={() => handleKeyPress('0')}
                className="h-14 bg-slate-900/40 hover:bg-slate-800/80 active:bg-slate-750 disabled:opacity-30 border border-slate-800/60 disabled:hover:bg-slate-900/40 text-slate-200 font-bold text-lg rounded-xl transition flex items-center justify-center cursor-pointer"
              >
                0
              </button>
              <button
                disabled={backendStatus !== 'online' || isCheckingPin}
                onClick={handleBackspace}
                className="h-14 bg-slate-950/20 hover:bg-slate-900/50 disabled:opacity-30 border border-slate-850 text-slate-400 text-xs font-bold rounded-xl transition flex items-center justify-center cursor-pointer"
              >
                ⌫
              </button>
            </div>
            
            <p className="text-[10px] text-slate-500 mt-6 text-center">
              Protected by military-grade TOTP MFA & Broker Risk Firewall
            </p>
          </div>
        </div>
      ) : (
        <UnlockedApp />
      )}
    </>
  );
}

// Separate component to safely avoid running active trading hooks until unlocked
function UnlockedApp() {
  useTickStream();
  useLiveData();

  const openOrderModal = useTerminalStore(state => state.openOrderModal);
  const closeOrderModal = useTerminalStore(state => state.closeOrderModal);
  const activeView = useTerminalStore(state => state.activeView);
  const fetchPaperTradeStatus = useTerminalStore(state => state.fetchPaperTradeStatus);

  useEffect(() => {
    fetchPaperTradeStatus();
  }, [fetchPaperTradeStatus]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        const state = useTerminalStore.getState();
        const atmRow = state.optionChain.find(r => r.isATM);
        if (atmRow && atmRow.ce_symbol) {
          openOrderModal('BUY', atmRow.ce_symbol, atmRow.ce?.ltp || 110.50, {
            token: atmRow.ce_token,
            exchangeSegment: atmRow.exchangeSegment || 'nse_fo',
            expiry: state.selectedExpiry,
            lotSize: atmRow.lot_size || 65
          });
        } else {
          // Fallback if option chain not loaded yet (valid active 2026-06-02 contract)
          openOrderModal('BUY', 'NIFTY2660224000CE', 110.50, { expiry: '02-Jun-2026', lotSize: 65 });
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        const state = useTerminalStore.getState();
        const atmRow = state.optionChain.find(r => r.isATM);
        if (atmRow && atmRow.pe_symbol) {
          openOrderModal('SELL', atmRow.pe_symbol, atmRow.pe?.ltp || 110.50, {
            token: atmRow.pe_token,
            exchangeSegment: atmRow.exchangeSegment || 'nse_fo',
            expiry: state.selectedExpiry,
            lotSize: atmRow.lot_size || 65
          });
        } else {
          // Fallback if option chain not loaded yet (valid active 2026-06-02 contract)
          openOrderModal('SELL', 'NIFTY2660224000PE', 110.50, { expiry: '02-Jun-2026', lotSize: 65 });
        }
      } else if (e.key === 'Escape') {
        closeOrderModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openOrderModal, closeOrderModal]);

  return (
    <MainLayout>
      {activeView === 'oms' ? <OMSDashboard /> : <NetPositionGrid />}
      <OrderModal />
    </MainLayout>
  );
}

export default App;
