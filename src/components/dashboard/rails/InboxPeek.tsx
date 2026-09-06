import { memo, useMemo } from "react";
import { ArrowRight, Inbox } from "lucide-react";
import { EmptyRow, SectionHeader } from "./railPrimitives";
import { timeAgo } from "./railModel";
import { buildInboxPeek } from "./inboxPeekModel";
import type { InboxPeekLane } from "./inboxPeekModel";
import type { ActiveSnapshotView, SnapshotItem } from "../../../../shared/types/snapshots";
import "./InboxPeek.css";

type InboxPeekEmail = Omit<SnapshotItem, "id"> & { id: string | number };
interface InboxPeekProps {
  accent?: string;
  activeSnapshot?: ActiveSnapshotView | null;
  excludedEmailIds?: readonly string[];
  onJump?: (payload: { kind: "email"; id: string | number; email: InboxPeekEmail }) => void;
  onOpenInbox?: (lane?: InboxPeekLane) => void;
  isMobile?: boolean;
}

function InboxPeek({ activeSnapshot, excludedEmailIds, onJump, onOpenInbox, isMobile = false }: InboxPeekProps) {
  const model = useMemo(() => buildInboxPeek(activeSnapshot, excludedEmailIds), [activeSnapshot, excludedEmailIds]);
  const counts: Array<{ lane: InboxPeekLane; label: string; count: number }> = [
    { lane: "needs_attention", label: "Need action", count: model.counts.needs_attention },
    { lane: "carryover", label: "Carryover", count: model.counts.carryover },
    { lane: "fyi", label: "FYI", count: model.counts.fyi },
    { lane: "queued", label: "Queued", count: model.counts.queued },
  ];
  const emptyLabel = !model.available ? "Inbox hasn't loaded yet"
    : model.processing ? "Mail is being processed"
    : model.counts.needs_attention + model.counts.carryover > 0 ? "Urgent mail is in Needs You"
    : "No action or FYI mail in this snapshot";

  return (
    <section className={`dashboard-inbox-peek${isMobile ? " dashboard-inbox-peek--mobile" : ""}`}>
      <SectionHeader title="Inbox peek" isMobile={isMobile} right={<button type="button" className="inbox-peek-open" onClick={() => onOpenInbox?.()}>Open inbox<ArrowRight size={12} aria-hidden="true" /></button>} />
      {model.available && <div className="inbox-peek-counts" aria-label="Current snapshot mail">
        {counts.map(({ lane, label, count }) => <button type="button" key={lane} className="inbox-peek-count" onClick={() => onOpenInbox?.(lane)} aria-label={`${count} ${label.toLowerCase()} emails`}>
          <span>{label}</span><strong>{count}</strong>
        </button>)}
      </div>}
      <div className="inbox-peek-rows">
        {model.rows.map(({ key, lane, email }) => {
          const id = email.uid || email.email_id || email.id;
          const action = email.action?.trim();
          const text = lane !== "fyi" && action && !/^(none|no action|n\/a|review|reply|read|respond|follow up)[.!]?$/i.test(action)
            ? action : email.summary || email.subject;
          return <button type="button" key={key} className="inbox-peek-row" data-read={email.read || undefined} onClick={() => onJump?.({ kind: "email", id, email: { ...email, id } })}>
            <span className="inbox-peek-sender">{email.from_name || email.from_address || email.from || "Unknown sender"}</span>
            <span className="inbox-peek-age">{timeAgo(email.email_date || email.date)}</span>
            <span className="inbox-peek-summary">{text}</span>
            <span className="inbox-peek-row-meta">{lane === "carryover" ? "Carried over" : lane === "needs_attention" ? "Needs action" : "FYI"}{email.read ? " · Read" : " · Unread"}</span>
          </button>;
        })}
        {model.rows.length === 0 && <EmptyRow icon={Inbox} label={emptyLabel} />}
      </div>
      {model.processing && model.rows.length > 0 && <p className="inbox-peek-processing" role="status">More mail is being processed</p>}
    </section>
  );
}

export default memo(InboxPeek);
