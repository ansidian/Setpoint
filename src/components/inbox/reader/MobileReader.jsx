import { useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Ellipsis,
  FileText,
  ExternalLink,
  Mail,
  MailOpen,
  Pin,
  Trash2,
} from "lucide-react";
import { getGmailUrl } from "../../../lib/email-links";
import { timeClock, timeSince } from "../helpers";
import { Avatar } from "../primitives";
import SnoozePicker from "../SnoozePicker";
import BillBadge from "../../bills/BillBadge";
import AnchoredFloatingPanel from "../../shared/pickers/AnchoredFloatingPanel";
import EmailBodyPane from "./EmailBodyPane";
import DraftReply from "./DraftReply";

function MobileStatusPill({ color, label, subtle = false }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 9px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color,
        background: subtle ? `${color}12` : `${color}18`,
        border: `1px solid ${color}${subtle ? "2c" : "38"}`,
      }}
    >
      {!subtle && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
      )}
      {label}
    </span>
  );
}

function InlineControlButton({ icon, label, active = false, onClick, buttonRef }) {
  const IconComponent = icon;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 10px",
        borderRadius: 10,
        border: `1px solid ${active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)"}`,
        background: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
        color: active ? "#fff" : "rgba(205,214,244,0.72)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 10,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      <IconComponent size={11} />
      {label}
    </button>
  );
}

function MobileActionRow({
  icon,
  label,
  onClick,
  active = false,
  danger = false,
}) {
  const IconComponent = icon;
  const tint = danger ? "#f38ba8" : active ? "#fff" : "rgba(205,214,244,0.8)";
  const background = danger ? "rgba(243,139,168,0.08)" : active ? "rgba(255,255,255,0.08)" : "transparent";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        minWidth: 0,
        padding: "11px 12px",
        borderRadius: 10,
        border: `1px solid ${danger ? "rgba(243,139,168,0.18)" : active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`,
        background,
        color: tint,
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
      }}
    >
      <IconComponent size={14} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600 }}>
        {label}
      </span>
    </button>
  );
}

export default function MobileReader({
  email,
  account,
  accent,
  pinned,
  onAction,
  onClose,
  showTriage,
  billOpen,
  setBillOpen,
  snoozeOpen,
  setSnoozeOpen,
  bodyState,
  drafting,
  setDrafting,
}) {
  const gmailUrl = getGmailUrl(email);
  const showBillToggle = email._untriaged || email.hasBill;
  const triageSummary = showTriage
    ? email.claude?.summary || email.aiSummary || null
    : null;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [billExpanded, setBillExpanded] = useState(false);
  const actionsBtnRef = useRef(null);
  const actionsPanelRef = useRef(null);

  const billPanelHeight = billExpanded ? "52%" : "38%";
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
        background: "#16161e",
      }}
    >
      <div
        style={{
          padding: "12px 14px 10px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(11,11,19,0.94)",
          backdropFilter: "blur(14px)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          aria-label="Back to inbox"
          onClick={onClose}
          style={{
            width: 34,
            height: 34,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            color: "rgba(205,214,244,0.8)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <ArrowLeft size={16} />
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
        <div style={{ padding: "10px 16px 8px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <h1
              className="ea-display"
              style={{
                flex: 1,
                margin: 0,
                fontSize: 18,
                lineHeight: 1.06,
                fontWeight: 500,
                letterSpacing: -0.35,
                color: "#fff",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {email.subject}
            </h1>
            <InlineControlButton
              buttonRef={actionsBtnRef}
              icon={Ellipsis}
              label="Actions"
              active={actionsOpen || snoozeOpen}
              onClick={() => setActionsOpen((value) => !value)}
            />
          </div>

          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 9 }}>
            <Avatar
              name={email.from}
              email={email.fromEmail}
              color={account?.color || accent}
              size={28}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#fff",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {email.from}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(205,214,244,0.5)",
                  marginTop: 1,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>{timeClock(email.date)}</span>
                <span style={{ opacity: 0.35 }}>·</span>
                <span>{timeSince(email.date)}</span>
                {account?.name && (
                  <>
                    <span style={{ opacity: 0.35 }}>·</span>
                    <span style={{ color: account.color || accent }}>{account.name}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {email._untriaged && (
              <MobileStatusPill color="#89b4fa" label="Live" />
            )}
            {billOpen && (
              <MobileStatusPill color="#a6e3a1" label="Bill pay open" subtle />
            )}
            {drafting && <MobileStatusPill color={accent} label="Draft open" subtle />}
          </div>

          {triageSummary && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                borderRadius: 12,
                background: `linear-gradient(135deg, ${accent}12, rgba(137,220,235,0.04))`,
                border: `1px solid ${accent}2c`,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                  color: accent,
                }}
              >
                Briefing triage
              </div>
              <div
                className="ea-display"
                style={{
                  marginTop: 4,
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {triageSummary}
              </div>
            </div>
          )}
        </div>

        {drafting && email.claude?.draftReply && (
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
              onSend={() => {
                setDrafting(false);
                onAction("trash");
              }}
              onDiscard={() => setDrafting(false)}
            />
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <EmailBodyPane state={bodyState} fallback={email.body || email.preview} isMobile />
        </div>

        {billOpen && (
          <div
            data-testid="inbox-mobile-bill-panel"
            style={{
              flexShrink: 0,
              height: billPanelHeight,
              minHeight: 220,
              maxHeight: "58%",
              display: "flex",
              flexDirection: "column",
              borderTop: "1px solid rgba(166,227,161,0.18)",
              background: "rgba(20,20,28,0.98)",
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
                    color: "#a6e3a1",
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
                    ${Number(email.extractedBill.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                )}
                {email.extractedBill?.due_date && (
                  <>
                    <span style={{ color: "rgba(205,214,244,0.26)" }}>·</span>
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
                bill={email.extractedBill || {
                  payee: "",
                  amount: null,
                  due_date: "",
                  type: "expense",
                }}
                model={email.billModel}
                emailSubject={email.subject}
                emailFrom={email.from}
                emailBody={email.body || email.preview}
              />
            </div>
          </div>
        )}
      </div>

      {actionsOpen && (
        <AnchoredFloatingPanel
          anchorRef={actionsBtnRef}
          panelRef={actionsPanelRef}
          onClose={() => setActionsOpen(false)}
          width={220}
          height={showBillToggle || email.claude?.draftReply ? 320 : 260}
          role="menu"
          ariaLabel="Email actions"
          style={{
            padding: 8,
          }}
        >
          <div data-testid="inbox-mobile-actions-menu" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
            {email.claude?.draftReply && (
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
            <MobileActionRow
              icon={email.read ? Mail : MailOpen}
              label={email.read ? "Mark unread" : "Mark read"}
              onClick={() => handleAction("toggle-read")}
            />
            <MobileActionRow
              icon={Pin}
              label={pinned ? "Unpin" : "Pin"}
              active={pinned}
              onClick={() => handleAction("pin")}
            />
            <MobileActionRow
              icon={Clock}
              label="Snooze"
              onClick={() => {
                setActionsOpen(false);
                setSnoozeOpen(true);
              }}
            />
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
            <MobileActionRow
              icon={Trash2}
              label="Trash"
              danger
              onClick={() => handleAction("trash")}
            />
          </div>
        </AnchoredFloatingPanel>
      )}

      {snoozeOpen && (
        <SnoozePicker
          anchorRef={actionsBtnRef}
          onSelect={(untilTs) => onAction("snooze", untilTs)}
          onClose={() => setSnoozeOpen(false)}
        />
      )}
    </div>
  );
}
