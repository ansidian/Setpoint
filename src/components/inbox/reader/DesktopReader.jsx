import { useEffect, useState } from "react";
import {
  BellOff,
  CalendarX,
  Check,
  Clock,
  CreditCard,
  ExternalLink,
  FileText,
  Mail,
  MailOpen,
  Reply,
  Sparkles,
  Trash2,
  Zap,
  X,
} from "lucide-react";
import { getGmailUrl } from "../../../lib/email-links";
import { pendingSecurityGraceLabel, timeClock, timeSince } from "../helpers";
import { Avatar, QuickAction } from "../primitives";
import SnoozePicker from "../SnoozePicker";
import BillBadge from "../../bills/BillBadge";
import TriagePanel from "./TriagePanel";
import EmailBodyPane from "./EmailBodyPane";
import DraftReply from "./DraftReply";
import { resolveBillExtractionBody } from "./billExtractionBody";
import { resolveReaderActions } from "./readerActionsModel.js";
import { resolveBillSeed } from "./billSeedModel.js";

function LiveEmailNotice({ email }) {
  const pendingGrace = !!email?._pendingSecurityGrace;
  // Compute the countdown label live so it advances while the reader is open,
  // rather than freezing at the value baked when the snapshot row was built.
  // A 30s local tick (only mounted for pending-grace emails) mirrors the
  // controller's now-tick cadence without threading nowTick through the reader.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pendingGrace) return undefined;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [pendingGrace]);
  const status = pendingGrace
    ? pendingSecurityGraceLabel(email._pendingSecurityGraceAt, now)
    : "Live · not yet triaged";
  const detail = email?._pendingSecurityGrace
    ? "Security triage is delayed briefly before classification."
    : "Arrived after the current snapshot. Not yet triaged.";
  return (
    <div
      style={{
        margin: "16px 20px 0",
        borderRadius: 12,
        padding: "10px 14px",
        background: "linear-gradient(135deg, color-mix(in srgb, var(--sp-blue) 6%, transparent), color-mix(in srgb, var(--sp-blue) 2%, transparent))",
        border: "1px dashed color-mix(in srgb, var(--sp-blue) 28%, transparent)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: 6,
          background: "color-mix(in srgb, var(--sp-blue) 12%, transparent)",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 4,
            borderRadius: 999,
            background: "var(--sp-blue)",
            opacity: 0.3,
            animation: "livepulse 2s ease-out infinite",
          }}
        />
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: "var(--sp-blue)",
            boxShadow: "0 0 6px var(--sp-blue)",
            position: "relative",
          }}
        />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "var(--sp-blue)",
          }}
        >
          {status}
        </div>
        <div
          className="ea-display"
          style={{
            fontSize: 11,
            color: "rgba(205,214,244,0.7)",
            marginTop: 3,
            fontStyle: "italic",
          }}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}

function BillDrawer({ billOpen, billMounted, setBillOpen, email, bodyState, billResolution }) {
  const extractionBody = resolveBillExtractionBody(bodyState);
  const billSeed = resolveBillSeed(billResolution, email.extractedBill);

  return (
    <div
      style={{
        maxWidth: billOpen ? 360 : 0,
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {billMounted && (
        <aside
          style={{
            width: 360,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid color-mix(in srgb, var(--sp-accent) 12%, transparent)",
            background: "color-mix(in srgb, var(--sp-panel) 55%, transparent)",
            overflowY: "auto",
            overscrollBehavior: "contain",
            isolation: "isolate",
            opacity: billOpen ? 1 : 0,
            transition: "opacity 200ms ease",
          }}
        >
          <div
            style={{
              padding: "11px 16px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "var(--sp-accent)",
              }}
            >
              Pay bill
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => setBillOpen(false)}
              aria-label="Close bill pay"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "rgba(205,214,244,0.5)",
                padding: 4,
                borderRadius: 4,
                display: "inline-flex",
                fontFamily: "inherit",
              }}
            >
              <X size={12} />
            </button>
          </div>
          <div style={{ padding: "14px 16px 18px" }}>
            <BillBadge
              layout="drawer"
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
        </aside>
      )}
    </div>
  );
}

