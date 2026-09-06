import { describe, it, expect } from "vitest";
import { dueDateToMs, buildTimeline } from "./shell-helpers";

const iso = (ms: number | null) => new Date(ms!).toISOString();

// These absolute instants own Pacific wall-clock parsing across PST/PDT and
// protect the fallback used when Todoist supplies no usable due time.
describe("dueDateToMs (Pacific DST-correct)", () => {
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
    expect(iso(dueDateToMs("2026-01-15", "9:00 AM"))).toBe("2026-01-15T17:00:00.000Z");
    expect(iso(dueDateToMs("2026-01-15", "12:30am"))).toBe("2026-01-15T08:30:00.000Z");
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
    expect(iso(bill!.dueAtMs)).toBe("2026-01-15T23:00:00.000Z");
  });
});
