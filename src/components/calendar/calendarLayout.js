export const BREAKPOINTS = {
  xl: 1800,
  lg: 1400,
  md: 1240,
};

export function getCalendarLayoutMetrics(viewportWidth) {
  if (viewportWidth >= BREAKPOINTS.xl) {
    const viewportMargin = 40;
    return {
      tier: "xl",
      viewportMargin,
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
    };
  }

  if (viewportWidth >= BREAKPOINTS.lg) {
    const viewportMargin = 32;
    return {
      tier: "lg",
      viewportMargin,
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
    };
  }

  if (viewportWidth >= BREAKPOINTS.md) {
    const viewportMargin = 24;
    return {
      tier: "md",
      viewportMargin,
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
    };
  }

  const viewportMargin = 16;
  return {
    tier: "sm",
    viewportMargin,
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
  };
}
