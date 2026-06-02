/**
 * Shared utility for parsing Kotak Neo / NSE trading symbols.
 * Supports weekly, monthly options, and futures.
 * Includes holiday shifting logic for 2026.
 */

const HOLIDAYS_2026 = new Set([
  "2026-01-15", "2026-01-26", "2026-03-03", "2026-03-26", "2026-03-31",
  "2026-04-03", "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-26",
  "2026-09-14", "2026-10-02", "2026-10-20", "2026-11-10", "2026-11-24",
  "2026-12-25"
]);

const shiftExpiryDate = (dt) => {
  while (true) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const dtStr = `${y}-${m}-${d}`;
    const dayOfWeek = dt.getDay(); // 0 = Sunday, 6 = Saturday
    
    if (dayOfWeek === 0 || dayOfWeek === 6 || HOLIDAYS_2026.has(dtStr)) {
      dt.setDate(dt.getDate() - 1);
    } else {
      break;
    }
  }
  return dt;
};

export const parseOptionSymbol = (symbol) => {
  if (!symbol) return { underlying: '', expiry: '-', strike: '-', type: '-', dte: null, expDate: 'N/A' };
  const clean = symbol.replace(/\s+/g, '').toUpperCase();
  
  // Match standard option format: [SYMBOL][MIDDLE][CE|PE]
  const match = clean.match(/^([A-Z]+)(\d+.*)(CE|PE)$/);
  if (!match) {
    // Match standard future format: [SYMBOL][MIDDLE][FUT]
    const futMatch = clean.match(/^([A-Z]+)(\d+[A-Z]{3})(FUT)$/);
    if (futMatch) {
      return {
        underlying: futMatch[1],
        expiry: futMatch[2],
        strike: '-',
        type: 'FUT',
        dte: null,
        expDate: 'N/A'
      };
    }
    return { underlying: symbol, expiry: '-', strike: '-', type: 'EQ', dte: null, expDate: 'N/A' };
  }
  
  const underlying = match[1];
  const middle = match[2];
  const type = match[3];
  const typeFull = type === 'CE' ? 'Call' : 'Put';
  
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  let monthName = '';
  let monthIdx = -1;
  for (let m of months) {
    const idx = middle.indexOf(m);
    if (idx !== -1) {
      monthIdx = idx;
      monthName = m;
      break;
    }
  }
  
  const now = new Date();
  
  if (monthIdx === -1) {
    // Weekly format (e.g. 2660224000) -> 26 (Year), 6 (Month: June), 02 (Day), 24000 (Strike)
    const weeklyMatch = middle.match(/^(\d{2})([0-9A-Z])(\d{2})([\d\.]+)$/);
    if (weeklyMatch) {
      const year = parseInt('20' + weeklyMatch[1]);
      const monthChar = weeklyMatch[2];
      let monthVal = 0;
      if (monthChar === 'O') monthVal = 9;
      else if (monthChar === 'N') monthVal = 10;
      else if (monthChar === 'D') monthVal = 11;
      else monthVal = parseInt(monthChar) - 1;
      
      const day = parseInt(weeklyMatch[3]);
      const strike = parseFloat(weeklyMatch[4]);
      
      const d = new Date(year, monthVal, day, 15, 30, 0);
      const shiftedD = shiftExpiryDate(d);
      const expDate = shiftedD.toISOString().split('T')[0];
      const dte = Math.max(0, Math.ceil((shiftedD - now) / (1000 * 60 * 60 * 24)));
      
      let mName = months[monthVal];
      
      return {
        underlying,
        expiry: `${day} ${mName} ${year}`,
        expiryStr: middle.substring(0, 5),
        expDate,
        dte,
        strike,
        type
      };
    }
    return { underlying, expiry: middle, strike: '-', type };
  }
  
  // Monthly format (e.g. 26JUN24000)
  const yearStr = middle.substring(0, monthIdx);
  const afterMonth = middle.substring(monthIdx + 3);
  const digitsOnly = afterMonth.replace(/\D/g, '');
  
  let day = null;
  let strikeStr = afterMonth;
  if (digitsOnly.length >= 7) {
    day = parseInt(digitsOnly.substring(0, 2));
    strikeStr = afterMonth.substring(2);
  }
  
  const strike = parseFloat(strikeStr);
  const year = parseInt('20' + yearStr);
  const monthVal = months.indexOf(monthName);
  
  let expDate = '';
  let dte = null;
  
  // Special exception for May 2026 SENSEX/BANKEX contracts expiring on May 27 due to holiday on May 28
  let adjustedDay = day;
  if (year === 2026 && monthVal === 4) { // May is 4 (0-indexed)
    if (underlying === 'SENSEX' || underlying === 'BANKEX') {
      if (adjustedDay === null || adjustedDay === 28 || adjustedDay === 29) {
        adjustedDay = 27;
      }
    }
  }

  if (adjustedDay !== null) {
    const d = new Date(year, monthVal, adjustedDay, 15, 30, 0);
    const shiftedD = shiftExpiryDate(d);
    expDate = shiftedD.toISOString().split('T')[0];
    dte = Math.max(0, Math.ceil((shiftedD - now) / (1000 * 60 * 60 * 24)));
  } else {
    // Monthly option: last Tuesday of the month (last Thursday for SENSEX/BANKEX)
    const lastDay = new Date(year, monthVal + 1, 0).getDate();
    const targetDay = (underlying === 'SENSEX' || underlying === 'BANKEX') ? 4 : 2; // 4 is Thursday, 2 is Tuesday
    let foundDay = 0;
    for (let d = lastDay; d > lastDay - 7; d--) {
      const checkDate = new Date(year, monthVal, d);
      if (checkDate.getDay() === targetDay) {
        foundDay = d;
        break;
      }
    }
    
    // Shift monthly option if falls on Buddha Purnima holiday
    if (year === 2026 && monthVal === 4 && (underlying === 'SENSEX' || underlying === 'BANKEX') && foundDay === 28) {
      foundDay = 27;
    }
    
    const d = new Date(year, monthVal, foundDay, 15, 30, 0);
    const shiftedD = shiftExpiryDate(d);
    expDate = shiftedD.toISOString().split('T')[0];
    dte = Math.max(0, Math.ceil((shiftedD - now) / (1000 * 60 * 60 * 24)));
    adjustedDay = foundDay;
  }
  
  const displayDayStr = adjustedDay ? adjustedDay + ' ' : '';
  
  return {
    underlying,
    expiry: `${displayDayStr}${monthName} ${year}`.trim(),
    expiryStr: middle.substring(0, monthIdx + 3),
    expDate,
    dte,
    strike,
    type
  };
};
