import { financialHref } from "../financial/financialNavigation";
import { Link } from "react-router";
import { CheckCircle2, Clock3, Loader2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { FinancialEmailPlan } from "../../../shared/types/bills";

export default function FinancialEventStatus({ plan, style }: { plan: FinancialEmailPlan; style?: CSSProperties }) {
  const workflow = plan.workflow;
  if (!workflow) return null;
  const correction = workflow.correction;
  const kept = correction?.state === 'completed' && correction.resolution === 'kept_actual';
  const correcting = correction && !['completed','superseded'].includes(correction.state);
  const pending = correcting ? correction.state !== 'attention' : workflow.state === "pending";
  const settled = !correcting && workflow.state === "settled";
  const needsReview = workflow.state === "needs_review";
  const scheduled = settled && plan.reconciliation.status === "already_scheduled";
  const recorded = settled && plan.reconciliation.status === "already_recorded";
  const color = settled ? "var(--sp-green)" : pending ? "var(--sp-blue)" : "var(--sp-cream)";
  const Icon = settled ? CheckCircle2 : pending ? Loader2 : Clock3;
  const title = correcting ? correction.state === 'attention' ? 'Correction needs attention' : 'Checking correction progress'
    : kept ? 'Current Actual result kept' : correction?.state === 'completed' ? 'Corrected in Actual' : recorded ? "Recorded in Actual" : scheduled ? "Scheduled in Actual"
    : settled ? "No entry needed" : needsReview ? "Actual entry needs attention"
      : pending ? "Checking financial details" : "Waiting for payment details";
  const details = [
    correcting ? 'The correction is retained. Inspect its outcome before making another change.' : kept ? plan.reconciliation.reason : workflow.reason,
    workflow.relatedEmails > 1 ? `${workflow.relatedEmails} related emails describe this event.` : null,
    !settled && workflow.nextAttemptAt ? "Checks again automatically." : null,
  ].filter(Boolean).join(" ");
  return (
    <div className="min-w-0 shrink-0 rounded-lg border px-3 py-2.5"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 24%, transparent)`,
        background: `color-mix(in srgb, ${color} 5%, var(--sp-panel))`, ...style }}>
      <div role="status" aria-live="polite" className="flex min-w-0 items-start gap-2.5">
        <Icon aria-hidden="true" size={15} className={pending ? "mt-0.5 shrink-0 animate-spin motion-reduce:animate-none" : "mt-0.5 shrink-0"} />
        <div className="min-w-0 break-words text-[11px] leading-relaxed">
          <div className="font-semibold">{title}</div>
          <div className="mt-0.5 text-foreground/80">{details}</div>
        </div>
      </div>
      {correction && <Link to={financialHref({ view: correcting ? 'needs_attention' : 'completed' }, { owner: 'event', id: workflow.id })}
        className="mt-2 inline-flex rounded-lg border border-white/10 px-3 py-2 text-xs transition-transform hover:-translate-y-px focus-visible:-translate-y-px focus-visible:outline-2 focus-visible:outline-primary active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none">View record</Link>}
    </div>
  );
}
