import { useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CreditCard,
  FileText,
  ExternalLink,
  Mail,
  MailOpen,
  Pin,
  XCircle,
  Zap,
  BellPlus,
} from "lucide-react";
import { getGmailUrl } from "../../../lib/email-links";
import { timeSince } from "../helpers";
import SnoozePicker from "../SnoozePicker";
import AnchoredFloatingPanel from "../../shared/pickers/AnchoredFloatingPanel";
import EmailBodyPane from "./EmailBodyPane";
import DraftReply from "./DraftReply";
import MobileActionRow from "./MobileActionRow";
import { resolveReaderActions } from "./readerActionsModel";
import MobileBillDrawer from "./MobileBillDrawer";
import MobileReaderHeader from "./MobileReaderHeader";
import MobileTriageBar from "./MobileTriageBar";
import type { SnapshotTriageLane } from "../../../../shared/types/snapshots";
import type { InboxActionKind } from "../useInboxActionDispatch";
import type { ReaderSurfaceProps } from "./readerTypes";
import { IDLE_BILL_RESOLUTION } from "./readerTypes";
import ActualActionStatus from "./ActualActionStatus";
import TransactionImportStatus from "./TransactionImportStatus";
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
  const gmailUrl = getGmailUrl(email);
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
  const overflowActionCount = [
    !!onRemind,
    canPin,
    showBillToggle,
    !catchUp && !!email.claude?.draftReply,
    canReopen,
    canMoveToNeeds,
    canDismiss,
    showMutableActions,
    !!gmailUrl,
  ].filter(Boolean).length;
  const overflowPanelHeight = Math.min(360, 72 + overflowActionCount * 52);

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
      <div
        style={{
          padding: "12px 14px 10px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "color-mix(in srgb, var(--sp-deep) 94%, transparent)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          aria-label="Back to inbox"
          onClick={onClose}
          style={{
            width: "var(--sp-touch-min)",
            height: "var(--sp-touch-min)",
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            color: "rgba(205,214,244,0.8)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.8,
              textTransform: "uppercase",
              color: accent,
            }}
          >
            {account?.name || account?.email || "Inbox"}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(205,214,244,0.6)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {timeSince(email.date)}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <MobileReaderHeader
          email={email}
          account={account}
          accent={accent}
          actionsBtnRef={actionsBtnRef}
          actionsActive={actionsOpen || snoozeOpen}
          onToggleActions={() => setActionsOpen((value) => !value)}
          isQueuedSnapshot={isQueuedSnapshot}
          isUntriagedReadSnapshot={isUntriagedReadSnapshot}
          billOpen={billOpen}
          drafting={drafting}
          triageSummary={triageSummary}
        />

        <MobileTriageBar
          actions={actions}
          onAction={onAction}
          onSnooze={openSnoozePicker}
          snapshotPending={snapshotPending}
        />

        <TransactionImportStatus
          emailUid={String(email.uid || email.email_id || "")}
          style={{ margin: "0 16px 10px" }}
        />

        <ActualActionStatus
          resolution={billResolution}
          style={{ margin: "0 16px 10px" }}
        />

        {drafting && !catchUp && email.claude?.draftReply && (
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
        )}

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <EmailBodyPane state={bodyState} fallback={email.body || email.preview} email={email} isMobile />
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
      </div>

      {actionsOpen && (
        <AnchoredFloatingPanel
          anchorRef={actionsBtnRef}
          panelRef={actionsPanelRef}
          onClose={() => setActionsOpen(false)}
          width={220}
          height={overflowPanelHeight}
          role="menu"
          ariaLabel="Email actions"
          forceMobileSheet
          style={{
            padding: 8,
          }}
        >
          <div data-testid="inbox-mobile-actions-menu" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {onRemind && (
              <MobileActionRow icon={BellPlus} label="Remind me" onClick={() => { setActionsOpen(false); onRemind(); }} />
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
            {showBillToggle && (
              <MobileActionRow
                icon={actualActioned ? CheckCircle2 : CreditCard}
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
            {!catchUp && email.claude?.draftReply && (
              <MobileActionRow
                icon={FileText}
                label={drafting ? "Hide draft reply" : "Show draft reply"}
                active={drafting}
                onClick={() => {
                  setActionsOpen(false);
                  setDrafting((value) => !value);
                }}
              />
            )}
            {canReopen && (
              <MobileActionRow
                icon={Check}
                label="Reopen"
                disabled={snapshotPending}
                onClick={() => handleAction("snapshot-reopen")}
              />
            )}
            {canMoveToNeeds && (
              <MobileActionRow
                icon={Zap}
                label="Move to Needs"
                disabled={snapshotPending}
                onClick={() => handleAction("snapshot-move-lane", "needs_attention")}
              />
            )}
            {canDismiss && (
              <MobileActionRow
                icon={XCircle}
                label="Dismiss"
                disabled={snapshotPending}
                onClick={() => handleAction("snapshot-dismiss")}
              />
            )}
            {showMutableActions && (
              <MobileActionRow
                icon={email.read ? Mail : MailOpen}
                label={email.read ? "Mark unread" : "Mark read"}
                onClick={() => handleAction("toggle-read")}
              />
            )}
            {gmailUrl && (
              <MobileActionRow
                icon={ExternalLink}
                label="Open in Gmail"
                onClick={() => {
                  setActionsOpen(false);
                  window.open(gmailUrl, "_blank", "noopener,noreferrer");
                }}
              />
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
