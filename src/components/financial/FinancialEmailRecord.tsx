import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronDown, X } from "lucide-react";
import { financialHref } from "./financialNavigation";
import useTransactionImportStatus from "../inbox/reader/useTransactionImportStatus";
import useEmailBody from "../inbox/reader/useEmailBody";
import EmailBodyPane from "../inbox/reader/EmailBodyPane";
import { Button } from "../ui/button";
import { financialReviewHref } from "../../lib/financialReviewApi";

const actionClass = "hover:-translate-y-px focus-visible:-translate-y-px active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none";

function SourceEmail({ emailUid }: { emailUid: string }) {
  const email = { uid: emailUid };
  const state = useEmailBody(email);
  return <div className="mt-2 min-w-0 overflow-hidden rounded-md border border-white/10"><EmailBodyPane state={state} email={email} /></div>;
}

/** The managed status facade is the only entrance; no legacy or independent writer fallback. */
export default function FinancialEmailRecord({ emailUid }: { emailUid: string }) {
  const status = useTransactionImportStatus(emailUid, { pollAllStates: true });
  const [sourceOpen, setSourceOpen] = useState(false);
  const plan = status.financialEvent;
  const navigate = useNavigate();
  useEffect(() => {
    if (plan?.workflow?.id) navigate(financialHref({ source:"managed",view:plan.workflow.state === "settled" ? "completed" : "needs_attention" }, { owner:plan.workflow.completion?.eventRevision === null ? "document" : "event",id:plan.workflow.id.replace(/^(event|document):/,"") }), { replace:true });
  },[plan,navigate]);
  return <section aria-label="Actual record" className="mb-5 min-w-0 border-y border-primary/20 py-4">
    <div className="mb-3 flex items-start justify-between gap-3">
      <h3 className="min-w-0 break-words text-sm font-medium">{plan?.targets.payee.label || "Actual record"}</h3>
      <Link to={financialReviewHref()} aria-label="Close Actual record" className={`shrink-0 rounded-md p-2 text-muted-foreground outline-none transition-[background-color,transform] hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary ${actionClass}`}><X size={16} /></Link>
    </div>
    {status.loading && <p role="status" className="text-xs text-muted-foreground">Checking this email’s Actual record…</p>}
    {status.error && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--sp-cream)]">
      <span>Couldn’t refresh this record. {plan ? "Your entered details are still here." : "Retry to check its current status."}</span>
      <Button type="button" variant="ghost" size="sm" className={actionClass} onClick={status.refresh}>Retry status</Button>
    </div>}
    {plan?.workflow && <p role="status">Opening financial activity…</p>}
    {!status.loading && !status.error && !plan?.workflow && <p role="status" className="text-xs text-muted-foreground">This email has no active financial record in the new workflow.</p>}
    <Button type="button" variant="ghost" size="sm" aria-expanded={sourceOpen} className={`mt-3 ${actionClass}`} onClick={() => setSourceOpen(!sourceOpen)}>
      <ChevronDown size={14} className={sourceOpen ? "rotate-180" : ""} />{sourceOpen ? "Hide source email" : "View source email"}
    </Button>
    {sourceOpen && <SourceEmail emailUid={emailUid} />}
  </section>;
}
