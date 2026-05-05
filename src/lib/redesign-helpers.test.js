import { describe, it, expect } from "vitest";
import { phaseIndex, briefingPhaseLabel, greetingFor } from "./redesign-helpers";
import { greetingPools } from "./dashboard-helpers";

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
  it("returns fallback when ts is nullish", () => {
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
