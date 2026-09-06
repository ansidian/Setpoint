import { describe, expect, it } from "vitest";
import {
  formatRecurrenceSummary
} from "./calendarEditorUtils";

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
