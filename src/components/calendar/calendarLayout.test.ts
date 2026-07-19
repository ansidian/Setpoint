import { describe, expect, it } from "vitest";
import { getCalendarLayoutMetrics, getCalendarSearchLayoutMode } from "./calendarLayout.ts";

describe("getCalendarLayoutMetrics", () => {
  it("returns stable objects while the viewport stays in the same layout tier", () => {
    expect(getCalendarLayoutMetrics(1512)).toBe(getCalendarLayoutMetrics(1400));
    expect(getCalendarLayoutMetrics(1399)).toBe(getCalendarLayoutMetrics(1240));
    expect(getCalendarLayoutMetrics(1239)).toBe(getCalendarLayoutMetrics(900));
  });

  it("selects tiers at and just below each breakpoint", () => {
    expect(getCalendarLayoutMetrics(2560).tier).toBe("uhd");
    expect(getCalendarLayoutMetrics(2559).tier).toBe("xl");
    expect(getCalendarLayoutMetrics(1800).tier).toBe("xl");
    expect(getCalendarLayoutMetrics(1799).tier).toBe("lg");
    expect(getCalendarLayoutMetrics(1400).tier).toBe("lg");
    expect(getCalendarLayoutMetrics(1399).tier).toBe("md");
    expect(getCalendarLayoutMetrics(1240).tier).toBe("md");
    expect(getCalendarLayoutMetrics(1239).tier).toBe("sm");
  });

  it.each([
    [3840, "uhd", 200, 380, 680, false],
    [1900, "xl", 186, 320, 620, false],
    [1512, "lg", 164, 296, 560, false],
    [1240, "md", 144, 272, 480, false],
    [900, "sm", 100, 0, 0, true],
  ] as const)(
    "projects the %s layout's grid and rail capacity",
    (viewportWidth, tier, cellHeight, contextWidth, editorWidth, stacked) => {
      expect(getCalendarLayoutMetrics(viewportWidth)).toMatchObject({
        tier,
        cellHeight,
        contextWidth,
        editorWidth,
        stacked,
      });
    },
  );

  it("keeps three rails only where the grid has enough room", () => {
    expect(getCalendarSearchLayoutMode(getCalendarLayoutMetrics(1900), true)).toBe("three-rail");
    expect(getCalendarSearchLayoutMode(getCalendarLayoutMetrics(1512), true)).toBe("three-rail");
    expect(getCalendarSearchLayoutMode(getCalendarLayoutMetrics(1240), true)).toBe("search-replaces-agenda");
    expect(getCalendarSearchLayoutMode(getCalendarLayoutMetrics(900), true)).toBe("stacked-replaces-agenda");
    expect(getCalendarSearchLayoutMode(getCalendarLayoutMetrics(1900), false)).toBe("standard");
  });
});
