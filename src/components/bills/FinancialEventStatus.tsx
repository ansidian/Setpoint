import { CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { useId, useRef, useState, type CSSProperties } from "react";
import type { FinancialEmailPlan } from "../../../shared/types/bills";
import { Button } from "../ui/button";
import FinancialEventCompletionForm from "./FinancialEventCompletionForm";

type FinancialEventStatusProps = { plan: FinancialEmailPlan; style?: CSSProperties; allowCompletion?: boolean };

export default function FinancialEventStatus(props: FinancialEventStatusProps) {
  return <FinancialEventStatusPanel key={props.plan.workflow?.completion?.emailUid || props.plan.workflow?.id} {...props} />;
}

function FinancialEventStatusPanel({ plan: currentPlan, style, allowCompletion = false }: FinancialEventStatusProps) {
  const [editing, setEditing] = useState(allowCompletion);
  const [queued, setQueued] = useState<FinancialEmailPlan | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const editorId = useId();
  // Keep the accepted response visible while a previously cached read catches
  // up. Subsequent worker states at the same/newer revision are authoritative.
  const plan = queued && (currentPlan.workflow?.completion?.eventRevision ?? -1) < (queued.workflow?.completion?.eventRevision ?? -1)
    ? queued : currentPlan;
  const workflow = plan.workflow;
  if (!workflow) return null;
  const pending = workflow.state === "pending";
  const settled = workflow.state === "settled";
  const needsReview = workflow.state === "needs_review";
  const scheduled = settled && plan.reconciliation.status === "already_scheduled";
  const recorded = settled && plan.reconciliation.status === "already_recorded";
  const color = settled ? "var(--sp-green)" : pending ? "var(--sp-blue)" : "var(--sp-cream)";
  const Icon = settled ? CheckCircle2 : pending ? Loader2 : Clock3;
  const title = recorded ? "Recorded in Actual" : scheduled ? "Scheduled in Actual"
    : settled ? "No entry needed" : needsReview ? "Actual entry needs attention"
      : pending ? "Checking financial details" : "Waiting for payment details";
  const details = [
    workflow.reason,
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
      {allowCompletion && !editing && workflow.completion?.canComplete && <Button ref={trigger} type="button" variant="ghost" size="sm"
        aria-expanded={editing} aria-controls={editorId}
        className="mt-2 h-8 text-xs transition-transform hover:-translate-y-px focus-visible:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
        onClick={(event) => { event.stopPropagation(); setEditing(true); }}>
        Complete details
      </Button>}
      {allowCompletion && editing && workflow.completion?.canComplete && <div id={editorId}><FinancialEventCompletionForm plan={plan}
        onCancel={() => { setEditing(false); requestAnimationFrame(() => trigger.current?.focus()); }}
        onQueued={(result) => { setQueued(result); setEditing(false); }}
      /></div>}
    </div>
  );
}
