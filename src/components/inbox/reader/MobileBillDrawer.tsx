import { ChevronUp, X } from "lucide-react";
import { motion as Motion, useReducedMotion } from "motion/react";
import ActualRecordWorkspace from "./ActualRecordWorkspace";
import type { Dispatch, SetStateAction } from "react";
import type { InboxEmailLike } from "../inboxTypes";
import type { BillResolutionState, EmailBodyState, ReaderSurfaceProps } from "./readerTypes";
import { heightTransition, motionDuration, motionTransition } from "../../../lib/motion";

// The shared Actual record workspace in a mobile sheet. Expansion stays with
// the reader so it persists across open/close.
export default function MobileBillDrawer({
  email,
  open,
  billExpanded,
  setBillExpanded,
  bodyState,
  billResolution,
  onClose,
  onOpenRecordedBill,
}: {
  email: InboxEmailLike;
  open: boolean;
  billExpanded: boolean;
  setBillExpanded: Dispatch<SetStateAction<boolean>>;
  bodyState: EmailBodyState;
  billResolution: BillResolutionState;
  onClose: () => void;
  onOpenRecordedBill: ReaderSurfaceProps["onOpenRecordedBill"];
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const billPanelHeight = billExpanded ? "52%" : "38%";

  return (
    <Motion.div
      data-testid="inbox-mobile-bill-panel"
      role="region"
      aria-label="Actual record"
      initial={reduceMotion ? false : { height: 0, minHeight: 0, opacity: 0, y: 16 }}
      animate={{
        height: open ? billPanelHeight : 0,
        minHeight: open ? 220 : 0,
        opacity: open ? 1 : 0,
        y: reduceMotion || open ? 0 : 16,
      }}
      transition={heightTransition(reduceMotion)}
      aria-hidden={!open}
      inert={!open ? true : undefined}
      style={{
        flexShrink: 0,
        maxHeight: "58%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        borderTop: "1px solid color-mix(in srgb, var(--sp-green) 18%, transparent)",
        background: "color-mix(in srgb, var(--sp-panel) 98%, transparent)",
        boxShadow: "0 -12px 28px rgba(0,0,0,0.28)",
      }}
    >
      <div
        style={{
          padding: "10px 14px 8px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.8,
              textTransform: "uppercase",
              color: "var(--sp-green)",
            }}
          >
            Actual record
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            aria-label={billExpanded ? "Collapse Actual record" : "Expand Actual record"}
            onClick={() => setBillExpanded((value) => !value)}
            className="mobile-bill-drawer-toggle"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 8px",
              minHeight: "var(--sp-touch-min)",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "rgba(205,214,244,0.72)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            <Motion.span
              aria-hidden="true"
              animate={{ rotate: billExpanded && !reduceMotion ? 180 : 0 }}
              transition={motionTransition(reduceMotion, motionDuration.feedback)}
              style={{ display: "inline-flex" }}
            >
              <ChevronUp size={12} />
            </Motion.span>
            {billExpanded ? "Less" : "More"}
          </button>
          <button type="button" onClick={onClose} aria-label="Close Actual record"
            className="mobile-reader-icon-button mobile-bill-drawer-toggle">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: "10px 14px 16px",
        }}
      >
        <ActualRecordWorkspace
          email={email}
          bodyState={bodyState}
          billResolution={billResolution}
          isMobile
          onOpenRecordedBill={onOpenRecordedBill}
        />
      </div>
    </Motion.div>
  );
}
