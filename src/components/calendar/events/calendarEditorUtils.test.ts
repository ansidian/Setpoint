import { describe, expect, it } from "vitest";
import {
  formatDateLabel,
  formatRecurrenceSummary,
  formatScheduleSummary,
  formatTimeLabel,
  previewSegmentStyle,
} from "./calendarEditorUtils";

describe("formatDateLabel", () => {
  it("returns a placeholder when no value is given", () => {
    expect(formatDateLabel("")).toBe("Choose date");
    expect(formatDateLabel(null)).toBe("Choose date");
  });

  it("formats an ISO date in Pacific time as a short month/day/year label", () => {
    expect(formatDateLabel("2026-04-21")).toBe("Apr 21, 2026");
  });
});

describe("formatTimeLabel", () => {
  it("returns a placeholder when no value is given", () => {
    expect(formatTimeLabel("")).toBe("Choose time");
    expect(formatTimeLabel(null)).toBe("Choose time");
  });

  it("formats a 24h time string as a 12h clock label", () => {
    expect(formatTimeLabel("13:00")).toBe("1:00 PM");
    expect(formatTimeLabel("09:05")).toBe("9:05 AM");
    expect(formatTimeLabel("00:30")).toBe("12:30 AM");
  });
});

describe("formatRecurrenceSummary", () => {
  it("returns an empty string when there is no recurrence rule", () => {
    expect(formatRecurrenceSummary(null, "2026-04-21")).toBe("");
  });

  it("summarizes daily rules with and without an interval", () => {
    expect(formatRecurrenceSummary({ frequency: "daily", interval: 1 })).toBe("Every day");
    expect(formatRecurrenceSummary({ frequency: "daily", interval: 3 })).toBe("Every 3 days");
  });

  it("summarizes weekly rules across weekday lists and intervals", () => {
    expect(formatRecurrenceSummary({ frequency: "weekly", interval: 1, weekdays: [] }))
      .toBe("Every week");
    expect(formatRecurrenceSummary({ frequency: "weekly", interval: 1, weekdays: ["MO", "WE"] }))
      .toBe("Every Mon, Wed");
    expect(formatRecurrenceSummary({ frequency: "weekly", interval: 2, weekdays: [] }))
      .toBe("Every 2 weeks");
    expect(formatRecurrenceSummary({ frequency: "weekly", interval: 2, weekdays: ["FR"] }))
      .toBe("Every 2 weeks on Fri");
  });

  it("summarizes monthly rules with an ordinal anchor derived from the start date", () => {
    expect(formatRecurrenceSummary({ frequency: "monthly", interval: 1 }, "2026-04-21"))
      .toBe("Monthly on the 21st");
    expect(formatRecurrenceSummary({ frequency: "monthly", interval: 3 }, "2026-04-01"))
      .toBe("Every 3 months on the 1st");
    expect(formatRecurrenceSummary({ frequency: "monthly", interval: 1 }, null))
      .toBe("Monthly");
  });

  it("summarizes yearly rules with a month/day anchor from the start date", () => {
    expect(formatRecurrenceSummary({ frequency: "yearly", interval: 1 }, "2026-04-21"))
      .toBe("Yearly on April 21");
    expect(formatRecurrenceSummary({ frequency: "yearly", interval: 2 }, "2026-04-21"))
      .toBe("Every 2 years on April 21");
    expect(formatRecurrenceSummary({ frequency: "yearly", interval: 1 }, null))
      .toBe("Yearly");
  });

  it("returns an empty string for unrecognized frequencies", () => {
    expect(formatRecurrenceSummary({ frequency: "hourly", interval: 1 })).toBe("");
  });
});

describe("formatScheduleSummary", () => {
  it("falls back when the draft has no start date", () => {
    expect(formatScheduleSummary({}, "No schedule")).toBe("No schedule");
    expect(formatScheduleSummary(null, "No schedule")).toBe("No schedule");
  });

  it("renders a single-day timed range", () => {
    expect(
      formatScheduleSummary(
        { startDate: "2026-04-21", endDate: "2026-04-21", startTime: "13:00", endTime: "13:30" },
        "fallback",
      ),
    ).toBe("Apr 21, 2026 · 1:00 PM to 1:30 PM");
  });

  it("renders a multi-day date range", () => {
    expect(
      formatScheduleSummary(
        { startDate: "2026-04-21", endDate: "2026-04-23", startTime: "13:00", endTime: "13:30" },
        "fallback",
      ),
    ).toBe("Apr 21, 2026 to Apr 23, 2026 · 1:00 PM to 1:30 PM");
  });

  it("marks an all-day draft instead of showing times", () => {
    expect(
      formatScheduleSummary(
        { startDate: "2026-04-21", endDate: "2026-04-21", allDay: true },
        "fallback",
      ),
    ).toBe("Apr 21, 2026 · All day");
  });

  it("renders only the start time when no end time is set", () => {
    expect(
      formatScheduleSummary(
        { startDate: "2026-04-21", endDate: "2026-04-21", startTime: "13:00" },
        "fallback",
      ),
    ).toBe("Apr 21, 2026 · 1:00 PM");
  });
});

describe("previewSegmentStyle", () => {
  it("lets the schedule segment wrap and stay fully visible", () => {
    expect(previewSegmentStyle("schedule")).toEqual({
      overflow: "visible",
      textOverflow: "clip",
      whiteSpace: "normal",
      maxWidth: "100%",
      fontWeight: 600,
    });
  });

  it("truncates non-schedule segments to a capped width", () => {
    expect(previewSegmentStyle("repeat")).toEqual({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      maxWidth: "min(190px, 100%)",
      fontWeight: 500,
    });
  });

  it("keeps the conflict segment bold while still truncating it", () => {
    const style = previewSegmentStyle("conflict");
    expect(style.fontWeight).toBe(600);
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.maxWidth).toBe("min(190px, 100%)");
  });
});
