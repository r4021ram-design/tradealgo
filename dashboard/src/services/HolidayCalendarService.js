/**
 * HolidayCalendarService
 * Manages the exchange holiday calendar, special trading sessions, and Muhurat trading dates.
 */

const HOLIDAYS_2026 = new Set([
  "2026-01-15", // Republic Day (adjusted or holiday)
  "2026-01-26", // Republic Day
  "2026-03-03", // Mahashivratri
  "2026-03-26", // Holi
  "2026-03-31", // Id-Ul-Fitr
  "2026-04-03", // Good Friday
  "2026-04-14", // Dr. Ambedkar Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-05-28", // Bakri Id
  "2026-06-26", // Moharram
  "2026-09-14", // Id-E-Milad
  "2026-10-02", // Mahatma Gandhi Jayanti
  "2026-10-20", // Dussehra
  "2026-11-10", // Diwali Balipratipada
  "2026-11-24", // Guru Nanak Jayanti
  "2026-12-25"  // Christmas
]);

// Special Trading Sessions (e.g. disaster recovery mock trading or Muhurat trading)
const SPECIAL_SESSIONS_2026 = {
  // Format: "YYYY-MM-DD": { start: "HH:MM", end: "HH:MM", name: "..." }
  "2026-11-08": { start: "18:00", end: "19:15", name: "Diwali Muhurat Trading" }
};

export const HolidayCalendarService = {
  /**
   * Checks if the date is a holiday.
   * @param {Date} date
   * @returns {boolean}
   */
  isHoliday(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${day}`;
    return HOLIDAYS_2026.has(dateStr);
  },

  /**
   * Checks if the date is a special session (like Muhurat trading).
   * @param {Date} date
   * @returns {object|null}
   */
  getSpecialSession(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${day}`;
    return SPECIAL_SESSIONS_2026[dateStr] || null;
  },

  /**
   * Helper to fetch holidays from backend (auto-refresh fallback)
   */
  async refreshHolidaysFromServer() {
    try {
      const response = await fetch('/api/holidays');
      if (response.ok) {
        const list = await response.json();
        if (Array.isArray(list)) {
          list.forEach(h => HOLIDAYS_2026.add(h));
        }
      }
    } catch (e) {
      console.warn('[HolidayService] Failed to auto-refresh holidays from server', e);
    }
  }
};
