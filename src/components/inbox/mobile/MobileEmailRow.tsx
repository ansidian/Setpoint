import { memo } from "react";
import { Clock, KeyRound, Pin } from "lucide-react";
import { LANE } from "../../../lib/shell-helpers";
import { timeAgo } from "../helpers";
import { Avatar, LaneIcon } from "../primitives";
import { isVerificationCodeFresh } from "../reader/verificationCodeModel";
import type { InboxAccount, InboxEmailLike } from "../inboxTypes";

function MobileEmailRow({ email, account, onOpen, showPreview, accent, nowTick }: {
  email: InboxEmailLike;
  account?: InboxAccount;
  onOpen: (email: InboxEmailLike) => void;
  showPreview: boolean;
  accent: string;
  nowTick: number;
}) {
  const lane = email._lane ? LANE[email._lane] : undefined;
  const unread = !email.read && email._lane !== "untriaged_read";
  const freshCode = isVerificationCodeFresh(email, nowTick);
  const pending = !!email._optimisticSnapshotPending;
  const urgencyColor = email.urgency === "high" ? "var(--sp-rose)" : "var(--sp-peach)";
  return (
    <button
      type="button"
      className={`mobile-email-row${unread ? " mobile-email-row-unread" : ""}`}
      aria-busy={pending || undefined}
      onClick={() => onOpen(email)}
      style={{ opacity: pending || email._providerRemoved ? 0.6 : 1 }}
    >
      <span className="mobile-email-sender-line">
        <Avatar name={email.from} email={email.fromEmail} color={account?.color || accent} size={20} />
        <span className="mobile-email-sender">{email.from || email.fromEmail || "Unknown sender"}</span>
        {email._pinned && <Pin size={12} color="var(--sp-lavender)" aria-label="Pinned" />}
        <time className="mobile-email-date">{timeAgo(email.date)}</time>
        <span className="mobile-email-unread-dot" aria-hidden="true" style={{ background: unread ? accent : "transparent" }} />
        {unread && <span className="sr-only">Unread</span>}
      </span>
      <span className="mobile-email-subject">{email.subject || "(No subject)"}</span>
      {showPreview && email.preview && <span className="mobile-email-preview">{email.preview}</span>}
      {(freshCode || email._resurfaced || email.urgentFlag || lane) && (
        <span className="mobile-email-status">
          {freshCode ? (
            <span style={{ color: "var(--sp-blue)" }}><KeyRound size={12} aria-hidden="true" />Code ready</span>
          ) : (
            <>
              {email.urgentFlag && email._lane !== "noise" && (
                <span style={{ color: urgencyColor }}>{email.urgentFlag.label || email.urgency}</span>
              )}
              {lane && <span style={{ color: lane.color }}><LaneIcon laneKey={String(email._lane)} />{lane.label}</span>}
            </>
          )}
          {email._resurfaced && <span style={{ color: "var(--sp-orange)" }}><Clock size={12} aria-hidden="true" />Snoozed</span>}
        </span>
      )}
    </button>
  );
}

export default memo(MobileEmailRow);
