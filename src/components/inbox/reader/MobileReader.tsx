import { useRef, useState } from "react";
import {
  ArrowLeft,
  BellOff,
  Clock,
  Ellipsis,
  ShieldCheck,
  Trash2,
  Check,
  CheckCircle2,
  CreditCard,
  FileText,
  Mail,
  MailOpen,
  Pin,
  XCircle,
  Zap,
  BellPlus,
} from "lucide-react";
import { useRemoteContentTrust } from "../../../hooks/useRemoteContentTrust";
import SnoozePicker from "../SnoozePicker";
import AnchoredFloatingPanel from "../../shared/pickers/AnchoredFloatingPanel";
import EmailBodyPane from "./EmailBodyPane";
import EmailAttachmentShelf from "./EmailAttachmentShelf";
import DraftReply from "./DraftReply";
import AnimatedCollapse from "../../shared/AnimatedCollapse";
import MobileActionRow from "./MobileActionRow";
import { resolveReaderActions } from "./readerActionsModel";
import MobileBillDrawer from "./MobileBillDrawer";
import MobileReaderHeader from "./MobileReaderHeader";
import "./MobileReader.css";
import type { SnapshotTriageLane } from "../../../../shared/types/snapshots";
import type { InboxActionKind } from "../useInboxActionDispatch";
import type { ReaderSurfaceProps } from "./readerTypes";
import { IDLE_BILL_RESOLUTION } from "./readerTypes";
import EmailActualStatus from "./EmailActualStatus";
import VerificationCodeCallout from "./VerificationCodeCallout";
import {
  isActualActioned,
  resolveActualCalendarTarget,
} from "./actualActionStatusModel";

