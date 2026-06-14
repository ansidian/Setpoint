import { describe, expect, it, vi } from "vitest";

import {
  calendarContentSignature,
  currentToBriefing,
  currentToLiveData,
  hasActiveRefreshWork,
  stabilizeCalendar,
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

  it("reuses the prior calendar reference when contents are equivalent across refetches", () => {
    const prev = [
      { id: "event-1", startMs: 1000, endMs: 2000 },
      { id: "event-2", startMs: 3000, endMs: 4000 },
    ];
    // A freshly-parsed array with identical contents (new object identities).
    const nextEqual = [
      { id: "event-1", startMs: 1000, endMs: 2000 },
      { id: "event-2", startMs: 3000, endMs: 4000 },
    ];
    expect(stabilizeCalendar(prev, nextEqual)).toBe(prev);

    // A genuine content change must adopt the new reference.
    const nextChanged = [
      { id: "event-1", startMs: 1000, endMs: 2000 },
      { id: "event-2", startMs: 3000, endMs: 5000 },
    ];
    expect(stabilizeCalendar(prev, nextChanged)).toBe(nextChanged);

    // Identical reference passes through untouched.
    expect(stabilizeCalendar(prev, prev)).toBe(prev);
  });

  it("falls back to identity-derived signature keys when events lack an id", () => {
    const a = [{ startMs: 10, endMs: 20, iCalUID: "uid-a" }];
    const b = [{ startMs: 10, endMs: 20, iCalUID: "uid-a" }];
    const c = [{ startMs: 10, endMs: 20, iCalUID: "uid-b" }];
    expect(calendarContentSignature(a)).toBe(calendarContentSignature(b));
    expect(calendarContentSignature(a)).not.toBe(calendarContentSignature(c));
    expect(calendarContentSignature(null)).toBe("null");
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
