import { describe, expect, it } from "vitest";

import {
  CURRENT_CACHE_KEYS,
  currentResponseContentKey,
  fallbackPayloadForKey,
  hasUsablePayload,
  summarizeCurrentDataHealth,
} from "./current-sources.ts";

function baseResponse() {
  return {
    weather: { temp: 72 },
    calendar: [{ id: "event-1", title: "Focus" }],
    deadlines: { upcoming: [{ id: "deadline-1" }], stats: { total: 1 } },
    bills: [{ id: "bill-1" }],
    providerHealth: {
      currentData: { state: "current" },
      todoist: { state: "current", lastSuccessAt: "2026-05-07T11:55:00.000Z", ageMs: 300_000 },
      bills: { state: "current" },
    },
    systemStatus: { state: "current", generatedAt: "2026-05-07T12:00:00.000Z" },
    refresh: { mode: "passive", scheduled: [], skipped: [] },
    fetchedAt: "2026-05-07T12:00:00.000Z",
  };
}

describe("currentResponseContentKey", () => {
  it("is stable when only the per-call wall-clock fields differ (fetchedAt, systemStatus.generatedAt, todoist.ageMs)", () => {
    const earlier = baseResponse();
    const later = {
      ...baseResponse(),
      fetchedAt: "2026-05-07T12:00:05.000Z",
      systemStatus: { state: "current", generatedAt: "2026-05-07T12:00:05.000Z" },
      providerHealth: {
        ...baseResponse().providerHealth,
        todoist: { state: "current", lastSuccessAt: "2026-05-07T11:55:00.000Z", ageMs: 305_000 },
      },
    };

    expect(currentResponseContentKey(earlier)).toBeTruthy();
    expect(currentResponseContentKey(later)).toBe(currentResponseContentKey(earlier));
  });

  it("changes when rendered data changes", () => {
    const before = baseResponse();
    const after = { ...baseResponse(), weather: { temp: 99 } };
    expect(currentResponseContentKey(after)).not.toBe(currentResponseContentKey(before));
  });

  it("changes when a provider health state changes (only ageMs is neutralized, not the whole todoist health)", () => {
    const before = baseResponse();
    const after = {
      ...baseResponse(),
      providerHealth: {
        ...baseResponse().providerHealth,
        todoist: { state: "unavailable", lastSuccessAt: null, ageMs: null },
      },
    };
    expect(currentResponseContentKey(after)).not.toBe(currentResponseContentKey(before));
  });
});

describe("current dashboard source definitions", () => {
  it("exposes the current dashboard cache source order", () => {
    expect(CURRENT_CACHE_KEYS).toEqual([
      "weather_current",
      "calendar_current",
      "deadlines_current",
      "bills_current",
    ]);
  });

  it("keeps source payload validation and fallbacks local to each source", () => {
    expect(fallbackPayloadForKey("calendar_current")).toEqual([]);
    expect(fallbackPayloadForKey("deadlines_current")).toEqual({
      upcoming: [],
      stats: null,
    });
    expect(fallbackPayloadForKey("bills_current")).toEqual({
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: false,
      actualBudgetUrl: null,
    });

    expect(hasUsablePayload("calendar_current", { payload_json: JSON.stringify([]) })).toBe(true);
    expect(hasUsablePayload("calendar_current", { payload_json: JSON.stringify({}) })).toBe(false);
    expect(hasUsablePayload("deadlines_current", {
      payload_json: JSON.stringify({
        upcoming: [],
        stats: { total: 0 },
      }),
    })).toBe(true);
    expect(hasUsablePayload("deadlines_current", {
      payload_json: JSON.stringify({ sections: [] }),
    })).toBe(false);
    expect(hasUsablePayload("bills_current", {
      payload_json: JSON.stringify({
        bills: [],
        allSchedules: [],
        payeeMap: {},
      }),
    })).toBe(true);
  });

  it("rejects legacy or malformed cached bills before they reach the dashboard", () => {
    const rowFor = (allSchedules: unknown[]) => ({
      payload_json: JSON.stringify({ bills: [], allSchedules, payeeMap: {} }),
    });

    expect(hasUsablePayload("bills_current", rowFor([
      { id: "legacy", next_date: "2026-05-10", conditions: [{ field: "amount", value: -5000 }] },
    ]))).toBe(false);
    expect(hasUsablePayload("bills_current", rowFor([
      { id: "malformed", next_date: "2026-05-10", amount: "not-a-number" },
    ]))).toBe(false);
  });

  it("summarizes current data health through source payload rules", () => {
    const now = new Date("2026-05-07T12:00:00.000Z");
    const rows = {
      weather_current: {
        payload_json: JSON.stringify({ temp: 72 }),
        fetched_at: "2026-05-07T11:55:00.000Z",
        expires_at: "2026-05-07T12:30:00.000Z",
        status: "current",
      },
      calendar_current: {
        payload_json: JSON.stringify([]),
        fetched_at: "2026-05-07T11:55:00.000Z",
        expires_at: "2026-05-07T12:30:00.000Z",
        status: "refreshing",
        refresh_started_at: "2026-05-07T11:59:00.000Z",
      },
      deadlines_current: {
        payload_json: JSON.stringify(null),
        fetched_at: "2026-05-07T11:55:00.000Z",
        expires_at: "2026-05-07T12:30:00.000Z",
        status: "current",
      },
    };

    expect(summarizeCurrentDataHealth(rows, now)).toMatchObject({
      state: "unavailable",
      sources: [
        { key: "weather_current", state: "current", severity: "none" },
        { key: "calendar_current", state: "refreshing", severity: "info" },
        { key: "deadlines_current", state: "unavailable", severity: "error" },
        { key: "bills_current", state: "unavailable", severity: "error" },
      ],
    });
  });
});
