import { describe, expect, it } from "vitest";
import { validateCalendarRange } from "./calendar-range-model.ts";

describe("validateCalendarRange", () => {
  it("reports the existing missing-start validation message", () => {
    expect(validateCalendarRange({ end: "2026-04-25" })).toEqual({
      ok: false,
      message: "start param required (YYYY-MM-DD)",
    });
  });

  it("reports the existing missing-end validation message", () => {
    expect(validateCalendarRange({ start: "2026-04-18" })).toEqual({
      ok: false,
      message: "end param required (YYYY-MM-DD)",
    });
  });

  it("rejects malformed ISO date keys", () => {
    expect(validateCalendarRange({ start: "not-a-date", end: "2026-04-25" })).toEqual({
      ok: false,
      message: "start/end must be YYYY-MM-DD",
    });
  });

  it("rejects impossible date values", () => {
    expect(validateCalendarRange({ start: "2026-13-01", end: "2026-04-25" })).toEqual({
      ok: false,
      message: "invalid date value",
    });
  });

  it("rejects a range whose end precedes its start", () => {
    expect(validateCalendarRange({ start: "2026-04-25", end: "2026-04-18" })).toEqual({
      ok: false,
      message: "end must be >= start",
    });
  });

  it("rejects ranges longer than 62 days", () => {
    expect(validateCalendarRange({ start: "2026-01-01", end: "2026-12-31" })).toEqual({
      ok: false,
      message: "span must be <= 62 days",
    });
  });

  it("returns parsed dates for a valid range", () => {
    expect(validateCalendarRange({ start: "2026-04-18", end: "2026-04-25" })).toEqual({
      ok: true,
      value: {
        start: "2026-04-18",
        end: "2026-04-25",
        startDate: new Date("2026-04-18T12:00:00.000Z"),
        endDate: new Date("2026-04-25T12:00:00.000Z"),
      },
    });
  });

  it("rejects ranges entirely before the rolling 12-month history window", () => {
    expect(validateCalendarRange(
      { start: "2025-04-01", end: "2025-05-02" },
      { enforceHistoryWindow: true, now: new Date("2026-05-03T19:00:00.000Z") },
    )).toEqual({
      ok: false,
      message: "range must overlap the rolling 12-month calendar window",
    });
  });

  it("returns minDate when a spillover range overlaps the history window", () => {
    const result = validateCalendarRange(
      { start: "2025-04-27", end: "2025-05-04" },
      { enforceHistoryWindow: true, now: new Date("2026-05-03T19:00:00.000Z") },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        start: "2025-04-27",
        end: "2025-05-04",
        minDate: "2025-05-03",
      },
    });
  });
});
