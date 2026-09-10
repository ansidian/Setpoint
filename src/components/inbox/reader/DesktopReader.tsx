import { formatSnoozeTime } from "../inboxSnoozedModel";
import "./DesktopReader.css";
import { useAlfredWorkspace } from "../../dashboard/AlfredWorkspaceContext";
import { useRef } from "react";
import { motion as Motion, useReducedMotion } from "motion/react";
import {
  Reply,
  Sparkles,
  BellPlus,
  SlidersHorizontal,
  ExternalLink,
} from "lucide-react";
import { getGmailUrl } from "../../../lib/email-links";
import { timeClock } from "../helpers";
import { LANE } from "../../../lib/shell-helpers";
import TriagePanel from "./TriagePanel";
import EmailContentSection from "./EmailContentSection";
import DraftReply from "./DraftReply";
import AnimatedCollapse from "../../shared/AnimatedCollapse";
import EmailActualStatus from "./EmailActualStatus";
import VerificationCodeCallout from "./VerificationCodeCallout";
import { resolveReaderActionGroups } from "./readerActionsModel";
import DesktopReaderActionBar, { ToolbarButton } from "./DesktopReaderActionBar";
import type { ReactNode } from "react";
import type { ReaderSurfaceProps } from "./readerTypes";
import { motionDuration, motionTransition } from "../../../lib/motion";

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
  onCreateProfile,
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
}: ReaderSurfaceProps) {
  const alfredWorkspace = useAlfredWorkspace();
  const alfredOpen = alfredWorkspace?.open ?? false;
  const internalSnoozeBtnRef = useRef<HTMLButtonElement>(null);
  const resolvedSnoozeBtnRef = snoozeBtnRef || internalSnoozeBtnRef;
  const gmailUrl = getGmailUrl(email);
  const readerActionGroups = resolveReaderActionGroups(email, { readOnly });
  const {
    catchUp,
    showDestructiveActions,
    canCreateProfile,
    moveDestinations,
    moveDisabled,
    triageItems,
  } = readerActionGroups;

  const sender = email.from || email.from_name || email.fromEmail || "Unknown sender";
  const address = email.fromEmail || email.from_email || email.from_address;
  const recipient = account?.email || email.account_email;
  const initials = sender.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const date = email.date ? new Date(email.date) : null;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  const lane = email._lane ? LANE[email._lane] : undefined;
  const status = readOnly ? "Historical snapshot" : email._snoozed ? "Snoozed" : lane?.label;
  const carriedOver = email._carryover || email._snapshotCarryover;
  const hasTriage = !!(showTriage && (email.claude || email.aiSummary || email.summary));
  const contextualActions = <>
    {!drafting && !showDraft && !catchUp && email.claude?.draftReply && <ToolbarButton icon={Reply} label="Review draft" onClick={() => setDrafting(true)} />}
  </>;

  return (
    <div className="inbox-a-reader" data-discussing={alfredOpen}>
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
              {canCreateProfile && <ToolbarButton icon={SlidersHorizontal} label="Create profile" onClick={onCreateProfile} />}
              {onRemind && <ToolbarButton icon={BellPlus} label={taskOpen ? "Hide reminder" : "Remind me"} expanded={taskOpen} onClick={onRemind} />}
              {onAskAlfred && <ToolbarButton icon={Sparkles} label="Ask Alfred" expanded={alfredOpen} onClick={() => { if (alfredWorkspace?.open) alfredWorkspace.close(); else onAskAlfred(); }} />}
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
      <ReminderDrawer open={taskOpen} workspace={taskWorkspace} />
    </div>
  );
}
