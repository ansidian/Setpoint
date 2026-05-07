import { describe, expect, it } from "vitest";

import {
  CURRENT_CACHE_KEYS,
  fallbackPayloadForKey,
  hasUsablePayload,
  parsePayload,
  shouldPublishBillsCurrentChange,
  summarizeCurrentDataHealth,
} from "./current-sources.js";

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
      ctm: { upcoming: [], stats: null },
      todoist: { upcoming: [], stats: null },
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
        ctm: { upcoming: [] },
        todoist: { upcoming: [] },
      }),
    })).toBe(true);
    expect(hasUsablePayload("bills_current", {
      payload_json: JSON.stringify({
        bills: [],
        allSchedules: [],
        payeeMap: {},
      }),
    })).toBe(true);
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

  it("publishes bills changes only when visible bills payload or row health changes", () => {
    const previousRow = {
      status: "current",
      refresh_failure_count: 0,
      payload_json: JSON.stringify({
        bills: [{ id: "bill-1" }],
        allSchedules: [],
        payeeMap: {},
        actualConfigured: true,
        actualBudgetUrl: "https://actual.example.test",
        internalOnly: "ignored",
      }),
    };

    expect(shouldPublishBillsCurrentChange(previousRow, {
      bills: [{ id: "bill-1" }],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      internalOnly: "changed",
    })).toBe(false);

    expect(shouldPublishBillsCurrentChange(previousRow, {
      bills: [{ id: "bill-2" }],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    })).toBe(true);
    expect(shouldPublishBillsCurrentChange({ ...previousRow, status: "degraded" }, parsePayload(previousRow))).toBe(true);
  });
});
