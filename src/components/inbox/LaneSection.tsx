import { memo, useEffect, useRef } from "react";
import { AnimatePresence, motion as Motion, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { LANE } from "../../lib/shell-helpers";
import { StickyHeader, LaneIcon } from "./primitives";
import type { ReactNode } from "react";
import type { InboxEmailLike } from "./inboxTypes";
import { heightTransition, motionDuration, motionTransition } from "../../lib/motion";
import InboxRowTransition from "./InboxRowTransition";

// One swimlane lane section: sticky header (icon, label, count, optional
// noise-unread pill, chevron) plus the expanded row body. Memoized as a render
// boundary so a lane with referentially-stable props can skip re-rendering when
// other lanes change. `renderRows` is passed in so the row markup stays owned by
// InboxList — callers must pass a stable renderRows (see InboxList.tsx) or this
// memo boundary is defeated.
interface LaneSectionProps {
  laneKey: string;
  emails: InboxEmailLike[];
  collapsed: boolean;
  noiseUnreadCount: number;
  onToggle: (lane: string) => void;
  renderRows: (emails: InboxEmailLike[]) => ReactNode;
}

function LaneSection({ laneKey, emails, collapsed, noiseUnreadCount, onToggle, renderRows }: LaneSectionProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const lane = LANE[laneKey] ?? LANE.fyi!;
  const previousEmails = useRef(emails);
  const arrivalHighlight = useRef<HTMLSpanElement>(null);
  const arrivalAnimation = useRef<Animation | null>(null);

  useEffect(() => {
    const previousIds = new Set(previousEmails.current.map((email) => email.id || email.uid));
    const receivedMail = emails.some((email) => !previousIds.has(email.id || email.uid));
    previousEmails.current = emails;
    if (!collapsed) {
      arrivalAnimation.current?.cancel();
    } else if (receivedMail) {
      // Read-state/optimistic refreshes must not cut short or replay the pulse.
      arrivalAnimation.current?.cancel();
      arrivalAnimation.current = arrivalHighlight.current?.animate(
        [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }],
        { duration: reduceMotion ? 240 : 520, easing: "ease" },
      ) ?? null;
    }
  }, [collapsed, emails, reduceMotion]);

  useEffect(() => () => arrivalAnimation.current?.cancel(), []);

  return (
    <InboxRowTransition>
      <StickyHeader borderColor="rgba(255,255,255,0.03)">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => onToggle(laneKey)}
          className="inbox-lane-toggle sp-focus-ring"
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            cursor: "pointer", background: "transparent", border: "none",
            fontFamily: "inherit", color: "inherit", padding: 0, position: "relative",
          }}
        >
          <span
            ref={arrivalHighlight}
            aria-hidden="true"
            style={{
              position: "absolute", inset: "-4px -6px", borderRadius: 6,
              background: lane.soft,
              boxShadow: `inset 0 0 0 1px ${lane.color}40`,
              opacity: 0, pointerEvents: "none",
            }}
          />
          <span style={{ flexShrink: 0, display: "inline-flex" }}>
            <LaneIcon laneKey={laneKey} />
          </span>
          <span
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 2,
              textTransform: "uppercase", color: laneKey === "noise" ? "var(--color-text-faint)" : lane.color,
              minWidth: 0, whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {lane.label}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 999,
              background: lane.soft, color: laneKey === "noise" ? "var(--color-text-faint)" : `${lane.color}cc`,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {emails.length}
          </span>
          {laneKey === "noise" && noiseUnreadCount > 0 && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 9,
                fontWeight: 650,
                padding: "2px 6px",
                borderRadius: 999,
                background: "rgba(205,214,244,0.07)",
                border: "1px solid rgba(205,214,244,0.12)",
                color: "rgba(205,214,244,0.58)",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {noiseUnreadCount} unread
            </span>
          )}
          <span style={{ flex: 1 }} />
          <Motion.span
            aria-hidden="true"
            animate={{ rotate: collapsed || reduceMotion ? 0 : 90 }}
            transition={motionTransition(reduceMotion, motionDuration.feedback)}
            style={{ display: "inline-flex", flexShrink: 0 }}
          >
            <ChevronRight size={12} color="rgba(205,214,244,0.4)" />
          </Motion.span>
        </button>
      </StickyHeader>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <Motion.div
            key="lane-rows"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: reduceMotion ? 1 : 0 }}
            transition={heightTransition(reduceMotion)}
            style={{ overflow: "hidden" }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              {renderRows(emails)}
            </div>
          </Motion.div>
        )}
      </AnimatePresence>
    </InboxRowTransition>
  );
}

export default memo(LaneSection);
