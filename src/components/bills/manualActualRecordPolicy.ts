import type { FinancialEmailPlan } from "../../../shared/types/bills";

// Manual details may correct an AI no-write assessment, but cannot replace an
// existing record, an ambiguous Actual match, or a managed/attempted operation.
// The reader also checks the email's import owner before mounting this form.
export function canCreateManualActualRecord(
  plan: Pick<FinancialEmailPlan, "workflow" | "transferExecution" | "reconciliation"> | null | undefined,
): boolean {
  if (!plan || plan.workflow || plan.transferExecution?.attemptedAt) return false;
  const { status, disposition, evidence } = plan.reconciliation;
  if (["already_recorded", "already_scheduled", "needs_review"].includes(status)) return false;
  if (disposition === "no_write" || disposition === "update_existing") return false;
  return !(evidence?.transactionId || evidence?.scheduleId || evidence?.transactionIds?.length || evidence?.scheduleIds?.length);
}
