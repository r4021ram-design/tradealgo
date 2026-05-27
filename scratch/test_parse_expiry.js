// Inline copy of the parseOptionSymbol function from OptionPortfolioManager.jsx
const parseOptionSymbol = (symbol) => {
  if (!symbol) return null;
  const clean = symbol.replace(/\s+/g, '').toUpperCase();
  
  // Match: [SYMBOL][EXPIRY_AND_STRIKE][CE|PE]
  const match = clean.match(/^([A-Z]+)(\d+.*)(CE|PE)$/);
  if (!match) return null;
  
  const underlying = match[1];
  const middle = match[2];
  const type = match[3] === 'CE' ? 'Call' : 'Put';
  
  // Find the 3-letter month (JAN, FEB, etc.)
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  let monthIdx = -1;
  let monthName = '';
  for (let m of months) {
    const idx = middle.indexOf(m);
    if (idx !== -1) {
      monthIdx = idx;
      monthName = m;
      break;
    }
  }
  
  if (monthIdx === -1) {
    // Try matching the weekly numeric format: NIFTY YY M DD STRIKE CE/PE
    // e.g. 2652822000 -> 26 (Year), 5 (Month), 28 (Day), 22000 (Strike)
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
      
      const now = new Date();
      const d = new Date(year, monthVal, day, 15, 30, 0);
      const expDate = d.toISOString().split('T')[0];
      const dte = Math.max(0, Math.ceil((d - now) / (1000 * 60 * 60 * 24)));
      
      return { underlying, expiryStr: middle.substring(0, 5), expDate, dte, strike, type };
    }
    return null;
  }
  
  // Parse month-based symbol
  const yearStr = middle.substring(0, monthIdx);
  const afterMonth = middle.substring(monthIdx + 3);
  
  // Count digits after the month
  const digitsOnly = afterMonth.replace(/\D/g, '');
  
  let day = null;
  let strikeStr = afterMonth;
  
  if (digitsOnly.length >= 7) {
    // First 2 digits are the day
    const dayStr = digitsOnly.substring(0, 2);
    day = parseInt(dayStr);
    strikeStr = afterMonth.substring(2);
  }
  
  const strike = parseFloat(strikeStr);
  const year = parseInt('20' + yearStr);
  const monthVal = months.indexOf(monthName);
  
  const now = new Date();
  let expDate = '';
  let dte = 7;
  
  // Special exception for May 2026 SENSEX/BANKEX contracts expiring on May 27 due to holiday on May 28
  if (year === 2026 && monthVal === 4) { // May is 4 (0-indexed)
    if (underlying === 'SENSEX' || underlying === 'BANKEX') {
      if (day === null || day === 28 || day === 29) {
        day = 27;
      }
    }
  }

  if (day !== null) {
    const d = new Date(year, monthVal, day, 15, 30, 0);
    expDate = d.toISOString().split('T')[0];
    // dte calculation
  } else {
    // Monthly option: last Tuesday of the month (last Thursday for SENSEX/BANKEX)
    const lastDay = new Date(year, monthVal + 1, 0).getDate();
    const targetDay = (underlying === 'SENSEX' || underlying === 'BANKEX') ? 4 : 2; // 4 is Thursday, 2 is Tuesday
    for (let d = lastDay; d > lastDay - 7; d--) {
      const checkDate = new Date(year, monthVal, d);
      if (checkDate.getDay() === targetDay) {
        day = d;
        break;
      }
    }
    
    // Shift monthly option if falls on Buddha Purnima holiday
    if (year === 2026 && monthVal === 4 && (underlying === 'SENSEX' || underlying === 'BANKEX') && day === 28) {
      day = 27;
    }
    
    const d = new Date(year, monthVal, day, 15, 30, 0);
    expDate = d.toISOString().split('T')[0];
  }
  
  return { underlying, expDate, strike, type };
};

const testCases = [
  { symbol: "NIFTY26MAY30700CE", expected: "2026-05-26" },
  { symbol: "BANKNIFTY26MAY65400PE", expected: "2026-05-26" },
  { symbol: "SENSEX26MAY75000CE", expected: "2026-05-27" },
  { symbol: "NIFTY26JUN65600CE", expected: "2026-06-30" },
  { symbol: "SENSEX26JUN75000CE", expected: "2026-06-25" },
  { symbol: "NIFTY2652624200CE", expected: "2026-05-26" },
  { symbol: "SENSEX26MAY2875000CE", expected: "2026-05-27" }
];

console.log("=== RUNNING FRONTEND PARSER TESTS ===");
let allPassed = true;
for (const tc of testCases) {
  const res = parseOptionSymbol(tc.symbol);
  const status = (res && res.expDate === tc.expected) ? "PASS" : "FAIL";
  console.log(`[${status}] ${tc.symbol} -> ${res ? res.expDate : 'null'} (Expected: ${tc.expected})`);
  if (!res || res.expDate !== tc.expected) {
    allPassed = false;
  }
}

if (allPassed) {
  console.log("\nALL JS TESTS PASSED!");
} else {
  console.log("\nSOME JS TESTS FAILED!");
}
