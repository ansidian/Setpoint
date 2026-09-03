import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { timeClock, timeSince } from "../helpers";
import { MobileStatusPill } from "./MobileReaderControls";
import AnimatedCollapse from "../../shared/AnimatedCollapse";
import type { InboxEmailLike } from "../inboxTypes";

export default function MobileReaderHeader({
  email, accent, isQueuedSnapshot, isUntriagedReadSnapshot, triageSummary,
}: {
  email: InboxEmailLike;
  accent: string;
  isQueuedSnapshot: boolean;
  isUntriagedReadSnapshot: boolean;
  triageSummary?: string | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const senderAddress = email.from_address || email.fromEmail || email.from_email;
  return (
    <header className="mobile-reader-message-header">
      <h1>{email.subject || "(No subject)"}</h1>
      <button
        type="button"
        className="mobile-reader-disclosure mobile-reader-sender"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((value) => !value)}
      >
        <span>{email.from || senderAddress}</span>
        <time>{timeSince(email.date)}</time>
        <ChevronDown size={14} className={detailsOpen ? "is-open" : undefined} />
      </button>
      <AnimatedCollapse open={detailsOpen}>
        <div className="mobile-reader-sender-details">
          {senderAddress && <div>{senderAddress}</div>}
          <div>{email.date ? new Date(email.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : ""} · {timeClock(email.date)}</div>
        </div>
      </AnimatedCollapse>
      {(isQueuedSnapshot || isUntriagedReadSnapshot) && (
        <div style={{ display: "flex", gap: 6, paddingBottom: 8 }}>
          {isQueuedSnapshot && <MobileStatusPill color="#89b4fa" label="Queued" subtle />}
          {isUntriagedReadSnapshot && <MobileStatusPill color="#a6adc8" label="Read" subtle />}
        </div>
      )}
      {triageSummary && (
        <>
          <button
            type="button"
            className="mobile-reader-disclosure"
            aria-expanded={summaryOpen}
            onClick={() => setSummaryOpen((value) => !value)}
            style={{ color: accent }}
          >
            <span>AI summary</span>
            <ChevronDown size={14} className={summaryOpen ? "is-open" : undefined} />
          </button>
          <AnimatedCollapse open={summaryOpen}>
            <p className="mobile-reader-summary">{triageSummary}</p>
          </AnimatedCollapse>
        </>
      )}
    </header>
  );
}
