import { reconcileFinancialOperation, reconcileTransferSchedule } from "../actual/actual.ts";
import { selectSemanticBillAmount } from "../bills/financial-email-planner.ts";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import type { ActualFinancialOperationInput, ActualFinancialOperationResult } from "../../shared/types/financial-operations.ts";
import type { ActualTransferScheduleInput } from "../../shared/types/transaction-imports.ts";

export type FinancialEventOperation =
  | { executor: "financial"; input: ActualFinancialOperationInput }
  | { executor: "transfer_schedule"; input: ActualTransferScheduleInput };

export function buildFinancialEventOperation(eventId: string, plan: FinancialEmailPlan): FinancialEventOperation | null {
  const candidate = plan.candidate;
  const cents = Math.round(Number(selectSemanticBillAmount(candidate)?.amount) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || !candidate.due_date || candidate.currency !== "USD") return null;
  const identityKey = `financial-event:${eventId}`;
  const date = candidate.due_date;
  const fromAccountId = plan.targets.fromAccount.id;
  const toAccountId = plan.targets.toAccount.id;
  if (plan.operation.intended === "create_transfer_schedule") {
    return fromAccountId && toAccountId && fromAccountId !== toAccountId
      ? { executor: "transfer_schedule", input: { identityKey, fromAccountId, toAccountId, amountCents: cents, date,
          name: plan.targets.schedule.label || `${plan.targets.toAccount.label} Payment` } } : null;
  }
  if (plan.operation.intended === "create_transfer") {
    return fromAccountId && toAccountId && fromAccountId !== toAccountId
      ? { executor: "financial", input: { kind: "completed_transfer", identityKey, fromAccountId, toAccountId,
          amountCents: cents, date, notes: "Recorded from payment confirmation" } } : null;
  }
  const accountId = plan.targets.account.id;
  const payee = plan.targets.payee.label;
  if (!accountId || !payee) return null;
  const base = { identityKey, accountId, payee, payeeId: plan.targets.payee.id,
    categoryId: plan.targets.category.status === "resolved" ? plan.targets.category.id : null, date };
  if (plan.operation.intended === "create_schedule") {
    return { executor: "financial", input: { ...base, kind: "utility_schedule", amountCents: -cents,
      name: plan.targets.schedule.label || payee,
      ...(plan.targets.schedule.id ? { scheduleId: plan.targets.schedule.id } : {}) } };
  }
  return plan.operation.intended === "create_transaction"
    ? { executor: "financial", input: { ...base, kind: "transaction", notes: "Recorded from receipt",
        amountCents: plan.automation.operationClass === "income" ? cents : -cents } } : null;
}

export function bindFinancialEventOperation(operation: FinancialEventOperation, preview: ActualFinancialOperationResult): FinancialEventOperation {
  if (operation.executor === "financial" && operation.input.kind === "utility_schedule") {
    return { ...operation, input: { ...operation.input, budgetId: preview.budgetId,
      ...(preview.scheduleId ? { scheduleId: preview.scheduleId } : {}),
      ...(preview.scheduleFingerprint ? { expectedScheduleFingerprint: preview.scheduleFingerprint } : {}) } };
  }
  return { ...operation, input: { ...operation.input, budgetId: preview.budgetId } } as FinancialEventOperation;
}

/** Only these two existing SDK facades can touch a budget. */
export function createFinancialEventExecutor({
  financial = reconcileFinancialOperation,
  transfer = reconcileTransferSchedule,
}: {
  financial?: typeof reconcileFinancialOperation;
  transfer?: typeof reconcileTransferSchedule;
} = {}) {
  return async function execute(userId: string, operation: FinancialEventOperation,
    mode: "preview" | "write_once" | "recover"): Promise<ActualFinancialOperationResult> {
    if (operation.executor === "financial") return financial(userId, operation.input, mode);
    const result = await transfer(userId, operation.input, mode === "write_once" ? "create_once" : mode);
    return { ...result, outcome: result.outcome === "would_create" ? "would_add"
      : result.outcome === "created" ? "added"
        : ["already_scheduled", "already_recorded"].includes(result.outcome) ? "already_present" : "needs_review" };
  };
}

export function planWithActualResult(plan: FinancialEmailPlan, result: ActualFinancialOperationResult, now: number): FinancialEmailPlan {
  const settled = ["added", "updated", "already_present"].includes(result.outcome);
  const conflict = result.outcome === "needs_review";
  const recorded = !!result.transactionId || ["create_transaction", "create_transfer"].includes(String(plan.operation.intended));
  const gates = plan.automation.gates.map((gate) => ["reconciliation", "actual_preflight"].includes(gate.gate)
    ? { ...gate, status: conflict ? "fail" as const : "pass" as const, reasons: conflict ? ["reconciliation_conflict" as const] : [] }
    : gate);
  return {
    ...plan,
    operation: settled ? { intended: plan.operation.intended, kind: "no_write", reasons: [recorded ? "already_recorded" : "already_scheduled"] }
      : conflict ? { intended: plan.operation.intended, kind: "review", reasons: ["reconciliation_conflict"] }
        : { intended: plan.operation.intended, kind: plan.operation.intended || "review", reasons: [] },
    reconciliation: { status: settled ? recorded ? "already_recorded" : "already_scheduled" : conflict ? "needs_review" : "not_scheduled",
      disposition: settled ? "no_write" : conflict ? "review" : result.outcome === "would_update" ? "update_existing" : "create",
      reason: result.reason, checkedAt: new Date(now).toISOString(),
      evidence: result.transactionId ? { kind: "transaction", transactionId: result.transactionId }
        : result.scheduleId ? { kind: "schedule", scheduleId: result.scheduleId } : null },
    reviewReasons: conflict ? [{ code: "reconciliation_conflict", message: result.reason, blocking: true }]
      : plan.reviewReasons.filter((reason) => !["reconciliation_conflict", "reconciliation_unavailable", "actual_preflight_not_run"].includes(reason.code)),
    automation: { ...plan.automation, gates,
      eligible: !settled && !conflict && gates.every((gate) => ["pass", "not_applicable"].includes(gate.status)),
      reasons: [...new Set(gates.flatMap((gate) => gate.reasons))] },
  };
}

export function financialEventPlanBlocker(plan: FinancialEmailPlan): string | null {
  const deferred = ["reconciliation", "actual_preflight", ...(plan.operation.intended === "no_write" ? ["rollout"] : [])];
  const blocking = plan.automation.gates.filter((gate) => !deferred.includes(gate.gate)
    && !["pass", "not_applicable"].includes(gate.status));
  if (blocking.length) return plan.reviewReasons.find((reason) => reason.blocking)?.message
    || (blocking.some((gate) => gate.gate === "authenticity") ? "Waiting for verified sender authentication."
      : "Waiting for complete, consistent payment details.");
  if (!plan.operation.intended) return "Waiting for a clear payment purpose.";
  return null;
}