export default function MobileReader({
  email,
  account,
  accent,
  onAction,
  onClose,
  backLabel = "Back to inbox",
  showTriage,
  billOpen,
  billMounted = billOpen,
  setBillOpen,
  onOpenRecordedBill,
  snoozeOpen,
  setSnoozeOpen,
  bodyState,
  billResolution,
  drafting,
  setDrafting,
  setDraftDirty,
  onRemind,
  readOnly = false,
}: ReaderSurfaceProps) {
  const resolvedBillResolution = billResolution || IDLE_BILL_RESOLUTION;
  const actions = resolveReaderActions(email, { readOnly });
  const {
    catchUp,
    isQueuedSnapshot,
    isUntriagedReadSnapshot,
    showMutableActions,
    showDestructiveActions,
    billToggleEligible,
    canReopen,
    canDismiss,
    canMoveToNeeds,
    canPin,
    pinned,
  } = actions;
  const showBillToggle = showDestructiveActions && billToggleEligible;
  const snapshotPending = !!email._optimisticSnapshotPending;
  const actualActioned = isActualActioned(billResolution?.actualStatus);
  const actualCalendarTarget = resolveActualCalendarTarget(billResolution?.actualStatus);
  const triageSummary = showTriage ? email.claude?.summary || email.aiSummary || null : null;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [billExpanded, setBillExpanded] = useState(false);
  const [trustSaving, setTrustSaving] = useState(false);
  const [trustError, setTrustError] = useState<string | null>(null);
  const remoteTrust = useRemoteContentTrust(
    email.account_id || email.accountId || email._account?.account_id || email._account?.id,
    email.from_address || email.fromEmail || email.from_email,
  );
  const actionsBtnRef = useRef<HTMLButtonElement>(null);
  const actionsPanelRef = useRef<HTMLDivElement>(null);
  const handleAction = (kind: InboxActionKind, payload?: SnapshotTriageLane | number) => {
    setActionsOpen(false);
    onAction(kind, payload);
  };
  const openSnoozePicker = () => {
    setActionsOpen(false);
    setSnoozeOpen(true);
  };
  const hasTriageActions = actions.canHandle || canReopen || canPin || showMutableActions
    || actions.canMoveToFyi || actions.canMoveToNoise || canMoveToNeeds || canDismiss;
  const hasFollowUpActions = showDestructiveActions || !!onRemind || showBillToggle
    || (!catchUp && !!email.claude?.draftReply);
  const hasMessageActions = !!remoteTrust.trustSender;

  return (
    <div
      data-testid="inbox-mobile-reader"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        background: "var(--sp-panel)",
      }}
    >
      <div className="mobile-reader-toolbar">
        <button type="button" className="mobile-reader-icon-button" aria-label={backLabel} onClick={onClose}>
          <ArrowLeft size={20} />
        </button>
        <span className="mobile-reader-account">{account?.name || account?.email || "Inbox"}</span>
        <button
          ref={actionsBtnRef}
          type="button"
          className="mobile-reader-icon-button"
          aria-label="More email actions"
          aria-haspopup="dialog"
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((value) => !value)}
        >
          <Ellipsis size={21} />
        </button>
      </div>

      <div className="mobile-reader-scroll" data-testid="inbox-mobile-reader-scroll">
        <MobileReaderHeader
          email={email}
          accent={accent}
          isQueuedSnapshot={isQueuedSnapshot}
          isUntriagedReadSnapshot={isUntriagedReadSnapshot}
          triageSummary={triageSummary}
        />

        <VerificationCodeCallout
          key={String(email.uid || email.id || "verification-code")}
          email={email}
          readOnly={readOnly}
          onTrash={() => onAction("trash")}
        />

        <EmailActualStatus
          emailUid={String(email.uid || email.email_id || "")}
          billResolution={billResolution}
          style={{ margin: "0 16px 10px" }}
        />

        <AnimatedCollapse open={!!(drafting && !catchUp && email.claude?.draftReply)} style={{ flexShrink: 0 }}>
          <div
            data-testid="inbox-mobile-draft-panel"
            style={{
              flexShrink: 0,
              margin: "0 16px 10px",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <DraftReply
              key={email.id}
              email={email}
              accent={accent}
              onDiscard={() => setDrafting(false)}
              onDirtyChange={setDraftDirty}
              isMobile
            />
          </div>
        </AnimatedCollapse>

        <div>
          <EmailAttachmentShelf
            emailUid={String(email.uid || email.email_id || email.id || "")}
            attachments={bodyState.attachments}
            isMobile
          />
          <EmailBodyPane state={bodyState} fallback={email.body || email.preview} email={email} isMobile />
        </div>
      </div>

      {billMounted && (
        <MobileBillDrawer
          email={email}
          open={billOpen}
          billExpanded={billExpanded}
          setBillExpanded={setBillExpanded}
          bodyState={bodyState}
          billResolution={resolvedBillResolution}
        />
      )}

      {actionsOpen && (
        <AnchoredFloatingPanel
          anchorRef={actionsBtnRef}
          panelRef={actionsPanelRef}
          onClose={() => setActionsOpen(false)}
          width={220}
          mobileHeight={null}
          role="dialog"
          ariaLabel="Email actions"
          forceMobileSheet
          style={{
            padding: 8,
          }}
        >
          <div data-testid="inbox-mobile-actions-menu" className="mobile-reader-actions">
            {hasTriageActions && (
              <section className="mobile-reader-action-group" aria-label="Triage">
                <h3>Triage</h3>
                <div className="mobile-reader-action-grid">
                  {actions.canHandle && <MobileActionRow icon={Check} iconColor="var(--sp-green)" label="Handled" disabled={snapshotPending} onClick={() => handleAction("snapshot-handled")} />}
                  {canReopen && (
                    <MobileActionRow
                      icon={Check}
                      iconColor="var(--sp-green)"
                      label="Reopen"
                      disabled={snapshotPending}
                      onClick={() => handleAction("snapshot-reopen")}
                    />
                  )}
                  {showMutableActions && (
                    <MobileActionRow
                      icon={email.read ? Mail : MailOpen}
                      iconColor="var(--sp-blue)"
                      label={email.read ? "Mark unread" : "Mark read"}
                      onClick={() => handleAction("toggle-read")}
                    />
                  )}
                  {canPin && (
                    <MobileActionRow
                      icon={Pin}
                      label={pinned ? "Unpin" : "Pin"}
                      active={pinned}
                      accent="#b4befe"
                      onClick={() => handleAction("pin-toggle")}
                    />
                  )}
                  {canMoveToNeeds && (
                    <MobileActionRow
                      icon={Zap}
                      iconColor="var(--sp-rose)"
                      label="Move to Needs"
                      disabled={snapshotPending}
                      onClick={() => handleAction("snapshot-move-lane", "needs_attention")}
                    />
                  )}
                  {actions.canMoveToFyi && <MobileActionRow icon={FileText} iconColor="var(--sp-blue)" label="Move to FYI" disabled={snapshotPending} onClick={() => handleAction("snapshot-move-lane", "fyi")} />}
                  {actions.canMoveToNoise && <MobileActionRow icon={BellOff} iconColor="var(--sp-subtext)" label="Move to Noise" disabled={snapshotPending} onClick={() => handleAction("snapshot-move-lane", "noise")} />}
                  {canDismiss && (
                    <MobileActionRow
                      icon={XCircle}
                      iconColor="var(--sp-subtext)"
                      label="Dismiss"
                      disabled={snapshotPending}
                      onClick={() => handleAction("snapshot-dismiss")}
                    />
                  )}
                </div>
              </section>
            )}
            {hasFollowUpActions && (
              <section className="mobile-reader-action-group" aria-label="Follow up">
                <h3>Follow up</h3>
                <div className="mobile-reader-action-grid">
                  {showDestructiveActions && <MobileActionRow icon={Clock} iconColor="var(--sp-orange)" label="Snooze" onClick={openSnoozePicker} />}
                  {onRemind && (
                    <MobileActionRow icon={BellPlus} iconColor="var(--sp-peach)" label="Remind me" onClick={() => { setActionsOpen(false); onRemind(); }} />
                  )}
                  {!catchUp && email.claude?.draftReply && (
                    <MobileActionRow
                      icon={FileText}
                      iconColor={accent}
                      label={drafting ? "Hide draft reply" : "Show draft reply"}
                      active={drafting}
                      onClick={() => {
                        setActionsOpen(false);
                        setDrafting((value) => !value);
                      }}
                    />
                  )}
                  {showBillToggle && (
                    <MobileActionRow
                      icon={actualActioned ? CheckCircle2 : CreditCard}
                      iconColor="var(--sp-green)"
                      label={actualCalendarTarget
                        ? "View bill details"
                        : actualActioned
                        ? (billOpen ? "Hide bill details" : "View bill details")
                        : (billOpen ? "Hide bill pay" : "Open bill pay")}
                      active={billOpen}
                      onClick={() => {
                        setActionsOpen(false);
                        if (actualCalendarTarget && onOpenRecordedBill) {
                          onOpenRecordedBill(actualCalendarTarget);
                          return;
                        }
                        setBillOpen((value) => !value);
                      }}
                    />
                  )}
                </div>
              </section>
            )}
            {hasMessageActions && (
              <section className="mobile-reader-action-group" aria-label="Message">
                <h3>Message</h3>
                <div className="mobile-reader-action-list">
                  {remoteTrust.trustSender && (
                    <MobileActionRow
                      icon={ShieldCheck}
                      iconColor="var(--sp-cyan)"
                      label={trustSaving ? "Saving…" : remoteTrust.status === "trusted" ? "Images allowed for this sender" : "Always allow images from this sender"}
                      disabled={trustSaving || remoteTrust.status !== "untrusted"}
                      onClick={async () => {
                        setTrustSaving(true);
                        setTrustError(null);
                        try {
                          await remoteTrust.trustSender?.();
                        } catch {
                          setTrustError("Could not save this trusted sender. Try again.");
                        } finally {
                          setTrustSaving(false);
                        }
                      }}
                    />
                  )}
                  {trustError && <p role="alert" style={{ color: "var(--sp-rose)", fontSize: 12, padding: "0 12px" }}>{trustError}</p>}
                </div>
              </section>
            )}
            {showDestructiveActions && (
              <div className="mobile-reader-action-group mobile-reader-trash">
                <MobileActionRow icon={Trash2} label="Trash" danger onClick={() => handleAction("trash")} />
              </div>
            )}
          </div>
        </AnchoredFloatingPanel>
      )}

      {showDestructiveActions && snoozeOpen && (
        <SnoozePicker
          anchorRef={actionsBtnRef}
          forceMobileSheet
          onSelect={(untilTs) => onAction("snooze", untilTs)}
          onClose={() => setSnoozeOpen(false)}
        />
      )}
    </div>
  );
}
