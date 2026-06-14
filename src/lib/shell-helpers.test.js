import { describe, it, expect } from "vitest";
import { phaseIndex, briefingPhaseLabel, greetingFor, dueDateToMs, buildTimeline, deriveLane } from "./shell-helpers";
import { greetingPools } from "./dashboard-helpers";

const iso = (ms) => new Date(ms).toISOString();

// Helper: construct a Pacific-time Date at a given hour on a fixed day.
function atHourPacific(hour) {
  // 2026-04-17 08:00 Pacific == 15:00 UTC (DST in effect → UTC-7).
  // We just build an ISO instant and let phaseIndex re-read the Pacific hour.
  const utcHour = hour + 7;
  return new Date(Date.UTC(2026, 3, 17, utcHour, 0, 0));
}

describe("phaseIndex", () => {
  it("returns 0 for late-night hours (before 5 AM Pacific)", () => {
    expect(phaseIndex(atHourPacific(2))).toBe(0);
    expect(phaseIndex(atHourPacific(4))).toBe(0);
  });
  it("returns 1 for morning (5 AM – 11:59 AM Pacific)", () => {
    expect(phaseIndex(atHourPacific(5))).toBe(1);
    expect(phaseIndex(atHourPacific(11))).toBe(1);
  });
  it("returns 2 for afternoon (noon – 4:59 PM Pacific)", () => {
    expect(phaseIndex(atHourPacific(12))).toBe(2);
    expect(phaseIndex(atHourPacific(16))).toBe(2);
  });
  it("returns 3 for evening (5 PM – 8:59 PM Pacific)", () => {
    expect(phaseIndex(atHourPacific(17))).toBe(3);
    expect(phaseIndex(atHourPacific(20))).toBe(3);
  });
  it("returns 4 for night (9 PM onward Pacific)", () => {
    expect(phaseIndex(atHourPacific(21))).toBe(4);
    expect(phaseIndex(atHourPacific(23))).toBe(4);
  });
});

describe("briefingPhaseLabel", () => {
  it("returns the default label when ts is nullish", () => {
    expect(briefingPhaseLabel(null)).toBe("Since current snapshot");
    expect(briefingPhaseLabel(undefined)).toBe("Since current snapshot");
  });
  it("morning snapshot → 'Since this morning's snapshot'", () => {
    expect(briefingPhaseLabel(atHourPacific(8).getTime())).toBe("Since this morning's snapshot");
  });
  it("afternoon snapshot → 'Since this afternoon's snapshot'", () => {
    expect(briefingPhaseLabel(atHourPacific(14).getTime())).toBe("Since this afternoon's snapshot");
  });
  it("evening snapshot → 'Since this evening's snapshot'", () => {
    expect(briefingPhaseLabel(atHourPacific(19).getTime())).toBe("Since this evening's snapshot");
  });
  it("late-night snapshot → 'Since last night's snapshot'", () => {
    expect(briefingPhaseLabel(atHourPacific(3).getTime())).toBe("Since last night's snapshot");
  });
  it("night snapshot → 'Since tonight's snapshot'", () => {
    expect(briefingPhaseLabel(atHourPacific(22).getTime())).toBe("Since tonight's snapshot");
  });
});

describe("greetingFor — personable pools", () => {
  it("returns a phrase from the correct pool for the hour", () => {
    const { text } = greetingFor(atHourPacific(8));
    expect(greetingPools[1].greetings).toContain(text); // morning pool
  });

  it("returns the right label for each phase", () => {
    expect(greetingFor(atHourPacific(2)).label).toBe("Late night");
    expect(greetingFor(atHourPacific(8)).label).toBe("Good morning");
    expect(greetingFor(atHourPacific(14)).label).toBe("Good afternoon");
    expect(greetingFor(atHourPacific(19)).label).toBe("Good evening");
    expect(greetingFor(atHourPacific(22)).label).toBe("Tonight");
  });

  it("is stable for the same phase on the same day", () => {
    const a = greetingFor(atHourPacific(8));
    const b = greetingFor(atHourPacific(10));
    expect(a.text).toBe(b.text);
  });

  it("may change when the phase changes", () => {
    // Not strictly guaranteed (different pools), but label must differ:
    const morning = greetingFor(atHourPacific(8));
    const afternoon = greetingFor(atHourPacific(14));
    expect(morning.label).not.toBe(afternoon.label);
  });

  it("ignores the name argument (pool phrases are complete sentences)", () => {
    const a = greetingFor(atHourPacific(8), "");
    const b = greetingFor(atHourPacific(8), "Andy");
    expect(a.text).toBe(b.text);
  });
});

// dueDateToMs returns an absolute UTC instant, so these assertions are
// independent of the host's local timezone — the PST cases pin the real Pacific
// wall-clock instant the buggy fixed-7h-offset code computed one hour early.
describe("dueDateToMs (Pacific DST-correct)", () => {
  it("anchors an 11:59pm deadline to true Pacific time during PST (winter)", () => {
    // 2026-01-15 is PST (UTC-8): 11:59pm PT == 2026-01-16T07:59:00Z.
    expect(iso(dueDateToMs("2026-01-15", "11:59pm"))).toBe("2026-01-16T07:59:00.000Z");
  });

  it("buckets a small-hours deadline onto the correct Pacific day during PST", () => {
    // 12:30am PST == 2026-01-15T08:30:00Z (same calendar day in PT).
    expect(iso(dueDateToMs("2026-01-15", "12:30am"))).toBe("2026-01-15T08:30:00.000Z");
  });

  it("uses the 11:59pm Pacific fallback when due_time is missing or unparseable", () => {
    expect(iso(dueDateToMs("2026-01-15", ""))).toBe("2026-01-16T07:59:00.000Z");
    expect(iso(dueDateToMs("2026-01-15", "nonsense"))).toBe("2026-01-16T07:59:00.000Z");
  });

  it("stays exact during PDT (summer, UTC-7)", () => {
    // 11:59pm PDT == 2026-07-16T06:59:00Z.
    expect(iso(dueDateToMs("2026-07-15", "11:59pm"))).toBe("2026-07-16T06:59:00.000Z");
  });

  it("returns null for an empty date", () => {
    expect(dueDateToMs("", "5pm")).toBeNull();
  });
});

