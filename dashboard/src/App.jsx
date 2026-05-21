import React, { useEffect } from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { SplitPane } from './components/layout/SplitPane';
import { MarketWatch } from './components/market-watch/MarketWatch';
import { NetPositionGrid } from './components/orders/NetPositionGrid';
import { OrderModal } from './components/orders/OrderModal';
import { useTickStream } from './hooks/useTickStream';
import { useTerminalStore } from './store/useTerminalStore';
import { useLiveData } from './hooks/useMockData';

function App() {
  // Initialize the live WebSocket tick stream
  useTickStream();
  
  // Initialize the positions and metrics polling synchronization
  useLiveData();

  const openOrderModal = useTerminalStore(state => state.openOrderModal);
  const closeOrderModal = useTerminalStore(state => state.closeOrderModal);
  const isOpen = useTerminalStore(state => state.orderModal.isOpen);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        openOrderModal('BUY', 'NIFTY 24 APR 22000 CE', 110.50);
      } else if (e.key === 'F2') {
        e.preventDefault();
        openOrderModal('SELL', 'NIFTY 24 APR 22000 CE', 110.50);
      } else if (e.key === 'Escape') {
        closeOrderModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openOrderModal, closeOrderModal]);

  return (
    <MainLayout>
      <SplitPane 
        leftPane={<MarketWatch />}
        rightPane={<NetPositionGrid />}
      />
      {/* Absolute positioned Order Modal */}
      <OrderModal />
    </MainLayout>
  );
}

export default App;
