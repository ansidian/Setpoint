import type { ReactNode, RefObject } from "react";
import CalendarModalTexture from "./CalendarModalTexture";

interface CalendarModalFrameLayout {
  panelWidth: number | string;
  panelMaxWidth?: number | string | null;
  shellMaxHeight?: number | string | null;
  shellPadding: number;
  contentGap: number;
}

interface CalendarModalFrameProps {
  refs: {
    panelRef: RefObject<HTMLDivElement | null>;
    scrollRef: RefObject<HTMLDivElement | null>;
  };
  layout: CalendarModalFrameLayout;
  suppressFocusRing: boolean;
  children: ReactNode;
}

export default function CalendarModalFrame({
  refs: { panelRef, scrollRef },
  layout: { panelWidth, panelMaxWidth, shellMaxHeight, shellPadding, contentGap },
  suppressFocusRing,
  children,
}: CalendarModalFrameProps) {
  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        isolation: "isolate",
        contain: "layout paint style",
        overflow: "hidden",
      }}
    >
      <div
        ref={panelRef}
        data-testid="calendar-modal-panel"
        data-calendar-suppress-focus-ring={suppressFocusRing ? "true" : undefined}
        className="isolate flex flex-col"
        aria-labelledby="calendar-modal-title"
        tabIndex={-1}
        style={{
          position: "relative",
          zIndex: 1,
          // In-flow tab fill: flex:1 + minHeight:0 size the panel to the column's
          // height; width/maxWidth cap it and margin:0 auto centers it horizontally.
          flex: 1,
          minHeight: 0,
          width: panelWidth,
          maxWidth: panelMaxWidth || undefined,
          margin: "0 auto",
          maxHeight: shellMaxHeight || undefined,
          overflow: "hidden",
          backgroundColor: "var(--sp-panel)",
          backgroundImage: [
            "radial-gradient(circle at top left, color-mix(in srgb, var(--sp-accent) 14%, transparent), transparent 30%)",
            "radial-gradient(circle at 86% 8%, color-mix(in srgb, var(--sp-blue) 8%, transparent), transparent 24%)",
            "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01) 18%, rgba(255,255,255,0.01) 82%, rgba(255,255,255,0.025))",
          ].join(", "),
          border: "1px solid rgba(255,255,255,0.06)",
          outline: "none",
          contain: "layout paint",
          backfaceVisibility: "hidden",
          transform: "translate3d(0, 0, 0)",
        }}
      >
        <CalendarModalTexture />
        <div
          ref={scrollRef}
          className="flex-1"
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            gap: contentGap,
            minHeight: 0,
            height: "100%",
            padding: shellPadding,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
