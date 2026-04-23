export const BREAKPOINTS = {
  xl: 1800,
  lg: 1400,
  md: 1240,
};

export function getCalendarLayoutMetrics(viewportWidth) {
  if (viewportWidth >= BREAKPOINTS.xl) {
    const viewportMargin = 16;
    return {
      tier: "xl",
      viewportMargin,
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
    };
  }

  if (viewportWidth >= BREAKPOINTS.lg) {
    const viewportMargin = 20;
    return {
      tier: "lg",
      viewportMargin,
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
    };
  }

  if (viewportWidth >= BREAKPOINTS.md) {
    const viewportMargin = 24;
    return {
      tier: "md",
      viewportMargin,
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
    };
  }

  const viewportMargin = 16;
  return {
    tier: "sm",
    viewportMargin,
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
  };
}
