import { formatSnoozeTime } from "../inboxSnoozedModel";
import "./DesktopReader.css";
import { useRef } from "react";
import { motion as Motion, useReducedMotion } from "motion/react";
import {
  Reply,
  Sparkles,
  BellPlus,
  CreditCard,
  CheckCircle2,
  ExternalLink,
  X,
} from "lucide-react";
import { getGmailUrl } from "../../../lib/email-links";
import { timeClock } from "../helpers";
import { LANE } from "../../../lib/shell-helpers";
import BillBadge from "../../bills/BillBadge";
import TriagePanel from "./TriagePanel";
import EmailContentSection from "./EmailContentSection";
import DraftReply from "./DraftReply";
import AnimatedCollapse from "../../shared/AnimatedCollapse";
import EmailActualStatus from "./EmailActualStatus";
import VerificationCodeCallout from "./VerificationCodeCallout";
import { resolveBillExtractionBody } from "./billExtractionBody";
import { resolveReaderActionGroups } from "./readerActionsModel";
import { resolveBillSeed } from "./billSeedModel";
import DesktopReaderActionBar, { ToolbarButton } from "./DesktopReaderActionBar";
import {
  isActualActioned,
  resolveActualCalendarTarget,
} from "./actualActionStatusModel";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { InboxEmailLike } from "../inboxTypes";
import type { BillResolutionState, EmailBodyState, ReaderSurfaceProps } from "./readerTypes";
import { asBillCandidate, IDLE_BILL_RESOLUTION } from "./readerTypes";
import { motionDuration, motionTransition } from "../../../lib/motion";

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
      className="inbox-reader-workspace"
      data-open={billOpen}
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
              className="bill-drawer-close inbox-a-control sp-focus-ring"
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
              plan={billResolution?.plan}
              planLoading={billResolution?.status === "loading"}
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
      className="inbox-reader-workspace"
      data-open={open}
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
  onPrevious,
  onNext,
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

  const sender = email.from || email.from_name || email.fromEmail || "Unknown sender";
  const address = email.fromEmail || email.from_email || email.from_address;
  const recipient = account?.email || email.account_email;
  const initials = sender.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const date = email.date ? new Date(email.date) : null;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  const lane = email._lane ? LANE[email._lane] : undefined;
  const status = readOnly ? "Historical snapshot" : email._snoozed ? "Snoozed" : lane?.label;
  const carriedOver = email._carryover || email._snapshotCarryover;
  const showBillAction = (showDestructiveActions || (email._snoozed && !email._snoozedUnavailable)) && showBillToggle;
  const billActionLabel = actualCalendarTarget ? "View bill" : actualActioned ? (billOpen ? "Hide details" : "View bill") : (billOpen ? "Hide bill" : "Review bill");
  const hasTriage = !!(showTriage && (email.claude || email.aiSummary || email.summary));
  const contextualActions = <>
    {showBillAction && <ToolbarButton icon={actualActioned ? CheckCircle2 : CreditCard} label={billActionLabel} expanded={billOpen} onClick={() => {
      if (actualCalendarTarget && onOpenRecordedBill) { onOpenRecordedBill(actualCalendarTarget); return; }
      setBillOpen((value) => !value);
    }} />}
    {!drafting && !showDraft && !catchUp && email.claude?.draftReply && <ToolbarButton icon={Reply} label="Review draft" onClick={() => setDrafting(true)} />}
  </>;

  return (
    <div className="inbox-a-reader">
      <DesktopReaderActionBar
        accent={accent}
        moveDestinations={moveDestinations}
        moveDisabled={moveDisabled}
        triageItems={triageItems}
        showTrash={showDestructiveActions}
        onAction={onAction}
        onClose={onClose}
        onPrevious={onPrevious}
        onNext={onNext}
        snoozeAnchorRef={resolvedSnoozeBtnRef}
        snoozeOpen={snoozeOpen}
        setSnoozeOpen={setSnoozeOpen}
      />
      <div className="inbox-a-reader-scroll">
        <div className="inbox-a-reader-inner" data-has-context={hasTriage}>
          <header className="inbox-a-reader-header">
            <div className="inbox-a-reader-meta">
              {dateLabel && <span>{dateLabel}</span>}
              {dateLabel && <span aria-hidden="true">·</span>}
              {dateLabel && <time dateTime={email.date || undefined}>{timeClock(email.date)}</time>}
              {carriedOver && <span className="inbox-a-reader-carry">Carried over</span>}
              {status && <span className="inbox-a-reader-status" style={{ color: lane?.color }}>{status}</span>}
            </div>
            <h1>{email.subject}</h1>
            <div className="inbox-a-reader-identity">
              <span className="inbox-a-reader-avatar" aria-hidden="true">{initials}</span>
              <div className="inbox-a-reader-sender">
                <strong>{sender}</strong>
                <small>{address && <>{address}<br /></>}{recipient ? `to ${recipient}` : "to me"}</small>
              </div>
            </div>
            <div className="inbox-a-reader-utilities" role="group" aria-label="Email tools">
              {onRemind && <ToolbarButton icon={BellPlus} label={taskOpen ? "Hide reminder" : "Remind me"} expanded={taskOpen} onClick={onRemind} />}
              {onAskAlfred && <ToolbarButton icon={Sparkles} label="Ask Alfred" onClick={onAskAlfred} />}
              {gmailUrl && <span className="inbox-a-reader-external"><ToolbarButton icon={ExternalLink} label="Open in Gmail" onClick={() => window.open(gmailUrl, "_blank", "noopener,noreferrer")} /></span>}
            </div>
          </header>
          <div className="inbox-a-reader-content" data-has-context={hasTriage}>
            <AnimatedCollapse open={hasTriage} className="inbox-a-reader-context">
              <TriagePanel key={String(email.uid || email.email_id || email.id || "")} email={email} accent={accent} actionFirst>{contextualActions}</TriagePanel>
            </AnimatedCollapse>
            <div className="inbox-a-reader-message">
              <VerificationCodeCallout key={String(email.uid || email.id || "verification-code")} email={email} readOnly={readOnly} onTrash={() => onAction("trash")} />
              {!hasTriage && <div className="inbox-a-reader-context-actions">{contextualActions}</div>}
              <EmailActualStatus emailUid={String(email.uid || email.email_id || "")} billResolution={billResolution} style={{ margin: "0 0 18px" }} />
              <AnimatedCollapse open={!!((drafting || showDraft) && !catchUp && email.claude?.draftReply)}>
                <DraftReply key={email.id} email={email} accent={accent} onDiscard={() => setDrafting(false)} onDirtyChange={setDraftDirty} />
              </AnimatedCollapse>
              {email._snoozedUntil && <p className="inbox-a-reader-snooze-note">Snoozed · returns {formatSnoozeTime(email._snoozedUntil)}{email._snoozedUnavailable && " · Source unavailable; deferred state is kept."}</p>}
              <EmailContentSection key={`source-${email.uid || email.email_id || email.id || ""}`} email={email} bodyState={bodyState} />
            </div>
          </div>
        </div>
      </div>
      <BillDrawer billOpen={billOpen} billMounted={billMounted} setBillOpen={setBillOpen} email={email} bodyState={bodyState} billResolution={resolvedBillResolution} />
      <ReminderDrawer open={taskOpen} workspace={taskWorkspace} />
    </div>
  );
}
