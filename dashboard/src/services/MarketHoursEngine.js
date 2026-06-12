import { HolidayCalendarService } from './HolidayCalendarService';

/**
 * Calculates the next weekday/business open time starting from a given date.
 */
export const getNextOpenTime = (startDate) => {
  const d = new Date(startDate);
  // Loop up to 10 days to find the next business open day
  for (let i = 0; i < 10; i++) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    const isWeekend = day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
    if (!isWeekend && !HolidayCalendarService.isHoliday(d)) {
      d.setHours(9, 15, 0, 0);
      return d;
    }
  }
  return null;
};

export const MarketHoursEngine = {
  /**
   * Evaluates standard NSE/BSE market hours and session state.
   * @param {Date} [customTime] optional custom time for debugging
   * @returns {object} { marketOpen: boolean, marketStatus: string, nextOpenTime: Date, sessionType: string }
   */
  isMarketOpen(customTime) {
    const now = customTime ? new Date(customTime) : new Date();
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;
    
    // Check holiday list
    const isHoli = HolidayCalendarService.isHoliday(now);
    
    // Check if there is a special trading session (e.g. Muhurat trading) on this day
    const specialSession = HolidayCalendarService.getSpecialSession(now);
    
    if (specialSession) {
      const [startH, startM] = specialSession.start.split(':').map(Number);
      const [endH, endM] = specialSession.end.split(':').map(Number);
      
      const startTime = new Date(now);
      startTime.setHours(startH, startM, 0, 0);
      
      const endTime = new Date(now);
      endTime.setHours(endH, endM, 0, 0);
      
      if (now >= startTime && now < endTime) {
        return {
          marketOpen: true,
          marketStatus: 'LIVE',
          nextOpenTime: endTime,
          sessionType: specialSession.name
        };
      }
    }

    if (isWeekend || isHoli) {
      return {
        marketOpen: false,
        marketStatus: isHoli ? 'HOLIDAY' : 'MARKET_CLOSED',
        nextOpenTime: getNextOpenTime(now),
        sessionType: 'CLOSED'
      };
    }

    const hours = now.getHours();
    const minutes = now.getMinutes();
    const timeVal = hours * 100 + minutes; // e.g. 915 for 09:15

    if (timeVal < 900) {
      const todayOpen = new Date(now);
      todayOpen.setHours(9, 15, 0, 0);
      return {
        marketOpen: false,
        marketStatus: 'MARKET_CLOSED',
        nextOpenTime: todayOpen,
        sessionType: 'CLOSED'
      };
    } else if (timeVal >= 900 && timeVal < 915) {
      const todayOpen = new Date(now);
      todayOpen.setHours(9, 15, 0, 0);
      return {
        marketOpen: false,
        marketStatus: 'PRE_OPEN',
        nextOpenTime: todayOpen,
        sessionType: 'PRE_OPEN'
      };
    } else if (timeVal >= 915 && timeVal < 1530) {
      const todayClose = new Date(now);
      todayClose.setHours(15, 30, 0, 0);
      return {
        marketOpen: true,
        marketStatus: 'LIVE',
        nextOpenTime: todayClose,
        sessionType: 'NORMAL'
      };
    } else if (timeVal >= 1530 && timeVal < 1600) {
      return {
        marketOpen: false,
        marketStatus: 'POST_CLOSE',
        nextOpenTime: getNextOpenTime(now),
        sessionType: 'POST_CLOSE'
      };
    } else {
      return {
        marketOpen: false,
        marketStatus: 'MARKET_CLOSED',
        nextOpenTime: getNextOpenTime(now),
        sessionType: 'CLOSED'
      };
    }
  }
};
