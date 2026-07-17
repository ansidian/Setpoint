import { describe, expect, it } from "vitest";
import {
  topmostVisibleDate,
  isNearBoundary,
} from "./agendaScrollModel";

describe("agendaScrollModel", () => {
  describe("topmostVisibleDate", () => {
    const headers = [
      { date: "2026-01-15", top: 0 },
      { date: "2026-01-16", top: 120 },
      { date: "2026-01-17", top: 280 },
      { date: "2026-01-18", top: 400 },
    ];

    it("returns the first date when scroll is at the top", () => {
      expect(topmostVisibleDate(0, 0, headers)).toBe("2026-01-15");
    });

    it("returns the date whose header is at or above the active line", () => {
      expect(topmostVisibleDate(150, 0, headers)).toBe("2026-01-16");
    });

    it("returns the last date whose header is at or above the active line", () => {
      expect(topmostVisibleDate(280, 0, headers)).toBe("2026-01-17");
    });

    it("accounts for viewport offset in the active line", () => {
      // activeLine = scrollTop + viewportTop = 100 + 30 = 130
      // Header at 120 is at or below 130 → "2026-01-16"
      expect(topmostVisibleDate(100, 30, headers)).toBe("2026-01-16");
    });

    it("returns the last date when scrolled past all headers", () => {
      expect(topmostVisibleDate(500, 0, headers)).toBe("2026-01-18");
    });

    it("returns the first date when active line is before all headers", () => {
      const offsetHeaders = [
        { date: "2026-03-01", top: 50 },
        { date: "2026-03-02", top: 150 },
      ];
      expect(topmostVisibleDate(0, 0, offsetHeaders)).toBe("2026-03-01");
    });

    it("handles a single header", () => {
      const single = [{ date: "2026-05-01", top: 0 }];
      expect(topmostVisibleDate(100, 0, single)).toBe("2026-05-01");
    });

    it("returns the correct date at exact header boundary", () => {
      expect(topmostVisibleDate(120, 0, headers)).toBe("2026-01-16");
    });
  });

  describe("isNearBoundary", () => {
    const loaded = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];

    it("returns true when topmost date is in the first loaded month", () => {
      expect(isNearBoundary("2026-01-15", loaded, 2)).toBe(true);
    });

    it("returns true when within threshold of the start boundary", () => {
      expect(isNearBoundary("2026-02-10", loaded, 2)).toBe(true);
    });

    it("returns false when in the middle beyond threshold", () => {
      expect(isNearBoundary("2026-03-05", loaded, 2)).toBe(false);
    });

    it("returns true when within threshold of the end boundary", () => {
      expect(isNearBoundary("2026-04-20", loaded, 2)).toBe(true);
    });

    it("returns true when topmost date is in the last loaded month", () => {
      expect(isNearBoundary("2026-05-01", loaded, 2)).toBe(true);
    });

    it("returns true when topmost date is outside loaded range entirely", () => {
      expect(isNearBoundary("2025-12-15", loaded, 2)).toBe(true);
    });

    it("handles year boundary in loaded months", () => {
      const crossYear = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];
      expect(isNearBoundary("2025-11-20", crossYear, 2)).toBe(true);
      expect(isNearBoundary("2026-01-15", crossYear, 2)).toBe(false);
      expect(isNearBoundary("2026-03-10", crossYear, 2)).toBe(true);
    });

    it("handles threshold of 1", () => {
      expect(isNearBoundary("2026-01-15", loaded, 1)).toBe(true);
      expect(isNearBoundary("2026-02-10", loaded, 1)).toBe(false);
      expect(isNearBoundary("2026-04-20", loaded, 1)).toBe(false);
      expect(isNearBoundary("2026-05-01", loaded, 1)).toBe(true);
    });

    it("handles a single loaded month", () => {
      expect(isNearBoundary("2026-03-15", ["2026-03"], 2)).toBe(true);
    });
  });
});
