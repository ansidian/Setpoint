import { CalendarDays } from "lucide-react";
import type { ReactNode } from "react";
import BillBadge from "../../bills/BillBadge";
import FinancialEventStatus from "../../bills/FinancialEventStatus";
import { canCreateManualActualRecord } from "../../bills/manualActualRecordPolicy";
import { Button } from "../../ui/button";
import ActualActionStatus from "./ActualActionStatus";
import { isActualActioned, resolveActualCalendarTarget } from "./actualActionStatusModel";
import { resolveBillExtractionBody } from "./billExtractionBody";
import { resolveBillSeed } from "./billSeedModel";
import { asBillCandidate, type BillResolutionState, type EmailBodyState } from "./readerTypes";
import type { InboxEmailLike } from "../inboxTypes";
import type { FinancialEmailPlan } from "../../../../shared/types/bills";
import useTransactionImportStatus from "./useTransactionImportStatus";
import { resolveTransactionImportStatus } from "./transactionImportStatusModel";
import { TransactionImportStatusView } from "./TransactionImportStatus";

export default function ActualRecordWorkspace({ email, bodyState, billResolution, isMobile = false, onOpenRecordedBill }: {
  email: InboxEmailLike;
  bodyState: EmailBodyState;
  billResolution: BillResolutionState;
  isMobile?: boolean;
  onOpenRecordedBill?: (target: { date: string; itemId: string }) => void;
}) {
  const { plan, status, retry } = billResolution;
  // A missing ownership result must never fall through to the historical writer.
  if (!plan) return <RecordLookupStatus error={status === "error"} retry={retry} />;

  const extractionBody = resolveBillExtractionBody(bodyState);
  const calendarTarget = resolveActualCalendarTarget(billResolution.actualStatus);
  const form = <BillBadge
    key={String(email.uid || email.email_id || email.id)}
    layout={isMobile ? "mobile" : "drawer"}
    bill={resolveBillSeed(billResolution, asBillCandidate(email.extractedBill))}
    model={email.billModel}
    emailSubject={email.subject || ""}
    emailFrom={email.from || ""}
    emailBody={extractionBody.body}
    emailBodyLoading={extractionBody.loading}
    emailBodySource={extractionBody.source}
    emailBodyError={extractionBody.error}
    plan={plan}
    planLoading={status === "loading"}
  />;
  return <>
    {plan.workflow ? form : <HistoricalActualRecord
      emailUid={String(email.uid || email.email_id || email.id || "")}
      plan={plan}
      billResolution={billResolution}
    >{form}</HistoricalActualRecord>}
    {calendarTarget && onOpenRecordedBill && <Button type="button" variant="outline"
      onClick={() => onOpenRecordedBill(calendarTarget)}
      className="mt-3 hover:-translate-y-px focus-visible:-translate-y-px active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none">
      <CalendarDays aria-hidden="true" /> View in Calendar
    </Button>}
  </>;
}

function RecordLookupStatus({ error, retry }: { error: boolean; retry?: () => void }) {
  return <div role="status" className="text-xs leading-relaxed text-muted-foreground">
    {error ? <>
      <p>Couldn’t load this email’s Actual record. Retry to check its status.</p>
      {retry && <Button type="button" variant="outline" onClick={retry}
        className="mt-3 hover:-translate-y-px focus-visible:-translate-y-px active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none">Retry</Button>}
    </> : "Checking this email’s Actual record…"}
  </div>;
}

function HistoricalActualRecord({ emailUid, plan, billResolution, children }: {
  emailUid: string;
  plan: FinancialEmailPlan;
  billResolution: BillResolutionState;
  children: ReactNode;
}) {
  const imports = useTransactionImportStatus(emailUid);
  if (imports.loading || imports.error) return <RecordLookupStatus error={imports.error} retry={imports.refresh} />;
  if (imports.financialEvent?.workflow) return <FinancialEventStatus plan={imports.financialEvent} allowCompletion />;
  if (imports.items.length) {
    const view = resolveTransactionImportStatus(imports.items);
    return <TransactionImportStatusView view={view || {
      tone: "warning", title: "Existing import record", detail: "Check this email’s import in Finance settings before adding another entry.", review: true, active: false,
    }} />;
  }
  if (!canCreateManualActualRecord(plan)) {
    const recorded = isActualActioned(plan.reconciliation);
    return <>
      {(recorded || plan.reconciliation.status === "needs_review") && <ActualActionStatus resolution={billResolution} />}
      {!recorded && <p role="status" className="mt-3 text-xs leading-relaxed text-muted-foreground">This record needs to be reconciled in Actual before another entry can be added.</p>}
    </>;
  }
  return children;
}
