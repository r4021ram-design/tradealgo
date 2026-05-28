import React from 'react';
import { Segment, OptionType } from '../../engine/types';

interface FilterBarProps {
  segmentFilter: string;
  setSegmentFilter: (val: string) => void;
  expiryFilter: string;
  setExpiryFilter: (val: string) => void;
  strikeFilter: string;
  setStrikeFilter: (val: string) => void;
  optionTypeFilter: string;
  setOptionTypeFilter: (val: string) => void;
  expiries: string[];
  strikes: number[];
}

export const FilterBar: React.FC<FilterBarProps> = ({
  segmentFilter,
  setSegmentFilter,
  expiryFilter,
  setExpiryFilter,
  strikeFilter,
  setStrikeFilter,
  optionTypeFilter,
  setOptionTypeFilter,
  expiries,
  strikes,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-4 bg-slate-900 p-3 rounded-lg border border-slate-800 text-slate-200 shadow-lg mb-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400 font-medium">Segment</label>
        <select
          value={segmentFilter}
          onChange={(e) => setSegmentFilter(e.target.value)}
          className="bg-slate-850 border border-slate-750 text-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="ALL">All Segments</option>
          <option value={Segment.EQ}>Equity (EQ)</option>
          <option value={Segment.FUT}>Futures (FUT)</option>
          <option value={Segment.OPT}>Options (OPT)</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400 font-medium">Expiry</label>
        <select
          value={expiryFilter}
          onChange={(e) => setExpiryFilter(e.target.value)}
          className="bg-slate-850 border border-slate-750 text-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="ALL">All Expiries</option>
          {expiries.map((exp) => (
            <option key={exp} value={exp}>
              {exp}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400 font-medium">Strike</label>
        <select
          value={strikeFilter}
          onChange={(e) => setStrikeFilter(e.target.value)}
          className="bg-slate-850 border border-slate-750 text-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="ALL">All Strikes</option>
          {strikes.map((strike) => (
            <option key={strike} value={String(strike)}>
              {strike}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400 font-medium">Option Type</label>
        <select
          value={optionTypeFilter}
          onChange={(e) => setOptionTypeFilter(e.target.value)}
          className="bg-slate-850 border border-slate-750 text-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="ALL">All Call/Put</option>
          <option value={OptionType.CE}>CE (Call Option)</option>
          <option value={OptionType.PE}>PE (Put Option)</option>
        </select>
      </div>

      <button
        onClick={() => {
          setSegmentFilter('ALL');
          setExpiryFilter('ALL');
          setStrikeFilter('ALL');
          setOptionTypeFilter('ALL');
        }}
        className="mt-5 bg-slate-850 hover:bg-slate-750 border border-slate-750 hover:border-slate-650 text-slate-300 font-semibold px-3 py-1 text-sm rounded shadow-sm transition"
      >
        Reset Filters
      </button>
    </div>
  );
};
