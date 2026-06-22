import { describe, expect, it } from "vitest";
import {
  BILLS_MIRROR_MAINTENANCE_TTL_MS,
  addDaysYmd,
  addMonthsYmd,
  billMirrorRefreshRange,
  currentPayloadFromOccurrences,
  isBillsMirrorMaintenanceDue,
  isoNow,
  mirrorStateFromRow,
  normalizeMirrorOccurrence,
  occurrenceFromRow,
  occurrenceMirrorArgs,
  scheduleMirrorArgs,
  todayYmd,
} from "./billsMirrorModel.js";

const NOW = new Date("2026-05-20T12:00:00-07:00");

describe("date helpers", () => {
  it("isoNow returns the ISO timestamp", () => {
    expect(isoNow(NOW)).toBe(NOW.toISOString());
  });

  it("todayYmd resolves to the Pacific calendar date", () => {
    expect(todayYmd(NOW)).toBe("2026-05-20");
  });

  it("addDaysYmd and addMonthsYmd advance a ymd in UTC", () => {
    expect(addDaysYmd("2026-05-20", 7)).toBe("2026-05-27");
    expect(addDaysYmd("2026-05-20", -30)).toBe("2026-04-20");
    expect(addMonthsYmd("2026-05-20", 18)).toBe("2027-11-20");
  });
});

describe("billMirrorRefreshRange", () => {
  it("spans 30 days back to 18 months ahead of today", () => {
    expect(billMirrorRefreshRange({ now: NOW })).toEqual({
      start: "2026-04-20",
      end: "2027-11-20",
    });
  });
});

describe("mirrorStateFromRow", () => {
  it("returns needs_sync defaults for a missing row", () => {
    expect(mirrorStateFromRow(null)).toEqual({
      state: "needs_sync",
      configured: null,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastError: null,
      pendingRefreshAt: null,
      refreshStartedAt: null,
    });
  });

  it("maps a row and coerces actual_configured via boolFromDb", () => {
    expect(mirrorStateFromRow({
      status: "current",
      actual_configured: 1,
      last_success_at: "t1",
      last_attempt_at: "t2",
      last_error: null,
      pending_refresh_at: null,
      refresh_started_at: null,
    })).toMatchObject({ state: "current", configured: true, lastSuccessAt: "t1", lastAttemptAt: "t2" });
    expect(mirrorStateFromRow({ status: "degraded", actual_configured: 0 }).configured).toBe(false);
  });
});

describe("isBillsMirrorMaintenanceDue", () => {
  const base = {
    configured: true,
    state: "current",
    pendingRefreshAt: null,
    refreshStartedAt: null,
    lastAttemptAt: NOW.toISOString(),
    lastSuccessAt: new Date(NOW.getTime() - BILLS_MIRROR_MAINTENANCE_TTL_MS - 1000).toISOString(),
  };

  it("is due for an old successful configured current mirror", () => {
    expect(isBillsMirrorMaintenanceDue(base, { now: NOW })).toBe(true);
  });

  it("is not due when unconfigured, mid-refresh, in a non-current/degraded state, or recently synced", () => {
    expect(isBillsMirrorMaintenanceDue(null, { now: NOW })).toBe(false);
    expect(isBillsMirrorMaintenanceDue({ ...base, configured: false }, { now: NOW })).toBe(false);
    expect(isBillsMirrorMaintenanceDue({ ...base, pendingRefreshAt: "t" }, { now: NOW })).toBe(false);
    expect(isBillsMirrorMaintenanceDue({ ...base, refreshStartedAt: "t" }, { now: NOW })).toBe(false);
    expect(isBillsMirrorMaintenanceDue({ ...base, state: "needs_sync" }, { now: NOW })).toBe(false);
    expect(isBillsMirrorMaintenanceDue({
      ...base,
      lastSuccessAt: new Date(NOW.getTime() - 1000).toISOString(),
    }, { now: NOW })).toBe(false);
  });

  it("backs off a degraded mirror after a recent failed attempt", () => {
    expect(isBillsMirrorMaintenanceDue({
      ...base,
      state: "degraded",
      lastAttemptAt: new Date(NOW.getTime() - 1000).toISOString(),
    }, { now: NOW })).toBe(false);
  });
});

