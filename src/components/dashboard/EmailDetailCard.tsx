import { AlignLeft, ArrowRight, ArrowUpRight, Clock3, Flag, History, UserRound } from "lucide-react";
import { RailAction, RailActionGroup, RailHeroCard } from "../calendar/DetailRailPrimitives";
import type { NeedsYouEmail } from "./needsYou/needsYouModel";
import "./EmailDetailCard.css";

export default function EmailDetailCard({ email, onOpen }: { email: NeedsYouEmail; onOpen: () => void }) {
  const sender = email.from_name || email.from || email.from_address || "Unknown sender";
  const summary = email.summary || email.preview;
  const subject = email.subject || "(no subject)";
  const title = email.is_carryover ? subject.replace(/^carryover:\s*/i, "") || subject : subject;
  const resurfaced = email.source === "resurfaced_snooze" || email._resurfaced;
  return (
    <RailHeroCard compact accent="var(--sp-blue)" actions={
      <RailActionGroup>
        <RailAction icon={ArrowUpRight} label="Open email" tone="accent" size="compact" onClick={onOpen} />
      </RailActionGroup>
    }>
      <h3 className="calendar-detail-title">{title}</h3>
      {(email.is_carryover || resurfaced || email.escalation_badge) && <div className="email-detail-badges">
        {email.is_carryover && <span className="email-detail-badge"><History size={12} aria-hidden="true" />Carryover</span>}
        {resurfaced && <span className="email-detail-badge"><Clock3 size={12} aria-hidden="true" />Returned from snooze</span>}
        {email.escalation_badge && <span className="email-detail-badge email-detail-badge--urgent"><Flag size={12} aria-hidden="true" />{email.escalation_badge}</span>}
      </div>}
      <div className="email-detail-sender">
        <UserRound size={15} aria-hidden="true" />
        <div><span className="email-detail-from">From </span><span>{sender}</span>
          {email.from_address && email.from_address !== sender && <div className="email-detail-address">{email.from_address}</div>}
        </div>
      </div>
      <dl className="email-detail-content">
        <div className="email-detail-summary">
          <dt><AlignLeft size={14} aria-hidden="true" />Summary</dt>
          <dd>{summary || "No summary available. Open the email to read the message."}</dd>
        </div>
        {email.action && <div className="email-detail-action">
          <dt><ArrowRight size={14} aria-hidden="true" />Action</dt>
          <dd>{email.action}</dd>
        </div>}
      </dl>
    </RailHeroCard>
  );
}