export default function DesktopReader({
  email,
  account,
  accent,
  onAction,
  onClose,
  showTriage,
  showDraft,
  billOpen,
  billMounted,
  setBillOpen,
  trashHoldProgress,
  snoozeHoldProgress,
  snoozeBtnRef,
  snoozeOpen,
  setSnoozeOpen,
  bodyState,
  billResolution,
  drafting,
  setDrafting,
  readOnly = false,
}) {
  const gmailUrl = getGmailUrl(email);
  const {
    catchUp,
    showMutableActions,
    showDestructiveActions,
    billToggleEligible,
    canReopen,
    canHandle,
    canDismiss,
    canMoveToNeeds,
    canMoveToFyi,
    canMoveToNoise,
  } = resolveReaderActions(email, { readOnly });
  const showReadAction = showMutableActions;
  const showBillToggle = billToggleEligible;

  return (
    <div
      style={{
        flex: 1.3,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: "color-mix(in srgb, var(--sp-panel) 50%, transparent)",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          flexShrink: 0,
        }}
      >
        <span style={{ flex: 1 }} />
        {showDestructiveActions && showBillToggle && (
          <QuickAction
            icon={CreditCard}
            label={billOpen ? "Hide bill" : "Pay bill"}
            tooltip={billOpen ? "Hide bill panel" : "Open bill panel"}
            primary={!billOpen}
            onClick={() => setBillOpen((value) => !value)}
            accent="#a6e3a1"
          />
        )}
        {canReopen && (
          <QuickAction
            icon={Check}
            ariaLabel="Reopen"
            tooltip="Reopen"
            onClick={() => onAction("snapshot-reopen")}
            accent="#a6e3a1"
            keyHint="H"
          />
        )}
        {canMoveToNeeds && (
          <QuickAction
            icon={Zap}
            ariaLabel="Move to Needs Attention"
            tooltip="Move to Needs Attention"
            onClick={() => onAction("snapshot-move-lane", "needs_attention")}
            accent="#f38ba8"
            keyHint="A"
          />
        )}
        {canMoveToFyi && (
          <QuickAction
            icon={FileText}
            ariaLabel="Move to FYI"
            tooltip="Move to FYI"
            onClick={() => onAction("snapshot-move-lane", "fyi")}
            accent="#89b4fa"
            keyHint="F"
          />
        )}
        {canMoveToNoise && (
          <QuickAction
            icon={BellOff}
            ariaLabel="Move to Noise"
            tooltip="Move to Noise"
            onClick={() => onAction("snapshot-move-lane", "noise")}
            accent="#a6adc8"
            keyHint="N"
          />
        )}
        {canHandle && (
          <QuickAction
            icon={Check}
            ariaLabel="Mark handled"
            tooltip="Mark handled"
            onClick={() => onAction("snapshot-handled")}
            accent="#a6e3a1"
            keyHint="H"
          />
        )}
        {canDismiss && (
          <QuickAction
            icon={CalendarX}
            ariaLabel="Dismiss from today"
            tooltip="Dismiss from today"
            onClick={() => onAction("snapshot-dismiss")}
            accent="#f9e2af"
            keyHint="D"
          />
        )}
        {showReadAction && (
          <QuickAction
            icon={email.read ? Mail : MailOpen}
            ariaLabel={email.read ? "Mark unread" : "Mark read"}
            tooltip={email.read ? "Mark unread" : "Mark read"}
            onClick={() => onAction("toggle-read")}
            accent={accent}
          />
        )}
        {showDestructiveActions && (
          <QuickAction
            icon={Clock}
            ariaLabel="Snooze email"
            tooltip="Snooze email"
            buttonRef={snoozeBtnRef}
            onClick={() => setSnoozeOpen((value) => !value)}
            accent={accent}
            holdProgress={snoozeHoldProgress}
            holdColor="#f97316"
            keyHint="S"
          />
        )}
        {showDestructiveActions && snoozeOpen && (
          <SnoozePicker
            anchorRef={snoozeBtnRef}
            onSelect={(untilTs) => onAction("snooze", untilTs)}
            onClose={() => setSnoozeOpen(false)}
          />
        )}
        {gmailUrl && (
          <QuickAction
            icon={ExternalLink}
            ariaLabel="Open in Gmail"
            tooltip="Open in Gmail"
            onClick={() => window.open(gmailUrl, "_blank", "noopener,noreferrer")}
            accent={accent}
            keyHint="O"
          />
        )}
        {showDestructiveActions && (
          <QuickAction
            icon={Trash2}
            ariaLabel="Trash email"
            tooltip="Trash email"
            danger
            onClick={() => onAction("trash")}
            accent={accent}
            holdProgress={trashHoldProgress}
            holdColor="#f38ba8"
            keyHint="E"
          />
        )}
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "rgba(205,214,244,0.5)",
            padding: 4,
            borderRadius: 4,
            display: "inline-flex",
            fontFamily: "inherit",
          }}
        >
          <X size={12} />
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "22px 24px 8px", flexShrink: 0 }}>
          <h1
            className="ea-display"
            style={{
              margin: 0,
              fontSize: 21,
              fontWeight: 500,
              color: "#fff",
              lineHeight: 1.2,
              letterSpacing: -0.3,
            }}
          >
            {email.subject}
          </h1>
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar
              name={email.from}
              email={email.fromEmail}
              color={account?.color || accent}
              size={34}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                {email.from}
                {email.fromEmail && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-faint)",
                      fontWeight: 400,
                      marginLeft: 6,
                    }}
                  >
                    &lt;{email.fromEmail}&gt;
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-text-faint)",
                  marginTop: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>to me</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span>{timeClock(email.date)}</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span>{timeSince(email.date)}</span>
                {account?.name && (
                  <>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <span style={{ color: account.color }}>{account.name}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {showTriage && email.claude && (
          <div style={{ flexShrink: 0 }}>
            <TriagePanel email={email} accent={accent} />
          </div>
        )}

        {email._untriaged && <LiveEmailNotice email={email} />}

        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <EmailBodyPane state={bodyState} fallback={email.body || email.preview} />
          </div>
          <BillDrawer
            billOpen={billOpen}
            billMounted={billMounted}
            setBillOpen={setBillOpen}
            email={email}
            bodyState={bodyState}
            billResolution={billResolution}
          />
        </div>

        {showDraft && !catchUp && email.claude?.draftReply && (
          <div style={{ flexShrink: 0, maxHeight: "45%", overflowY: "auto" }}>
            <DraftReply
              key={email.id}
              email={email}
              accent={accent}
              onDiscard={() => setDrafting(false)}
            />
          </div>
        )}
      </div>

      {!drafting && !showDraft && !catchUp && email.claude?.draftReply && (
        <div
          style={{
            padding: "10px 20px",
            flexShrink: 0,
            borderTop: "1px solid rgba(255,255,255,0.05)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "color-mix(in srgb, var(--sp-mantle) 80%, transparent)",
          }}
        >
          <Sparkles size={11} color={accent} />
          <span style={{ fontSize: 11, color: "rgba(205,214,244,0.7)", flex: 1 }}>
            Draft reply ready.
          </span>
          <QuickAction
            icon={Reply}
            label="Review reply"
            tooltip="Review draft reply"
            primary
            onClick={() => setDrafting(true)}
            accent={accent}
          />
        </div>
      )}
    </div>
  );
}
