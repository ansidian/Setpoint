import { describe, expect, it, vi } from "vitest";

import {
  currentToBriefing,
  currentToLiveData,
  hasActiveRefreshWork,
} from "./currentDashboardModel.js";

describe("current dashboard model", () => {
  it("projects the current dashboard envelope into domain-shaped briefing data", () => {
    expect(currentToBriefing({
      weather: { temp: 72 },
      calendar: [{ id: "event-1" }],
      deadlines: {
        upcoming: [{ id: "deadline-1" }],
        stats: { total: 1 },
      },
    })).toEqual({
      weather: { temp: 72 },
      calendar: [{ id: "event-1" }],
      deadlines: {
        upcoming: [{ id: "deadline-1" }],
        stats: { total: 1 },
      },
      emails: { summary: "", accounts: [] },
    });
  });

  it("projects the current dashboard envelope into domain-shaped live data", () => {
    const refreshNow = vi.fn();
    expect(currentToLiveData({
      calendar: [{ id: "event-1" }],
      deadlines: {
        upcoming: [{ id: "deadline-1" }],
        stats: { total: 1 },
      },
      weather: { temp: 72 },
      bills: [{ id: "bill-1" }],
      allSchedules: [{ id: "schedule-1" }],
      payeeMap: { payee: "Payee" },
      fetchedAt: "2026-05-07T12:00:00.000Z",
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: { state: "current" },
      providerHealth: { currentData: { state: "current" } },
      systemStatus: { state: "current" },
    }, { refreshNow, isPolling: false })).toMatchObject({
      liveEmails: [],
      liveCalendar: [{ id: "event-1" }],
      liveDeadlines: {
        upcoming: [{ id: "deadline-1" }],
        stats: { total: 1 },
      },
      liveWeather: { temp: 72 },
      liveBills: [{ id: "bill-1" }],
      allSchedules: [{ id: "schedule-1" }],
      payeeMap: { payee: "Payee" },
      lastFetched: "2026-05-07T12:00:00.000Z",
      billsLoading: false,
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: { state: "current" },
      providerHealth: { currentData: { state: "current" } },
      systemStatus: { state: "current" },
      refreshNow,
    });
  });

  it("detects active current refresh work across source and snapshot health", () => {
    expect(hasActiveRefreshWork({
      providerHealth: {
        currentData: {
          sources: [{ key: "weather_current", state: "refreshing" }],
        },
      },
    })).toBe(true);
    expect(hasActiveRefreshWork({
      providerHealth: {
        activeSnapshot: { state: "syncing" },
      },
    })).toBe(true);
    expect(hasActiveRefreshWork({
      activeSnapshot: {
        processing: { active: true },
      },
    })).toBe(true);
    expect(hasActiveRefreshWork({
      providerHealth: {
        currentData: { sources: [{ key: "weather_current", state: "current" }] },
        activeSnapshot: { state: "current" },
      },
    })).toBe(false);
  });
});