// P3-15's more exhaustive offset coverage. Both suites pass against the resolved
// dueDateToMs (shared epochFromLa) since they assert absolute UTC instants for
// Jan/Jul dates, well clear of DST transitions. Reuses the top-level `iso`.
describe("dueDateToMs — resolves the real Pacific offset (PST vs PDT)", () => {
  it("PST-season 11:59pm resolves to 23:59 PST = 07:59Z next day (UTC-8)", () => {
    // January → PST (UTC-8). 23:59 PST on Jan 15 == 07:59Z on Jan 16.
    expect(iso(dueDateToMs("2026-01-15", "11:59pm"))).toBe("2026-01-16T07:59:00.000Z");
  });

  it("PDT-season 11:59pm resolves to 23:59 PDT = 06:59Z next day (UTC-7)", () => {
    // July → PDT (UTC-7). 23:59 PDT on Jul 15 == 06:59Z on Jul 16.
    expect(iso(dueDateToMs("2026-07-15", "11:59pm"))).toBe("2026-07-16T06:59:00.000Z");
  });

  it("a daytime PST due time is an hour later in UTC than the old fixed-+7 math", () => {
    // 5pm PST on Jan 15 == 17:00 + 8 == 01:00Z next day (the +7 bug gave 00:00Z).
    expect(iso(dueDateToMs("2026-01-15", "5pm"))).toBe("2026-01-16T01:00:00.000Z");
  });

  it("the same wall-clock PDT due time stays an hour earlier in UTC", () => {
    // 5pm PDT on Jul 15 == 17:00 + 7 == 00:00Z next day.
    expect(iso(dueDateToMs("2026-07-15", "5pm"))).toBe("2026-07-16T00:00:00.000Z");
  });

  it("no due_time falls back to 11:59pm PT with the correct seasonal offset", () => {
    expect(iso(dueDateToMs("2026-01-15", null))).toBe("2026-01-16T07:59:00.000Z");
    expect(iso(dueDateToMs("2026-07-15", null))).toBe("2026-07-16T06:59:00.000Z");
  });

  it("an unparseable due_time uses the 11:59pm PT seasonal fallback", () => {
    expect(iso(dueDateToMs("2026-01-15", "EOD"))).toBe("2026-01-16T07:59:00.000Z");
  });

  it("parses minute precision and lowercases am/pm with surrounding space", () => {
    // "9:00 AM" PST == 09:00 + 8 == 17:00Z same day.
    expect(iso(dueDateToMs("2026-01-15", "9:00 AM"))).toBe("2026-01-15T17:00:00.000Z");
  });

  it("handles the am/pm 12-hour edge cases", () => {
    // 12am PST == midnight Pacific == 08:00Z same day.
    expect(iso(dueDateToMs("2026-01-15", "12am"))).toBe("2026-01-15T08:00:00.000Z");
    // 12pm PST == noon Pacific == 20:00Z same day.
    expect(iso(dueDateToMs("2026-01-15", "12pm"))).toBe("2026-01-15T20:00:00.000Z");
  });

  it("returns null for missing or non-date inputs", () => {
    expect(dueDateToMs(null, "5pm")).toBeNull();
    expect(dueDateToMs("", "5pm")).toBeNull();
    expect(dueDateToMs("not-a-date", "5pm")).toBeNull();
  });
});

describe("buildTimeline bill anchor (Pacific DST-correct)", () => {
  it("anchors a bill to ~3pm Pacific during PST", () => {
    // 3pm PST == 2026-01-15T23:00:00Z; the buggy fixed 22:00Z was 2pm PST (1h early).
    const items = buildTimeline({ bills: [{ id: "b1", next_date: "2026-01-15", amount: 10 }] });
    const bill = items.find((i) => i.kind === "bill");
    expect(iso(bill.dueAtMs)).toBe("2026-01-15T23:00:00.000Z");
  });
});

// deriveLane must understand the coarse `triage` field that DashboardBody's
// snapshot emails carry ("action"/"fyi") — without it, every dashboard inbox-peek
// email collapsed to "fyi" and the "needs you" badge stayed 0.
describe("deriveLane (snapshot triage signal)", () => {
  it("classifies a snapshot email's triage='action' as needs_attention", () => {
    expect(deriveLane({ triage: "action" })).toBe("needs_attention");
  });
  it("classifies triage='fyi' as fyi", () => {
    expect(deriveLane({ triage: "fyi" })).toBe("fyi");
  });
  it("lets an explicit lane/urgency signal win over triage", () => {
    expect(deriveLane({ lane: "noise", triage: "action" })).toBe("noise");
    expect(deriveLane({ urgency: "high", triage: "fyi" })).toBe("needs_attention");
  });
  it("falls back to fyi when nothing is set", () => {
    expect(deriveLane({})).toBe("fyi");
    expect(deriveLane(null)).toBe("fyi");
  });
});
