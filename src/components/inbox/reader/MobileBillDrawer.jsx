import { ChevronDown, ChevronUp } from "lucide-react";
import BillBadge from "../../bills/BillBadge";
import { resolveBillExtractionBody } from "./billExtractionBody";
import { formatBillAmount, resolveBillSeed } from "./billSeedModel.js";

// Mobile slide-up bill-pay sheet with an expand/collapse affordance. Extracted
// from MobileReader; expand state is owned by the parent (so it persists across
// open/close), while the seed/extraction/height derivations live here.
export default function MobileBillDrawer({
  email,
  billExpanded,
  setBillExpanded,
  bodyState,
  billResolution,
}) {
  const extractionBody = resolveBillExtractionBody(bodyState);
  const billSeed = resolveBillSeed(billResolution, email.extractedBill);
  const billPanelHeight = billExpanded ? "52%" : "38%";

  return (
    <div
      data-testid="inbox-mobile-bill-panel"
      style={{
        flexShrink: 0,
        height: billPanelHeight,
        minHeight: 220,
        maxHeight: "58%",
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
            style={{
              width: 44,
              height: 6,
              borderRadius: 999,
              border: "none",
              background: "rgba(255,255,255,0.16)",
              cursor: "pointer",
              padding: 0,
            }}
          />
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
          {email.extractedBill?.amount != null && (
            <span
              style={{
                fontSize: 11,
                color: "rgba(205,214,244,0.62)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatBillAmount(email.extractedBill.amount)}
            </span>
          )}
          {email.extractedBill?.due_date && (
            <>
              <span style={{ color: "var(--color-text-faint)" }}>·</span>
              <span style={{ fontSize: 11, color: "rgba(205,214,244,0.62)" }}>
                Due {email.extractedBill.due_date}
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setBillExpanded((value) => !value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 8px",
              minHeight: 44,
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
            {billExpanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
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
          emailSubject={email.subject}
          emailFrom={email.from}
          emailBody={extractionBody.body}
          emailBodyLoading={extractionBody.loading}
          emailBodySource={extractionBody.source}
          emailBodyError={extractionBody.error}
          mapping={billResolution?.mapping}
          mappingLoading={billResolution?.status === "loading"}
        />
      </div>
    </div>
  );
}
