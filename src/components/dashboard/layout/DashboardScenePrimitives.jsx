import { motion as Motion } from "motion/react";
import {
  dashboardFadeTransition,
  dashboardSectionTransition,
  dashboardStageDelays,
} from "./dashboard-scene-tokens";

const dashboardSurfaceBackground = "linear-gradient(180deg, rgba(255,255,255,0.018) 0%, rgba(255,255,255,0.008) 100%)";
const dashboardSurfaceBorder = "1px solid rgba(255,255,255,0.05)";

export function DashboardLayoutFrame({ layoutMode, maxWidth, style, children, testId }) {
  return (
    <Motion.div
      key={layoutMode}
      data-testid={testId}
      data-layout-mode={layoutMode}
      initial={{ opacity: 0, y: 14, scale: 0.992 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        opacity: { ...dashboardFadeTransition, delay: dashboardStageDelays.hero },
        y: { ...dashboardFadeTransition, delay: dashboardStageDelays.hero },
        scale: { ...dashboardFadeTransition, delay: dashboardStageDelays.hero },
      }}
      style={{ maxWidth, margin: "0 auto", width: "100%", boxSizing: "border-box", ...style }}
    >
      {children}
    </Motion.div>
  );
}

export function DashboardSceneRegion({
  children,
  delay = 0,
  initial = { opacity: 0, y: 12, scale: 0.996 },
  layout = false,
  style,
}) {
  return (
    <Motion.div
      layout={layout}
      initial={initial}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      transition={{
        opacity: { ...dashboardFadeTransition, delay },
        y: { ...dashboardFadeTransition, delay },
        x: { ...dashboardFadeTransition, delay },
        scale: { ...dashboardFadeTransition, delay },
        ...(layout ? { layout: dashboardSectionTransition } : {}),
      }}
      style={style}
    >
      {children}
    </Motion.div>
  );
}

