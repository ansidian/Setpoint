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
      viewportMargin: 16,
      shellHeight: "calc(100vh - 32px)",
      shellPadding: 16,
      contentGap: 12,
      gridGap: 8,
      weekHeaderGap: 6,
      contextWidth: 320,
      editorWidth: 620,
      supportBandMinHeight: 126,
      supportBandCollapsedHeight: 60,
      cellHeight: 140,
      railHeightOffset: 92,
      stacked: false,
      stickyRail: true,
      headerWrap: false,
      headerStacked: false,
    });
  });

  it("returns lg metrics for 16-inch desktop viewports", () => {
    expect(getCalendarLayoutMetrics(1512)).toEqual({
      tier: "lg",
      viewportMargin: 20,
      shellHeight: "calc(100vh - 40px)",
      shellPadding: 14,
      contentGap: 12,
      gridGap: 6,
      weekHeaderGap: 5,
      contextWidth: 296,
      editorWidth: 560,
      supportBandMinHeight: 116,
      supportBandCollapsedHeight: 56,
      cellHeight: 124,
      railHeightOffset: 82,
      stacked: false,
      stickyRail: true,
      headerWrap: false,
      headerStacked: false,
    });
  });

  it("returns md metrics for the compact desktop workspace", () => {
    expect(getCalendarLayoutMetrics(1240)).toEqual({
      tier: "md",
      viewportMargin: 24,
      shellHeight: "calc(100vh - 48px)",
      shellPadding: 14,
      contentGap: 12,
      gridGap: 5,
      weekHeaderGap: 4,
      contextWidth: 272,
      editorWidth: 480,
      supportBandMinHeight: 106,
      supportBandCollapsedHeight: 52,
      cellHeight: 108,
      railHeightOffset: 72,
      stacked: false,
      stickyRail: true,
      headerWrap: false,
      headerStacked: false,
    });
  });

  it("returns sm metrics for compact viewports", () => {
    expect(getCalendarLayoutMetrics(900)).toEqual({
      tier: "sm",
      viewportMargin: 16,
      shellHeight: "calc(100vh - 32px)",
      shellPadding: 16,
      contentGap: 16,
      gridGap: 4,
      weekHeaderGap: 4,
      contextWidth: 0,
      editorWidth: 0,
      supportBandMinHeight: 180,
      supportBandCollapsedHeight: 104,
      cellHeight: 76,
      railHeightOffset: 48,
      stacked: true,
      stickyRail: false,
      headerWrap: true,
      headerStacked: true,
    });
  });
});
