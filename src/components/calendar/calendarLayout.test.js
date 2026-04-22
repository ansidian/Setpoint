import { describe, expect, it } from "vitest";
import { BREAKPOINTS, getCalendarLayoutMetrics } from "./calendarLayout.js";

describe("BREAKPOINTS", () => {
  it("exposes the calendar responsive breakpoints", () => {
    expect(BREAKPOINTS).toEqual({
      xl: 1800,
      lg: 1400,
      md: 1240,
    });
  });
});

describe("getCalendarLayoutMetrics", () => {
  it("selects tiers at and just below each breakpoint", () => {
    expect(getCalendarLayoutMetrics(1800).tier).toBe("xl");
    expect(getCalendarLayoutMetrics(1799).tier).toBe("lg");
    expect(getCalendarLayoutMetrics(1400).tier).toBe("lg");
    expect(getCalendarLayoutMetrics(1399).tier).toBe("md");
    expect(getCalendarLayoutMetrics(1240).tier).toBe("md");
    expect(getCalendarLayoutMetrics(1239).tier).toBe("sm");
  });

  it("returns xl metrics for very wide desktop viewports", () => {
    expect(getCalendarLayoutMetrics(1900)).toEqual({
      tier: "xl",
      viewportMargin: 40,
      shellMaxWidth: 1560,
      shellMaxHeight: "calc(100vh - 56px)",
      shellPadding: 32,
      contentGap: 28,
      gridGap: 8,
      weekHeaderGap: 6,
      railWidth: 420,
      cellHeight: 108,
      railHeightOffset: 84,
      stacked: false,
      stickyRail: true,
      headerWrap: false,
    });
  });

  it("returns lg metrics for 16-inch desktop viewports", () => {
    expect(getCalendarLayoutMetrics(1512)).toEqual({
      tier: "lg",
      viewportMargin: 32,
      shellMaxWidth: 1400,
      shellMaxHeight: "calc(100vh - 44px)",
      shellPadding: 28,
      contentGap: 24,
      gridGap: 6,
      weekHeaderGap: 5,
      railWidth: 380,
      cellHeight: 96,
      railHeightOffset: 72,
      stacked: false,
      stickyRail: true,
      headerWrap: false,
    });
  });

  it("returns md metrics when the layout stacks", () => {
    expect(getCalendarLayoutMetrics(1240)).toEqual({
      tier: "md",
      viewportMargin: 24,
      shellMaxWidth: 1180,
      shellMaxHeight: "calc(100vh - 36px)",
      shellPadding: 20,
      contentGap: 18,
      gridGap: 5,
      weekHeaderGap: 4,
      railWidth: 0,
      cellHeight: 82,
      railHeightOffset: 50,
      stacked: true,
      stickyRail: false,
      headerWrap: true,
    });
  });

  it("returns sm metrics for compact viewports", () => {
    expect(getCalendarLayoutMetrics(900)).toEqual({
      tier: "sm",
      viewportMargin: 16,
      shellMaxWidth: 960,
      shellMaxHeight: "calc(100vh - 24px)",
      shellPadding: 16,
      contentGap: 16,
      gridGap: 4,
      weekHeaderGap: 4,
      railWidth: 0,
      cellHeight: 72,
      railHeightOffset: 42,
      stacked: true,
      stickyRail: false,
      headerWrap: true,
    });
  });
});
