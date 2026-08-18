import { useEffect, useRef, useState } from "react";
import { motion as Motion, useReducedMotion } from "motion/react";
import {
  Reply,
  Sparkles,
  X,
} from "lucide-react";
import { getGmailUrl } from "../../../lib/email-links";
import { pendingSecurityGraceLabel, timeClock, timeSince } from "../helpers";
import { Avatar, QuickAction } from "../primitives";
import BillBadge from "../../bills/BillBadge";
import TriagePanel from "./TriagePanel";
import EmailBodyPane from "./EmailBodyPane";
import DraftReply from "./DraftReply";
import ActualActionStatus from "./ActualActionStatus";
import TransactionImportStatus from "./TransactionImportStatus";
import VerificationCodeCallout from "./VerificationCodeCallout";
import { resolveBillExtractionBody } from "./billExtractionBody";
import { resolveReaderActionGroups } from "./readerActionsModel";
import { resolveBillSeed } from "./billSeedModel";
import DesktopReaderActionBar from "./DesktopReaderActionBar";
import {
  isActualActioned,
  resolveActualCalendarTarget,
} from "./actualActionStatusModel";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { InboxEmailLike } from "../inboxTypes";
import type { BillResolutionState, EmailBodyState, ReaderSurfaceProps } from "./readerTypes";
import { asBillCandidate, IDLE_BILL_RESOLUTION } from "./readerTypes";
import { motionDuration, motionTransition } from "../../../lib/motion";

