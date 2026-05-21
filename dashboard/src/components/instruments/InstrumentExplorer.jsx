import React, { useState, useEffect } from 'react';
import { Search, Filter, Calendar, Zap, Layers } from 'lucide-react';

const InstrumentExplorer = () => {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSymbol, setFilterSymbol] = useState('NIFTY');

  useEffect(() => {
    fetchContracts();
  }, [filterSymbol]);

  const fetchContracts = async () => {
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:8000/api/contracts?symbol=${filterSymbol}`);
      const data = await response.json();
      setContracts(data);
    } catch (error) {
      console.error('Error fetching contracts:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredContracts = contracts.filter(c => 
    c.trading_symbol.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Zap className="w-5 h-5 text-indigo-500" />
            Instrument Explorer
          </h2>
          <p className="text-xs text-slate-500">Search and explore NSE F&O contracts</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder="Search symbol..."
              className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all w-full md:w-64"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <select 
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value)}
          >
            <option value="NIFTY">NIFTY</option>
            <option value="BANKNIFTY">BANKNIFTY</option>
            <option value="FINNIFTY">FINNIFTY</option>
            <option value="MIDCPNIFTY">MIDCPNIFTY</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-100">
            <tr>
              <th className="px-6 py-3">Trading Symbol</th>
              <th className="px-6 py-3">Type</th>
              <th className="px-6 py-3">Expiry</th>
              <th className="px-6 py-3">Strike</th>
              <th className="px-6 py-3">Lot Size</th>
              <th className="px-6 py-3">Token</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr>
                <td colSpan="6" className="px-6 py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    Loading instruments...
                  </div>
                </td>
              </tr>
            ) : filteredContracts.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-12 text-center text-slate-400">
                  No instruments found. Try syncing the master.
                </td>
              </tr>
            ) : (
              filteredContracts.map((contract) => (
                <tr key={contract.token} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-4 font-mono text-xs font-semibold text-slate-700">{contract.trading_symbol}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      contract.instrument_type.includes('FUT') ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
                    }`}>
                      {contract.instrument_type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-600">{contract.expiry}</td>
                  <td className="px-6 py-4 font-medium text-slate-700">{contract.strike || '-'}</td>
                  <td className="px-6 py-4 text-slate-500">{contract.lot_size}</td>
                  <td className="px-6 py-4 font-mono text-[10px] text-slate-400">{contract.token}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InstrumentExplorer;
