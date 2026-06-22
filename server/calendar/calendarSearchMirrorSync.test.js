import { describe, it, expect } from "vitest";
import { addMonthsIso, calendarSearchMirrorWindow } from "./calendarSearchMirrorSync.js";

describe("addMonthsIso (P3-40 month-end clamp)", () => {
  it("clamps an overflowing day-of-month to the target month's last day", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2024-01-31", 1)).toBe("2024-02-29"); // leap February
    expect(addMonthsIso("2026-05-31", 18)).toBe("2027-11-30"); // lands in 30-day November
  });
  it("leaves non-overflowing dates unchanged", () => {
    expect(addMonthsIso("2026-05-12", 18)).toBe("2027-11-12");
    expect(addMonthsIso("2026-05-12", -12)).toBe("2025-05-12");
  });
});

describe("calendarSearchMirrorWindow", () => {
  it("spans -12mo history to +18mo future around the Pacific 'today'", () => {
    expect(calendarSearchMirrorWindow({ now: new Date("2026-05-12T19:00:00.000Z") }))
      .toEqual({ start: "2025-05-12", end: "2027-11-12" });
  });
});
