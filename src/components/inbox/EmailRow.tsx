import { formatSnoozeTime } from "./inboxSnoozedModel";
import { memo, type CSSProperties } from "react";
import { ArrowRight, Clock, KeyRound, Pin } from "lucide-react";
import { LANE } from "../../lib/shell-helpers";
import { getEmailActionHint, timeAgo } from "./helpers";
import type { InboxAccount, InboxEmailLike } from "./inboxTypes";
import { LaneIcon } from "./primitives";
import { isVerificationCodeFresh } from "./reader/verificationCodeModel";

interface EmailRowProps {
  email: InboxEmailLike;
  account?: InboxAccount | null;
  selected?: boolean;
  onOpen: (email: InboxEmailLike) => void;
  density: string;
  showPreview?: boolean;
  accent: string;
  nowTick?: number;
  showLaneTag?: boolean;
}

function EmailRow({ email, account = null, selected = false, onOpen, density,
  showPreview = false, accent, nowTick, showLaneTag = false }: EmailRowProps) {
  const lane = email._lane ? LANE[email._lane] : undefined;
  const freshCode = isVerificationCodeFresh(email, nowTick);
  const actionHint = freshCode ? "Code ready" : email._lane === "handled" ? null : getEmailActionHint(email.action);
  const deadline = email.deadline_at ? new Date(email.deadline_at) : null;
  const dueLabel = email._lane !== "handled" && deadline && !Number.isNaN(deadline.getTime())
    ? `Due ${deadline.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : null;
  const carryover = email._carryover || email._snapshotCarryover || !!email.is_carryover;
  const pending = !!email._optimisticSnapshotPending;
  const showStatus = actionHint || dueLabel || email._resurfaced || email._snoozedUntil;
  return (
    <button
      type="button"
      className="inbox-a-mail-row"
      data-unread={!email.read}
      data-density={density}
      aria-current={selected ? "true" : undefined}
      aria-label={`${email.from}, ${email.subject}, ${email.read ? "Read" : "Unread"}`}
      aria-busy={pending || undefined}
      onClick={() => onOpen(email)}
      style={{ "--ea-accent": accent, "--inbox-lane-color": lane?.color || accent, opacity: pending || email._providerRemoved ? 0.6 : 1 } as CSSProperties}
    >
      <span className="inbox-a-row-top">
        {!email.read && <span className="inbox-a-unread-dot" aria-hidden="true" />}
        <span className="inbox-a-row-sender">{email.from}</span>
        {email._pinned && <Pin size={11} data-testid="email-row-pin" aria-label="Pinned" />}
        <time>{timeAgo(email.date)}</time>
      </span>
      <span className="inbox-a-row-heading">
        <span className="inbox-a-row-subject">{email.subject || "(No subject)"}</span>
        {showLaneTag && lane && <span className="inbox-a-row-lane"><LaneIcon laneKey={String(email._lane)} />{lane.label}</span>}
        {carryover && <span className="inbox-a-row-carry">Carried over</span>}
      </span>
      {showPreview && density !== "compact" && email.preview && <span className="inbox-a-row-preview">{email.preview}</span>}
      {showStatus && <span className="inbox-a-row-bottom">
        {actionHint && <span className="inbox-a-action-hint">{freshCode ? <KeyRound size={12} /> : <ArrowRight size={12} />}{actionHint}</span>}
        {dueLabel && <span>{dueLabel}</span>}
        {email._snoozedUntil && <span className="inbox-a-return-time">Returns {formatSnoozeTime(email._snoozedUntil)}</span>}
        {email._resurfaced && !email._snoozed && <span className="inbox-a-return-time"><Clock size={12} />Returned from snooze</span>}
      </span>}
      {account?.name && showLaneTag && <span className="inbox-a-row-account">{account.name}</span>}
    </button>
  );
}

// Email row objects are rebuilt fresh on every controller recompute
// (buildInboxRow allocates a new object), so a default React.memo shallow
// compare on `email` never bails. Compare the row identity plus exactly the
// fields the render reads, so search keystrokes, lane toggles, selection
// moves, and the now-tick only re-render the rows whose visible state changed.
function rowKeyFields(email: InboxEmailLike): unknown[] {
  return [
    email.id, email.uid,
    email.read, email._lane, email._resurfaced,
    email._arrivalGraceQueued, email._untriagedRead,
    email.action, email.deadline_at, email._carryover, email._snapshotCarryover, email.is_carryover, email.from, email.fromEmail,
    email.subject, email.preview, email.date, email._snoozedUntil, email._snoozedReturning,
    email.urgentFlag?.label, email.urgentFlag,
    email._pinned, email._providerRemoved,
    email._optimisticSnapshotPending,
    email.verification_code?.code, email.verification_code?.active_until,
  ];
}

function areEqual(prev: EmailRowProps, next: EmailRowProps) {
  if (
    prev.selected !== next.selected
    || prev.density !== next.density
    || prev.showPreview !== next.showPreview
    || prev.accent !== next.accent
    || prev.onOpen !== next.onOpen
    || prev.account !== next.account
    || prev.showLaneTag !== next.showLaneTag
  ) {
    return false;
  }
  // nowTick only changes the rendered output for rows with expiring verification
  // codes. Ignore it for every other row so a tick does not re-render the whole
  // list — that is the whole point of the memo.
  if (
    (prev.email.verification_code
      || next.email.verification_code)
    && prev.nowTick !== next.nowTick
  ) {
    return false;
  }
  const a = rowKeyFields(prev.email);
  const b = rowKeyFields(next.email);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export default memo(EmailRow, areEqual);
