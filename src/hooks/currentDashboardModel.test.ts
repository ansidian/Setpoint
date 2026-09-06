import { describe, expect, it, vi } from "vitest";
import type { CurrentDashboardResponse } from "../../shared/types/dashboard";
import type { ActiveSnapshotView } from "../../shared/types/snapshots";

import {
  calendarContentSignature,
  currentToBriefing,
  currentToLiveDataBulk,
  deadlineContentSignature,
  hasActiveRefreshWork,
  mergeActiveSnapshotIntoCurrent,
  stabilizeCalendar,
  stabilizeDeadlines,
} from "./currentDashboardModel";

const asCurrentDashboard = (value: unknown): CurrentDashboardResponse => value as CurrentDashboardResponse;
const asActiveSnapshot = (value: unknown): ActiveSnapshotView => value as ActiveSnapshotView;

describe("current dashboard model", () => {
  it("replaces only the active snapshot and invalidates the envelope content fingerprint", () => {
    const current = {
      weather: { temp: 72 },
      bills: [{ id: "bill-1" }],
      activeSnapshot: { snapshot: { id: 1 } },
      contentKey: "stale-content-key",
      fetchedAt: "2026-07-14T12:00:00.000Z",
    };
    const activeSnapshot = { snapshot: { id: 2 }, lanes: { queued: [] } };

    expect(mergeActiveSnapshotIntoCurrent(
      asCurrentDashboard(current),
      asActiveSnapshot(activeSnapshot),
    )).toEqual({
      ...current,
      activeSnapshot,
      contentKey: null,
    });
    expect(mergeActiveSnapshotIntoCurrent(null, asActiveSnapshot(activeSnapshot))).toBeNull();
  });

  it("projects the current dashboard envelope into domain-shaped briefing data", () => {
    expect(currentToBriefing(asCurrentDashboard({
      weather: { temp: 72 },
      calendar: [{ id: "event-1" }],
      deadlines: {
        upcoming: [{ id: "deadline-1" }],
        stats: { total: 1 },
      },
    }))).toEqual({
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
    expect(currentToLiveDataBulk(asCurrentDashboard({
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
    }), { refreshNow })).toMatchObject({
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

  it("changes the deadline content signature when status, due_date, _completing, or length differ", () => {
    const base = [{ id: "deadline-1", due_date: "2026-05-05", due_time: "11:59p", status: "incomplete" }];
    const differentStatus = [{ ...base[0], status: "complete" }];
    const differentDueDate = [{ ...base[0], due_date: "2026-05-06" }];
    const completing = [{ ...base[0], _completing: true }];
    const longer = [...base, { id: "deadline-2", due_date: "2026-05-07", status: "incomplete" }];

    const baseSig = deadlineContentSignature(base);
    expect(deadlineContentSignature(differentStatus)).not.toBe(baseSig);
    expect(deadlineContentSignature(differentDueDate)).not.toBe(baseSig);
    expect(deadlineContentSignature(completing)).not.toBe(baseSig);
    expect(deadlineContentSignature(longer)).not.toBe(baseSig);
  });

  it("falls back to todoist_id and handles null/invalid input like calendarContentSignature", () => {
    const a = [{ todoist_id: "todo-1", due_date: "2026-05-05", status: "incomplete" }];
    const b = [{ todoist_id: "todo-1", due_date: "2026-05-05", status: "incomplete" }];
    const c = [{ todoist_id: "todo-2", due_date: "2026-05-05", status: "incomplete" }];
    expect(deadlineContentSignature(a)).toBe(deadlineContentSignature(b));
    expect(deadlineContentSignature(a)).not.toBe(deadlineContentSignature(c));
    expect(deadlineContentSignature(null)).toBe("null");
    expect(deadlineContentSignature(undefined)).toBe("null");
    expect(deadlineContentSignature("nope")).toBe("invalid");
  });

  it("reuses the prior deadlines reference when contents are equivalent across polls", () => {
    const prev = [{ id: "deadline-1", due_date: "2026-05-05", due_time: "11:59p", status: "incomplete" }];
    // A freshly re-parsed array with identical contents (new object identities).
    const nextEqual = [{ id: "deadline-1", due_date: "2026-05-05", due_time: "11:59p", status: "incomplete" }];
    expect(stabilizeDeadlines(prev, nextEqual)).toBe(prev);

    // A genuine content change must adopt the new reference.
    const nextChanged = [{ id: "deadline-1", due_date: "2026-05-05", due_time: "11:59p", status: "complete" }];
    expect(stabilizeDeadlines(prev, nextChanged)).toBe(nextChanged);

    // Identical reference passes through untouched.
    expect(stabilizeDeadlines(prev, prev)).toBe(prev);
  });

  it("detects active current refresh work across source and snapshot health", () => {
    const now = Date.now();
    expect(hasActiveRefreshWork({ providerHealth: { currentData: { sources: [
      { state: "degraded", refreshStartedAt: new Date(now - 1_000).toISOString() },
    ] } } })).toBe(true);
    expect(hasActiveRefreshWork({ providerHealth: { currentData: { sources: [
      { state: "degraded", refreshStartedAt: new Date(now - 121_000).toISOString() },
    ] } } })).toBe(false);
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
