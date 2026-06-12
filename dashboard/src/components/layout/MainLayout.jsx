import React from 'react';
import { TopBar } from './TopBar';
import { MarketStatusBanner } from './MarketStatusBanner';

export const MainLayout = ({ children }) => {
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-white text-black select-none">
      <TopBar />
      <MarketStatusBanner />
      {children}
    </div>
  );
};
