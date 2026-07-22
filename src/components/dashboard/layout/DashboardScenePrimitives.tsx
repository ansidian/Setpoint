import { motion as Motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import {
  dashboardFadeTransition,
  dashboardStageDelays,
} from "./dashboard-scene-tokens";

const dashboardSurfaceBackground = "linear-gradient(180deg, rgba(255,255,255,0.018) 0%, rgba(255,255,255,0.008) 100%)";
const dashboardSurfaceBorder = "1px solid rgba(255,255,255,0.05)";

interface DashboardLayoutFrameProps {
  layoutMode: string;
  maxWidth: number;
  style?: CSSProperties;
  children: ReactNode;
  testId?: string;
}

function DashboardLayoutFrame({ layoutMode, maxWidth, style, children, testId }: DashboardLayoutFrameProps) {
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

function DashboardSceneRegion({
  children,
  delay = 0,
  initial = { opacity: 0, y: 12, scale: 0.996 },
  style,
}: {
  children: ReactNode;
  delay?: number;
  initial?: { opacity: number; x?: number; y?: number; scale?: number };
  style?: CSSProperties;
}) {
  return (
    <Motion.div
      initial={initial}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      transition={{
        opacity: { ...dashboardFadeTransition, delay },
        y: { ...dashboardFadeTransition, delay },
        x: { ...dashboardFadeTransition, delay },
        scale: { ...dashboardFadeTransition, delay },
      }}
      style={style}
    >
      {children}
    </Motion.div>
  );
}

export function DashboardSurface({ children, isMobile = false, style }: { children: ReactNode; isMobile?: boolean; style?: CSSProperties }) {
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

export function ThreeTierLayout({ isMobile = false, band, timelinePanel, contextColumn }: { isMobile?: boolean; band: ReactNode; timelinePanel: ReactNode; contextColumn: ReactNode }) {
  if (isMobile) {
    return (
      <DashboardLayoutFrame testId="dashboard-body-mobile" layoutMode="mobile" maxWidth={640}
        style={{ width: "100%", maxWidth: 640, margin: "0 auto", padding: "0 0 32px" }}>
        <DashboardSceneRegion delay={dashboardStageDelays.hero} style={{ padding: "0 16px" }}>{band}</DashboardSceneRegion>
        <DashboardSceneRegion delay={dashboardStageDelays.primary} initial={{ opacity: 0, y: 16, scale: 0.994 }} style={{ padding: "14px 16px 0" }}>{timelinePanel}</DashboardSceneRegion>
        <DashboardSceneRegion delay={dashboardStageDelays.secondary} initial={{ opacity: 0, y: 12, scale: 0.996 }} style={{ padding: "14px 16px 0" }}>{contextColumn}</DashboardSceneRegion>
      </DashboardLayoutFrame>
    );
  }
  return (
    <DashboardLayoutFrame testId="dashboard-body-desktop" layoutMode="desktop" maxWidth={1480}
      style={{ padding: "15px 18px 18px", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 14, overflow: "hidden" }}>
      <DashboardSceneRegion delay={dashboardStageDelays.hero} style={{ flex: "none" }}>{band}</DashboardSceneRegion>
      <DashboardSceneRegion delay={dashboardStageDelays.primary} initial={{ opacity: 0, y: 16, scale: 0.994 }}
        style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 344px", gap: 14, overflow: "hidden" }}>
        <DashboardSceneRegion delay={dashboardStageDelays.primary} initial={{ opacity: 0, x: -12, y: 8, scale: 0.996 }} style={{ minHeight: 0, height: "100%" }}>{timelinePanel}</DashboardSceneRegion>
        <DashboardSceneRegion delay={dashboardStageDelays.secondary} initial={{ opacity: 0, x: 14, y: 10, scale: 0.996 }} style={{ minHeight: 0, height: "100%", overflow: "hidden" }}>{contextColumn}</DashboardSceneRegion>
      </DashboardSceneRegion>
    </DashboardLayoutFrame>
  );
}
