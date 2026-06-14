import { fetchCalendar } from "../../calendar/calendar.js";

const calendarProvider = {
  key: "calendar_current",
  cacheTtlMs: 5 * 60 * 1000,
  fallbackPayload: () => [],
  hasUsablePayload: (payload) => Array.isArray(payload),
  async fetchFresh(_userId, config) {
    const calendarAccounts = (config.accounts || []).filter(
      (account) => account.type === "gmail" && account.calendar_enabled,
    );
    return fetchCalendar(calendarAccounts);
  },
};

export default calendarProvider;
