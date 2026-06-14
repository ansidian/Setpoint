export const BREAKPOINTS = {
  uhd: 2560,
  xl: 1800,
  lg: 1400,
  md: 1240,
};

const LAYOUT_METRICS = Object.freeze({
  uhd: Object.freeze({
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
  }),
  xl: Object.freeze({
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
  }),
  lg: Object.freeze({
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
  }),
  md: Object.freeze({
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
  }),
  sm: Object.freeze({
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
  }),
});

export function getCalendarLayoutMetrics(viewportWidth) {
  if (viewportWidth >= BREAKPOINTS.uhd) return LAYOUT_METRICS.uhd;
  if (viewportWidth >= BREAKPOINTS.xl) return LAYOUT_METRICS.xl;
  if (viewportWidth >= BREAKPOINTS.lg) return LAYOUT_METRICS.lg;
  if (viewportWidth >= BREAKPOINTS.md) return LAYOUT_METRICS.md;
  return LAYOUT_METRICS.sm;
}

export function getCalendarSearchLayoutMode(layout, searchOpen = false) {
  if (!searchOpen) return "standard";
  if (layout.stacked) return "stacked-replaces-agenda";
  return layout.tier === "uhd" || layout.tier === "xl" || layout.tier === "lg"
    ? "three-rail"
    : "search-replaces-agenda";
}