export function DashboardSurface({ children, isMobile = false, style }) {
  return (
    <div
      style={{
        borderRadius: isMobile ? 18 : 24,
        border: dashboardSurfaceBorder,
        background: dashboardSurfaceBackground,
        overflow: "hidden",
        isolation: "isolate",
        contain: "layout paint",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function DashboardSectionBand({ children, isMobile = false, first = false, compact = false, style }) {
  const padding = isMobile
    ? (compact ? "14px 0" : "16px 0")
    : (compact ? "16px 0" : "18px 0");

  return (
    <section
      data-dashboard-section-band=""
      style={{
        padding,
        borderTop: first ? "1px solid rgba(255,255,255,0.05)" : dashboardSurfaceBorder,
        background: "transparent",
        minWidth: 0,
        contentVisibility: "auto",
        containIntrinsicSize: "160px",
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function DashboardRailStack({ sections, compact = false, style }) {
  const items = sections.filter(Boolean);

  return (
    <div
      style={{
        paddingLeft: compact ? 18 : 24,
        minWidth: 0,
        borderLeft: "1px solid rgba(255,255,255,0.06)",
        background: "transparent",
        ...style,
      }}
    >
      {items.map((section, index) => (
        <div
          key={index}
          style={{
            padding: compact ? "16px 0" : "18px 0",
            borderTop: index === 0 ? "none" : dashboardSurfaceBorder,
            contentVisibility: "auto",
            containIntrinsicSize: "160px",
          }}
        >
          {section}
        </div>
      ))}
    </div>
  );
}

export function DashboardBodyLayout({
  layoutMode,
  isMobile = false,
  hero,
  timelinePanel,
  mobileSections = [],
  primaryRailSections = [],
  commandPrimaryRailSections = [],
  commandSecondaryRailSections = [],
}) {
  if (isMobile) {
    return (
      <DashboardLayoutFrame
        testId="dashboard-body-mobile"
        layoutMode={layoutMode}
        maxWidth={640}
        style={{ width: "100%", maxWidth: 640, margin: "0 auto", padding: "0 0 32px" }}
      >
        {hero}
        <DashboardSceneRegion
          delay={dashboardStageDelays.primary}
          initial={{ opacity: 0, y: 14, scale: 0.994 }}
          style={{ padding: "18px 16px 0", display: "flex", flexDirection: "column", gap: 0 }}
        >
          {mobileSections.filter(Boolean).map((section, index) => (
            <Motion.div
              key={index}
            >
              <DashboardSectionBand isMobile first={index === 0}>
                {section}
              </DashboardSectionBand>
            </Motion.div>
          ))}
        </DashboardSceneRegion>
        <DashboardSceneRegion
          delay={dashboardStageDelays.secondary}
          initial={{ opacity: 0, y: 12, scale: 0.996 }}
          style={{ padding: "16px 16px 0" }}
        >
          {timelinePanel}
        </DashboardSceneRegion>
      </DashboardLayoutFrame>
    );
  }

  if (layoutMode === "paper") {
    return (
      <DashboardLayoutFrame
        layoutMode={layoutMode}
        maxWidth={960}
        style={{
          padding: "0 20px 20px",
          height: "100%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {hero}
        <DashboardSceneRegion
          delay={dashboardStageDelays.primary}
          initial={{ opacity: 0, y: 16, scale: 0.994 }}
          style={{
            padding: "20px 0 0",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          {timelinePanel}
          <DashboardRailStack sections={primaryRailSections} style={{ marginTop: 2 }} />
        </DashboardSceneRegion>
      </DashboardLayoutFrame>
    );
  }

  if (layoutMode === "command") {
    return (
      <DashboardLayoutFrame
        layoutMode={layoutMode}
        maxWidth={1560}
        style={{
          padding: "0 20px 20px",
          height: "100%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {hero}
        <DashboardSceneRegion
          delay={dashboardStageDelays.primary}
          initial={{ opacity: 0, y: 16, scale: 0.994 }}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(420px, 0.72fr)",
            gap: 28,
            paddingTop: 18,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            scrollbarGutter: "stable",
            alignItems: "start",
            paddingRight: 2,
          }}
        >
          <DashboardSceneRegion
            delay={dashboardStageDelays.primary}
            initial={{ opacity: 0, x: -18, y: 8, scale: 0.996 }}
            style={{ minHeight: 0, height: "100%" }}
          >
            {timelinePanel}
          </DashboardSceneRegion>
          <DashboardSceneRegion
            delay={dashboardStageDelays.secondary}
            initial={{ opacity: 0, y: 12, scale: 0.996 }}
            style={{
              minHeight: 0,
              paddingRight: 2,
              borderLeft: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              data-testid="dashboard-command-rails"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 18,
                alignItems: "start",
                paddingLeft: 18,
                minHeight: 0,
              }}
            >
              <DashboardRailStack sections={commandPrimaryRailSections} compact style={{ paddingLeft: 0, borderLeft: "none" }} />
              <DashboardRailStack sections={commandSecondaryRailSections} compact style={{ paddingLeft: 0, borderLeft: "none" }} />
            </div>
          </DashboardSceneRegion>
        </DashboardSceneRegion>
      </DashboardLayoutFrame>
    );
  }

  return (
    <DashboardLayoutFrame
      layoutMode={layoutMode}
      maxWidth={1480}
      style={{
        padding: "0 20px 20px",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {hero}
      <DashboardSceneRegion
        delay={dashboardStageDelays.primary}
        initial={{ opacity: 0, y: 16, scale: 0.994 }}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 360px",
          gap: 28,
          paddingTop: 18,
          alignItems: "stretch",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <DashboardSceneRegion
          delay={dashboardStageDelays.primary}
          initial={{ opacity: 0, x: -12, y: 8, scale: 0.996 }}
          style={{ minHeight: 0, height: "100%" }}
        >
          {timelinePanel}
        </DashboardSceneRegion>
        <DashboardSceneRegion
          delay={dashboardStageDelays.secondary}
          initial={{ opacity: 0, x: 14, y: 10, scale: 0.996 }}
          style={{ display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", scrollbarGutter: "stable" }}
        >
          <DashboardRailStack sections={primaryRailSections} />
        </DashboardSceneRegion>
      </DashboardSceneRegion>
    </DashboardLayoutFrame>
  );
}
