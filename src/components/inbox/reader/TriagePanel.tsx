import { useState, type ReactNode } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { LANE } from "../../../lib/shell-helpers";
import AnimatedCollapse from "../../shared/AnimatedCollapse";
import type { InboxEmailLike } from "../inboxTypes";
import "./TriagePanel.css";

export default function TriagePanel({ email, accent, children }: { email: InboxEmailLike; accent: string; children?: ReactNode }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!email?.claude && !email?.aiSummary && !email?.summary) return null;
  const summary = email.claude?.summary || email.aiSummary || email.summary;
  const points = email.claude?.points || email.claude?.bulletPoints || [];
  const why = email.claude?.why;
  const laneKey = email._lane;
  const lane = laneKey ? LANE[laneKey] : undefined;
  const hasDetails = !!(points.length || why || email.category || email.urgency || email.action);

  return (
    <section className="reader-triage-context" aria-label="Email context" style={{ borderTopColor: `${lane?.color || accent}38` }}>
      <div className="reader-triage-title" style={{ color: lane?.color || accent }}>
        <Sparkles size={15} aria-hidden="true" />
        <span>{laneKey === "needs_attention" || laneKey === "carryover" || laneKey === "action" ? "What needs you" : "At a glance"}</span>
      </div>
      {summary && <p className="reader-triage-summary">{summary}</p>}
      {children && <div className="inbox-a-reader-context-actions">{children}</div>}
      {hasDetails && <>
        <button type="button" className="reader-triage-disclosure" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)}>
          Triage details <ChevronDown size={12} aria-hidden="true" />
        </button>
        <AnimatedCollapse open={detailsOpen}>
          <div className="reader-triage-details">
            <dl>
              {email.action && <div><dt>Suggested action</dt><dd>{email.action}</dd></div>}
              {email.category && <div><dt>Category</dt><dd>{email.category}</dd></div>}
              {email.urgency && <div><dt>Urgency</dt><dd>{email.urgency}</dd></div>}
            </dl>
            {points.length > 0 && <ul>{points.map((point, index) => <li key={index}>{point}</li>)}</ul>}
            {why && <p>{lane ? `Why ${lane.label}: ` : "Reason: "}{why}</p>}
          </div>
        </AnimatedCollapse>
      </>}
    </section>
  );
}