describe("occurrenceFromRow", () => {
  it("projects a mirror row with name/payee fallbacks and bool coercion", () => {
    expect(occurrenceFromRow({
      occurrence_id: "s1:2026-05-20",
      schedule_id: "s1",
      name: "Power",
      payee: "Power Co",
      amount: "1234",
      occurrence_date: "2026-05-20",
      paid: 1,
      type: "bill",
      open_action_disabled: 0,
    })).toEqual({
      id: "s1:2026-05-20",
      scheduleId: "s1",
      name: "Power",
      payee: "Power Co",
      amount: 1234,
      next_date: "2026-05-20",
      paid: true,
      type: "bill",
      openActionDisabled: false,
    });
  });
});

describe("normalizeMirrorOccurrence", () => {
  it("keeps a composite id that already contains a colon", () => {
    expect(normalizeMirrorOccurrence({ id: "s1:2026-05-20", scheduleId: "s1", next_date: "2026-05-20" }).id)
      .toBe("s1:2026-05-20");
  });

  it("synthesizes scheduleId:date from id/schedule_id and next_date/occurrence_date", () => {
    expect(normalizeMirrorOccurrence({ scheduleId: "s1", next_date: "2026-05-20" }).id).toBe("s1:2026-05-20");
    expect(normalizeMirrorOccurrence({ schedule_id: "s2", occurrence_date: "2026-06-01" }).id).toBe("s2:2026-06-01");
  });
});

describe("mirror arg builders", () => {
  const occurrence = {
    id: "s1:2026-05-20",
    scheduleId: "s1",
    name: "Power",
    payee: "Power Co",
    amount: 1234,
    type: "bill",
    next_date: "2026-05-20",
    paid: true,
    openActionDisabled: false,
  };

  it("scheduleMirrorArgs emits the schedule-mirror column order with paid as 1/0", () => {
    expect(scheduleMirrorArgs("u1", occurrence, "ts")).toEqual([
      "u1", "s1", "Power", "Power Co", 1234, "bill", "2026-05-20", 1, JSON.stringify(occurrence), "ts",
    ]);
  });

  it("occurrenceMirrorArgs emits the occurrence-mirror column order with paid/openActionDisabled as 1/0", () => {
    expect(occurrenceMirrorArgs("u1", occurrence, "ts")).toEqual([
      "u1", "s1:2026-05-20", "s1", "2026-05-20", "Power", "Power Co", 1234, "bill", 1, 0, JSON.stringify(occurrence), "ts",
    ]);
  });
});

describe("currentPayloadFromOccurrences", () => {
  it("splits a 7-day bills window from the broader -30/+90 allSchedules window", () => {
    const occurrences = [
      { next_date: "2026-05-22" }, // within 7 days -> bills + allSchedules
      { next_date: "2026-06-15" }, // beyond 7 days, within +90 -> allSchedules only
      { next_date: "2026-04-25" }, // before today, within -30 -> allSchedules only
      { next_date: "2026-09-01" }, // beyond +90 -> neither
    ];
    const payload = currentPayloadFromOccurrences(occurrences, {
      actualConfigured: true,
      actualBudgetUrl: "https://actual.test",
      syncHealth: { state: "current" },
      now: NOW,
    });
    expect(payload.bills.map((b) => b.next_date)).toEqual(["2026-05-22"]);
    expect(payload.allSchedules.map((b) => b.next_date)).toEqual(["2026-05-22", "2026-06-15", "2026-04-25"]);
    expect(payload).toMatchObject({
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.test",
      syncHealth: { state: "current" },
      billsSyncHealth: { state: "current" },
    });
  });
});
