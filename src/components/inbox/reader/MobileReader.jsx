import { useRef, useState } from "react";
import {
  ArrowLeft,
  BellOff,
  Check,
  Clock,
  CreditCard,
  FileText,
  ExternalLink,
  Mail,
  MailOpen,
  Pin,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { getGmailUrl } from "../../../lib/email-links";
import { timeSince } from "../helpers";
import SnoozePicker from "../SnoozePicker";
import AnchoredFloatingPanel from "../../shared/pickers/AnchoredFloatingPanel";
import EmailBodyPane from "./EmailBodyPane";
import DraftReply from "./DraftReply";
import MobileActionRow from "./MobileActionRow";
import { resolveReaderActions } from "./readerActionsModel.js";
import MobileBillDrawer from "./MobileBillDrawer";
import MobileReaderHeader from "./MobileReaderHeader";

export default function MobileReader({
  email,
  account,
  accent,
  onAction,
  onClose,
  showTriage,
  billOpen,
  setBillOpen,
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
    isQueuedSnapshot,
    isUntriagedReadSnapshot,
    showMutableActions,
    showDestructiveActions,
    billToggleEligible,
    showSnapshotWorkflowActions,
    canReopen,
    canHandle,
    canDismiss,
    canMoveToNeeds,
    canMoveToFyi,
    canMoveToNoise,
    canPin,
    pinned,
  } = resolveReaderActions(email, { readOnly });
  const showBillToggle = showDestructiveActions && billToggleEligible;
  const triageSummary = showTriage ? email.claude?.summary || email.aiSummary || null : null;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [billExpanded, setBillExpanded] = useState(false);
  const actionsBtnRef = useRef(null);
  const actionsPanelRef = useRef(null);
  const handleAction = (kind, payload) => {
    setActionsOpen(false);
    onAction(kind, payload);
  };

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
              isMobile
            />
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <EmailBodyPane state={bodyState} fallback={email.body || email.preview} isMobile />
        </div>

        {billOpen && (
          <MobileBillDrawer
            email={email}
            billExpanded={billExpanded}
            setBillExpanded={setBillExpanded}
            bodyState={bodyState}
            billResolution={billResolution}
          />
        )}
      </div>

      {actionsOpen && (
        <AnchoredFloatingPanel
          anchorRef={actionsBtnRef}
          panelRef={actionsPanelRef}
          onClose={() => setActionsOpen(false)}
          width={220}
          height={showSnapshotWorkflowActions ? 420 : showBillToggle || email.claude?.draftReply ? 320 : 260}
          role="menu"
          ariaLabel="Email actions"
          style={{
            padding: 8,
          }}
        >
          <div data-testid="inbox-mobile-actions-menu" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                icon={CreditCard}
                label={billOpen ? "Hide bill pay" : "Open bill pay"}
                active={billOpen}
                onClick={() => {
                  setActionsOpen(false);
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
                onClick={() => handleAction("snapshot-reopen")}
              />
            )}
            {canMoveToNeeds && (
              <MobileActionRow
                icon={Zap}
                label="Move to Needs"
                onClick={() => handleAction("snapshot-move-lane", "needs_attention")}
              />
            )}
            {canMoveToFyi && (
              <MobileActionRow
                icon={FileText}
                label="Move to FYI"
                onClick={() => handleAction("snapshot-move-lane", "fyi")}
              />
            )}
            {canMoveToNoise && (
              <MobileActionRow
                icon={BellOff}
                label="Move to Noise"
                onClick={() => handleAction("snapshot-move-lane", "noise")}
              />
            )}
            {canHandle && (
              <MobileActionRow
                icon={Check}
                label="Handled"
                onClick={() => handleAction("snapshot-handled")}
              />
            )}
            {canDismiss && (
              <MobileActionRow
                icon={XCircle}
                label="Dismiss"
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
            {showDestructiveActions && (
              <MobileActionRow
                icon={Clock}
                label="Snooze"
                onClick={() => {
                  setActionsOpen(false);
                  setSnoozeOpen(true);
                }}
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
            {showDestructiveActions && (
              <MobileActionRow
                icon={Trash2}
                label="Trash"
                danger
                onClick={() => handleAction("trash")}
              />
            )}
          </div>
        </AnchoredFloatingPanel>
      )}

      {showDestructiveActions && snoozeOpen && (
        <SnoozePicker
          anchorRef={actionsBtnRef}
          onSelect={(untilTs) => onAction("snooze", untilTs)}
          onClose={() => setSnoozeOpen(false)}
        />
      )}
    </div>
  );
}
