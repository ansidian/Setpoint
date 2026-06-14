import { describe, expect, it } from "vitest";
import { BREAKPOINTS, getCalendarLayoutMetrics, getCalendarSearchLayoutMode } from "./calendarLayout.js";

describe("BREAKPOINTS", () => {
  it("exposes the calendar responsive breakpoints", () => {
    expect(BREAKPOINTS).toEqual({
      uhd: 2560,
      xl: 1800,
      lg: 1400,
      md: 1240,
    });
  });
});

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

  it("returns uhd metrics for 4K-class desktop viewports", () => {
    expect(getCalendarLayoutMetrics(3840)).toEqual({
      tier: "uhd",
      viewportMargin: 32,
      panelWidth: "calc(100vw - 64px)",
      panelMaxWidth: null,
      shellHeight: "calc(100vh - 64px)",
      shellMaxHeight: null,
      shellPadding: 16,
      contentGap: 14,
      gridGap: 8,
      weekHeaderGap: 6,
      contextWidth: 380,
      searchWidth: 304,
      editorWidth: 680,
      cellHeight: 200,
      railHeightOffset: 92,
      stacked: false,
      stickyRail: true,
      headerWrap: false,
      headerStacked: false,
    });
  });

  it("returns xl metrics for very wide desktop viewports", () => {
    expect(getCalendarLayoutMetrics(1900)).toEqual({
      tier: "xl",
      viewportMargin: 16,
      panelWidth: null,
      panelMaxWidth: null,
      shellHeight: "calc(100vh - 32px)",
      shellMaxHeight: null,
      shellPadding: 16,
      contentGap: 12,
      gridGap: 8,
      weekHeaderGap: 6,
      contextWidth: 320,
      searchWidth: 288,
      editorWidth: 620,
      cellHeight: 186,
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
      panelWidth: null,
      panelMaxWidth: null,
      shellHeight: "calc(100vh - 40px)",
      shellMaxHeight: null,
      shellPadding: 14,
      contentGap: 12,
      gridGap: 6,
      weekHeaderGap: 5,
      contextWidth: 296,
      searchWidth: 268,
      editorWidth: 560,
      cellHeight: 164,
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
      panelWidth: null,
      panelMaxWidth: null,
      shellHeight: "calc(100vh - 48px)",
      shellMaxHeight: null,
      shellPadding: 14,
      contentGap: 12,
      gridGap: 5,
      weekHeaderGap: 4,
      contextWidth: 272,
      searchWidth: 260,
      editorWidth: 480,
      cellHeight: 144,
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
      panelWidth: null,
      panelMaxWidth: null,
      shellHeight: "calc(100vh - 32px)",
      shellMaxHeight: null,
      shellPadding: 16,
      contentGap: 16,
      gridGap: 4,
      weekHeaderGap: 4,
      contextWidth: 0,
      searchWidth: 0,
      editorWidth: 0,
      cellHeight: 100,
      railHeightOffset: 48,
      stacked: true,
      stickyRail: false,
      headerWrap: true,
      headerStacked: true,
    });
  });

  it("keeps three rails only where the grid has enough room", () => {
    expect(getCalendarSearchLayoutMode(getCalendarLayoutMetrics(1900), true)).toBe("three-rail");
    expect(getCalendarSearchLayoutMode(getCalendarLayoutMetrics(1512), true)).toBe("three-rail");
    expect(getCalendarSearchLayoutMode(getCalendarLayoutMetrics(1240), true)).toBe("search-replaces-agenda");
    expect(getCalendarSearchLayoutMode(getCalendarLayoutMetrics(900), true)).toBe("stacked-replaces-agenda");
    expect(getCalendarSearchLayoutMode(getCalendarLayoutMetrics(1900), false)).toBe("standard");
  });
});
