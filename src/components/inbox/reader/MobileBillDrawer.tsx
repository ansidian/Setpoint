import { ChevronUp } from "lucide-react";
import { motion as Motion, useReducedMotion } from "motion/react";
import BillBadge from "../../bills/BillBadge";
import { resolveBillExtractionBody } from "./billExtractionBody";
import { formatBillAmount, resolveBillSeed } from "./billSeedModel";
import type { Dispatch, SetStateAction } from "react";
import type { InboxEmailLike } from "../inboxTypes";
import type { BillResolutionState, EmailBodyState } from "./readerTypes";
import { asBillCandidate } from "./readerTypes";
import { motionDuration, motionTransition } from "../../../lib/motion";

// Mobile slide-up bill-pay sheet with an expand/collapse affordance. Extracted
// from MobileReader; expand state is owned by the parent (so it persists across
// open/close), while the seed/extraction/height derivations live here.
export default function MobileBillDrawer({
  email,
  open,
  billExpanded,
  setBillExpanded,
  bodyState,
  billResolution,
}: {
  email: InboxEmailLike;
  open: boolean;
  billExpanded: boolean;
  setBillExpanded: Dispatch<SetStateAction<boolean>>;
  bodyState: EmailBodyState;
  billResolution: BillResolutionState;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const extractionBody = resolveBillExtractionBody(bodyState);
  const extractedBill = asBillCandidate(email.extractedBill);
  const billSeed = resolveBillSeed(billResolution, extractedBill);
  const billPanelHeight = billExpanded ? "52%" : "38%";

  return (
    <Motion.div
      data-testid="inbox-mobile-bill-panel"
      initial={reduceMotion ? false : { height: 0, minHeight: 0, opacity: 0, y: 16 }}
      animate={{
        height: open ? billPanelHeight : 0,
        minHeight: open ? 220 : 0,
        opacity: open ? 1 : 0,
        y: reduceMotion || open ? 0 : 16,
      }}
      transition={motionTransition(reduceMotion, open ? motionDuration.panel : motionDuration.exit)}
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
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
          <button
            type="button"
            aria-label={billExpanded ? "Collapse bill pay" : "Expand bill pay"}
            onClick={() => setBillExpanded((value) => !value)}
            className="mobile-bill-drawer-handle"
            style={{
              width: 44,
              height: "var(--sp-touch-min)",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: 0,
              display: "grid",
              placeItems: "center",
            }}
          >
            <span
              className="mobile-bill-drawer-handle-indicator"
              aria-hidden="true"
              style={{ width: 36, height: 6, borderRadius: 999, background: "rgba(255,255,255,0.16)" }}
            />
          </button>
        </div>
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
            Bill pay
          </span>
          {extractedBill?.amount != null && (
            <span
              style={{
                fontSize: 11,
                color: "rgba(205,214,244,0.62)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatBillAmount(extractedBill.amount)}
            </span>
          )}
          {extractedBill?.due_date && (
            <>
              <span style={{ color: "var(--color-text-faint)" }}>·</span>
              <span style={{ fontSize: 11, color: "rgba(205,214,244,0.62)" }}>
                Due {extractedBill.due_date}
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
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
        <BillBadge
          layout="mobile"
          bill={billSeed}
          model={email.billModel}
          emailSubject={email.subject || ""}
          emailFrom={email.from || ""}
          emailBody={extractionBody.body}
          emailBodyLoading={extractionBody.loading}
          emailBodySource={extractionBody.source}
          emailBodyError={extractionBody.error}
          mapping={billResolution?.mapping}
          mappingLoading={billResolution?.status === "loading"}
        />
      </div>
    </Motion.div>
  );
}
