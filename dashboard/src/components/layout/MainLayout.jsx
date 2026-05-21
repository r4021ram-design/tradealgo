import React from 'react';
import { TopBar } from './TopBar';

export const MainLayout = ({ children }) => {
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-white text-black select-none">
      <TopBar />
      {children}
    </div>
  );
};