function LiveEmailNotice({ email }: { email: InboxEmailLike }) {
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

function BillDrawer({ billOpen, billMounted, setBillOpen, email, bodyState, billResolution }: {
  billOpen: boolean;
  billMounted: boolean;
  setBillOpen: Dispatch<SetStateAction<boolean>>;
  email: InboxEmailLike;
  bodyState: EmailBodyState;
  billResolution: BillResolutionState;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const extractionBody = resolveBillExtractionBody(bodyState);
  const billSeed = resolveBillSeed(billResolution, asBillCandidate(email.extractedBill));

  return (
    <Motion.div
      initial={false}
      animate={{ width: billOpen ? 360 : 0 }}
      transition={motionTransition(reduceMotion, billOpen ? motionDuration.panel : motionDuration.exit)}
      aria-hidden={!billOpen}
      style={{
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {billMounted && (
        <Motion.aside
          initial={reduceMotion ? false : { opacity: 0, x: 14 }}
          animate={{ opacity: billOpen ? 1 : 0, x: reduceMotion || billOpen ? 0 : 14 }}
          transition={motionTransition(reduceMotion, billOpen ? motionDuration.panel : motionDuration.exit)}
          aria-hidden={!billOpen}
          inert={!billOpen ? true : undefined}
          data-state={billOpen ? "open" : "closed"}
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
            pointerEvents: billOpen ? "auto" : "none",
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
              className="bill-drawer-close"
              style={{
                background: "transparent",
                border: "1px solid transparent",
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
        </Motion.aside>
      )}
    </Motion.div>
  );
}

function ReminderDrawer({ open, workspace }: { open: boolean; workspace: ReactNode }) {
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <Motion.div
      initial={false}
      animate={{ width: open ? 360 : 0 }}
      transition={motionTransition(reduceMotion, open ? motionDuration.panel : motionDuration.exit)}
      aria-hidden={!open}
      style={{ flexShrink: 0, overflow: "hidden" }}
    >
      {workspace && (
        <Motion.aside
          data-testid="inbox-remind-workspace"
          initial={reduceMotion ? false : { opacity: 0, x: 14 }}
          animate={{ opacity: open ? 1 : 0, x: reduceMotion || open ? 0 : 14 }}
          transition={motionTransition(reduceMotion, open ? motionDuration.panel : motionDuration.exit)}
          aria-hidden={!open}
          inert={!open ? true : undefined}
          data-state={open ? "open" : "closed"}
          style={{
            width: 360,
            height: "100%",
            flexShrink: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            background: "var(--sp-panel)",
            padding: 16,
            pointerEvents: open ? "auto" : "none",
          }}
        >
          {workspace}
        </Motion.aside>
      )}
    </Motion.div>
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
  onOpenRecordedBill,
  snoozeBtnRef,
  snoozeOpen,
  setSnoozeOpen,
  bodyState,
  billResolution,
  drafting,
  setDrafting,
  readOnly = false,
  onRemind,
  onAskAlfred,
  taskWorkspace,
  taskOpen = false,
  setDraftDirty,
}: ReaderSurfaceProps & { billMounted: boolean }) {
  const resolvedBillResolution = billResolution || IDLE_BILL_RESOLUTION;
  const internalSnoozeBtnRef = useRef<HTMLButtonElement>(null);
  const resolvedSnoozeBtnRef = snoozeBtnRef || internalSnoozeBtnRef;
  const gmailUrl = getGmailUrl(email);
  const readerActionGroups = resolveReaderActionGroups(email, { readOnly });
  const {
    catchUp,
    showDestructiveActions,
    billToggleEligible,
    moveDestinations,
    moveDisabled,
    triageItems,
  } = readerActionGroups;
  const showBillToggle = billToggleEligible;
  const actualActioned = isActualActioned(billResolution?.actualStatus);
  const actualCalendarTarget = resolveActualCalendarTarget(billResolution?.actualStatus);

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
      <DesktopReaderActionBar
        accent={accent}
        moveDestinations={moveDestinations}
        moveDisabled={moveDisabled}
        triageItems={triageItems}
        billAction={showDestructiveActions && showBillToggle ? {
          label: actualCalendarTarget
            ? "View bill"
            : actualActioned
            ? (billOpen ? "Hide details" : "View bill")
            : (billOpen ? "Hide bill" : "Pay bill"),
          primary: !billOpen && !actualActioned,
          actioned: actualActioned,
          onClick: () => {
            if (actualCalendarTarget && onOpenRecordedBill) {
              onOpenRecordedBill(actualCalendarTarget);
              return;
            }
            setBillOpen((value) => !value);
          },
        } : null}
        gmailUrl={gmailUrl}
        showTrash={showDestructiveActions}
        onAction={onAction}
        onClose={onClose}
        onRemind={onRemind}
        reminderOpen={taskOpen}
        onAskAlfred={onAskAlfred}
        snoozeAnchorRef={resolvedSnoozeBtnRef}
        snoozeOpen={snoozeOpen}
        setSnoozeOpen={setSnoozeOpen}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "22px 24px 8px", flexShrink: 0 }}>
          <h1
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

        <VerificationCodeCallout
          key={String(email.uid || email.id || "verification-code")}
          email={email}
          readOnly={readOnly}
          onTrash={() => onAction("trash")}
        />

        {showTriage && email.claude && (
          <div style={{ flexShrink: 0 }}>
            <TriagePanel email={email} accent={accent} />
          </div>
        )}

        {email._untriaged && <LiveEmailNotice email={email} />}

        <TransactionImportStatus
          emailUid={String(email.uid || email.email_id || "")}
          style={{ margin: "8px 20px 0" }}
        />

        <ActualActionStatus
          resolution={billResolution}
          style={{ margin: "8px 20px 0" }}
        />

        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <EmailBodyPane state={bodyState} fallback={email.body || email.preview} email={email} />
          </div>
          <BillDrawer
            billOpen={billOpen}
            billMounted={billMounted}
            setBillOpen={setBillOpen}
            email={email}
            bodyState={bodyState}
            billResolution={resolvedBillResolution}
          />
          <ReminderDrawer open={taskOpen} workspace={taskWorkspace} />
        </div>

        {(drafting || showDraft) && !catchUp && email.claude?.draftReply && (
          <div style={{ flexShrink: 0, maxHeight: "45%", overflowY: "auto" }}>
            <DraftReply
              key={email.id}
              email={email}
              accent={accent}
              onDiscard={() => setDrafting(false)}
              onDirtyChange={setDraftDirty}
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
