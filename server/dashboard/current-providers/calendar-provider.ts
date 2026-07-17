import { fetchCalendar } from "../../calendar/calendar.ts";
import type { StoredCalendarAccount } from "../../calendar/calendar-google-client.ts";
import type { CurrentDashboardProvider } from "../current-types.ts";

const calendarProvider: CurrentDashboardProvider = {
  key: "calendar_current",
  cacheTtlMs: 5 * 60 * 1000,
  fallbackPayload: () => [],
  hasUsablePayload: (payload) => Array.isArray(payload),
  async fetchFresh(_userId, config) {
    const calendarAccounts = (config.accounts || []).filter(
      (account) => account.type === "gmail" && account.calendar_enabled,
    );
    return fetchCalendar(calendarAccounts as unknown as StoredCalendarAccount[]);
  },
};

export default calendarProvider;
