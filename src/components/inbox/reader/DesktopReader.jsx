import {
  ArrowDown,
  ArrowUp,
  Clock,
  CreditCard,
  ExternalLink,
  Mail,
  MailOpen,
  Pin,
  Reply,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { getGmailUrl } from "../../../lib/email-links";
import { timeClock, timeSince } from "../helpers";
import { Avatar, Kbd, QuickAction } from "../primitives";
import SnoozePicker from "../SnoozePicker";
import BillBadge from "../../bills/BillBadge";
import TriagePanel from "./TriagePanel";
import EmailBodyPane from "./EmailBodyPane";
import DraftReply from "./DraftReply";

function LiveEmailNotice() {
  return (
    <div
      style={{
        margin: "16px 20px 0",
        borderRadius: 12,
        padding: "10px 14px",
        background: "linear-gradient(135deg, rgba(137,180,250,0.06), rgba(137,180,250,0.02))",
        border: "1px dashed rgba(137,180,250,0.28)",
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
          background: "rgba(137,180,250,0.12)",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 4,
            borderRadius: 999,
            background: "#89b4fa",
            opacity: 0.3,
            animation: "livepulse 2s ease-out infinite",
          }}
        />
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: "#89b4fa",
            boxShadow: "0 0 6px #89b4fa",
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
            color: "#89b4fa",
          }}
        >
          Live · not yet triaged
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
          Arrived after your last briefing. Not yet triaged.
        </div>
      </div>
    </div>
  );
}

function BillDrawer({ billOpen, billMounted, setBillOpen, email }) {
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
            borderLeft: "1px solid rgba(203,166,218,0.12)",
            background: "rgba(22,22,30,0.55)",
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
                color: "#cba6da",
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
        </aside>
      )}
    </div>
  );
}

export default function DesktopReader({
  email,
  account,
  accent,
  pinned,
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
  drafting,
  setDrafting,
}) {
  const gmailUrl = getGmailUrl(email);

  return (
    <div
      style={{
        flex: 1.3,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: "rgba(22,22,30,0.5)",
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
        <QuickAction icon={ArrowUp} hint="K" onClick={() => onAction("prev")} accent={accent} />
        <QuickAction icon={ArrowDown} hint="J" onClick={() => onAction("next")} accent={accent} />
        <span style={{ flex: 1 }} />
        {(email._untriaged || email.hasBill) && (
          <QuickAction
            icon={CreditCard}
            label={billOpen ? "Hide bill" : "Pay bill"}
            primary={!billOpen}
            onClick={() => setBillOpen((value) => !value)}
            accent="#a6e3a1"
          />
        )}
        <QuickAction
          icon={email.read ? Mail : MailOpen}
          label={email.read ? "Mark unread" : "Mark read"}
          hint="U"
          onClick={() => onAction("toggle-read")}
          accent={accent}
        />
        <QuickAction
          icon={Pin}
          label={pinned ? "Pinned" : "Pin"}
          hint="P"
          onClick={() => onAction("pin")}
          accent={accent}
        />
        <QuickAction
          icon={Clock}
          label="Snooze"
          hint="S"
          buttonRef={snoozeBtnRef}
          onClick={() => setSnoozeOpen((value) => !value)}
          accent={accent}
          holdProgress={snoozeHoldProgress}
          holdColor="#f97316"
        />
        {snoozeOpen && (
          <SnoozePicker
            anchorRef={snoozeBtnRef}
            onSelect={(untilTs) => onAction("snooze", untilTs)}
            onClose={() => setSnoozeOpen(false)}
          />
        )}
        {gmailUrl && (
          <QuickAction
            icon={ExternalLink}
            label="Open in Gmail"
            hint="O"
            title="Open in Gmail"
            onClick={() => window.open(gmailUrl, "_blank", "noopener,noreferrer")}
            accent={accent}
          />
        )}
        <QuickAction
          icon={Trash2}
          label="Trash"
          hint="E"
          danger
          onClick={() => onAction("trash")}
          accent={accent}
          holdProgress={trashHoldProgress}
          holdColor="#f38ba8"
        />
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
                      color: "rgba(205,214,244,0.45)",
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
                  color: "rgba(205,214,244,0.5)",
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

        {email._untriaged && <LiveEmailNotice />}

        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <EmailBodyPane state={bodyState} fallback={email.body || email.preview} />
          </div>
          <BillDrawer
            billOpen={billOpen}
            billMounted={billMounted}
            setBillOpen={setBillOpen}
            email={email}
          />
        </div>

        {showDraft && email.claude?.draftReply && (
          <div style={{ flexShrink: 0, maxHeight: "45%", overflowY: "auto" }}>
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
      </div>

      {!drafting && !showDraft && email.claude?.draftReply && (
        <div
          style={{
            padding: "10px 20px",
            flexShrink: 0,
            borderTop: "1px solid rgba(255,255,255,0.05)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(24,24,37,0.8)",
          }}
        >
          <Sparkles size={11} color={accent} />
          <span style={{ fontSize: 11, color: "rgba(205,214,244,0.7)", flex: 1 }}>
            Draft reply ready.{" "}
            <span style={{ color: "rgba(205,214,244,0.45)" }}>
              Press <Kbd>R</Kbd> to review.
            </span>
          </span>
          <QuickAction
            icon={Reply}
            label="Review reply"
            primary
            onClick={() => setDrafting(true)}
            hint="R"
            accent={accent}
          />
        </div>
      )}
    </div>
  );
}
