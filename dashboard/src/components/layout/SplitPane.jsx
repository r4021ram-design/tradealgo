import React from 'react';

export const SplitPane = ({ leftPane, rightPane }) => {
  return (
    <div className="flex-1 flex overflow-hidden w-full bg-white">
      {/* Left Pane: Market Watch (30% width) */}
      <div className="w-[30%] min-w-[350px] max-w-[500px] border-r border-[#ccc] flex flex-col bg-finance-panel">
        {leftPane}
      </div>
      
      {/* Right Pane: Main Grid / Orders (70% width) */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {rightPane}
      </div>
    </div>
  );
};
