import AnimatedRailContent from "./AnimatedRailContent";
import type { ReactNode, RefObject } from "react";
import type { CalendarLayoutTier } from "./calendarCellItemMetrics";

export interface CalendarModalContextRailProps {
  contextRailRef: RefObject<HTMLElement | null>;
  layout: {
    stacked: boolean;
    stickyRail: boolean;
    tier: CalendarLayoutTier;
  };
  workspaceMode: string;
  contentKind: string;
  contentKey: string;
  contextContent: ReactNode;
}

export default function CalendarModalContextRail({
  contextRailRef,
  layout,
  workspaceMode,
  contentKind,
  contentKey,
  contextContent,
}: CalendarModalContextRailProps) {
  return (
    <aside
      ref={contextRailRef}
      data-testid="calendar-modal-rail"
      data-context-mode={workspaceMode}
      style={{
        position: layout.stacked ? "relative" : layout.stickyRail ? "sticky" : "relative",
        top: 0,
        minHeight: 0,
        height: layout.stacked ? "auto" : "100%",
        background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <AnimatedRailContent contentKind={contentKind} contentKey={contentKey} layoutTier={layout.tier}>
        {workspaceMode === "editor" ? (
          <div
            data-testid="calendar-modal-editor-expanded"
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {contextContent}
          </div>
        ) : contextContent}
      </AnimatedRailContent>
    </aside>
  );
}
