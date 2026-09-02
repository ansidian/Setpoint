import { createHash } from "node:crypto";
import { reconcileTransferSchedule } from "../actual/actual.ts";
import { financialEmailAutomationEnabled, selectSemanticBillAmount } from "../bills/financial-email-planner.ts";
import type { ClaimedItem, TransactionImportStore } from "./transaction-import-store.ts";
import type { FinancialEmailPlan, FinancialAutomationGateKind } from "../../shared/types/bills.ts";
import type { ActualTransferScheduleInput, ActualTransferScheduleResult, TransactionImportItemStatus } from "../../shared/types/transaction-imports.ts";

export function transferPaymentIdentity(userId: string, plan: FinancialEmailPlan): string | null {
  if (plan.operation.intended !== "create_transfer_schedule"
    || plan.targets.fromAccount.status !== "resolved" || plan.targets.toAccount.status !== "resolved") return null;
  const amount = selectSemanticBillAmount(plan.candidate)?.amount;
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || !plan.candidate.due_date) return null;
  // Different reminder messages for the same payment share one durable attempt.
  return `financial-transfer:v1:${createHash("sha256").update(JSON.stringify([
    userId, plan.targets.fromAccount.id, plan.targets.toAccount.id, cents, plan.candidate.due_date, "USD",
  ])).digest("hex")}`;
}

export function isTransferImport(item: ClaimedItem): boolean {
  return item.financialPlan?.operation.intended === "create_transfer_schedule"
    || item.financialPlan?.automation.operationClass === "transfer_schedule";
}

function transferInput(item: ClaimedItem): ActualTransferScheduleInput | null {
  const plan = item.financialPlan;
  if (!plan || plan.operation.intended !== "create_transfer_schedule" || plan.automation.operationClass !== "transfer_schedule"
    || item.source !== "generic" || item.currency !== "USD" || !item.importedId
    || item.importedId !== transferPaymentIdentity(item.userId, plan)
    || !item.date || item.date !== plan.candidate.due_date || !item.payee
    || item.actualAccountId !== plan.targets.fromAccount.id || !plan.targets.toAccount.id
    || item.amountCents !== -Math.round(Number(selectSemanticBillAmount(plan.candidate)?.amount) * 100)) return null;
  return {
    identityKey: item.importedId,
    fromAccountId: item.actualAccountId!, toAccountId: plan.targets.toAccount.id,
    date: item.date, amountCents: -item.amountCents!, name: item.payee,
    budgetId: plan.transferExecution?.budgetId,
  };
}

function applyTransferResult(plan: FinancialEmailPlan, result: ActualTransferScheduleResult, checkedAt: string): FinancialEmailPlan {
  const duplicate = ["created", "already_scheduled", "already_recorded"].includes(result.outcome);
  const recorded = result.outcome === "already_recorded";
  const review = result.outcome === "needs_review";
  const gates = plan.automation.gates.map((gate) => ["actual_preflight", "reconciliation"].includes(gate.gate)
    ? { ...gate, status: review ? "fail" as const : "pass" as const, reasons: review ? ["reconciliation_conflict" as const] : [] }
    : gate);
  const required: FinancialAutomationGateKind[] = ["semantic", "canonical_amount", "date", "targets", "authenticity", "stable_identity", "warnings", "reconciliation", "actual_preflight", "rollout"];
  const eligible = result.outcome === "would_create" && plan.automation.rollout === "enabled"
    && financialEmailAutomationEnabled("transfer_schedule")
    && required.every((name) => gates.some((gate) => gate.gate === name && gate.status === "pass"));
  return {
    ...plan,
    transferExecution: { ...plan.transferExecution, budgetId: plan.transferExecution?.budgetId || result.budgetId },
    operation: duplicate
      ? { intended: plan.operation.intended, kind: "no_write", reasons: [recorded ? "already_recorded" : "already_scheduled"] }
      : review ? { intended: plan.operation.intended, kind: "review", reasons: ["reconciliation_conflict"] }
        : { intended: plan.operation.intended, kind: "create_transfer_schedule", reasons: [] },
    reconciliation: {
      status: duplicate ? recorded ? "already_recorded" : "already_scheduled" : review ? "needs_review" : "not_scheduled",
      disposition: duplicate ? "no_write" : review ? "review" : "create", reason: result.reason, checkedAt,
      evidence: result.transactionId ? { kind: "transaction", transactionId: result.transactionId }
        : result.scheduleId ? { kind: "schedule", scheduleId: result.scheduleId } : null,
    },
    reviewReasons: review ? [{ code: "reconciliation_conflict", message: result.reason, blocking: true }]
      : duplicate ? [] : plan.reviewReasons.filter((r) => !["reconciliation_unavailable", "reconciliation_conflict", "actual_preflight_not_run"].includes(r.code)),
    automation: { ...plan.automation, eligible, gates, reasons: [...new Set(gates.flatMap((gate) => gate.reasons))] },
  };
}

export async function processTransferImportItem(item: ClaimedItem, {
  store,
  execute = reconcileTransferSchedule,
  now = Date.now,
}: {
  store: TransactionImportStore;
  execute?: typeof reconcileTransferSchedule;
  now?: () => number;
}): Promise<boolean> {
  const input = transferInput(item);
  if (!input || !item.financialPlan) {
    await store.settleItem(item.userId, item.id, item.claimToken, { status: "needs_review", automaticSafe: false, lastError: "Transfer details changed or are incomplete. Review the payment in Actual." });
    return false;
  }
  let attempted = !!item.financialPlan.transferExecution?.attemptedAt;
  try {
    let mode = attempted ? "recover" as const : "preview" as const;
    if (item.status === "importing" && !attempted) {
      if (!input.budgetId || !item.automaticSafe || !item.financialPlan.automation.eligible
        || item.automationMode !== "automatic" || !financialEmailAutomationEnabled("transfer_schedule")) {
        await store.settleItem(item.userId, item.id, item.claimToken, { status: "needs_review", lastError: "This transfer is not eligible for automatic creation." });
        return false;
      }
      const attemptedAt = new Date(now()).toISOString();
      if (!await store.markTransferAttempt(item.userId, item.id, item.claimToken, attemptedAt)) return false;
      item.financialPlan = { ...item.financialPlan, transferExecution: { budgetId: input.budgetId, attemptedAt } };
      attempted = true;
      // Admission to create_once is owned by the durable marker, never a retry count.
      const result = await execute(item.userId, input, "create_once");
      return await settle(result);
    }
    if (attempted) mode = "recover";
    return await settle(await execute(item.userId, input, mode));
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    // Every failure after admission is uncertain, regardless of SDK error code.
    // A retry retains the marker and can only sync/reconcile; it cannot create.
    await store.settleItem(item.userId, item.id, item.claimToken, {
      status: item.attempts >= 5 ? "needs_review" : "queued", automaticSafe: false,
      lastError: `${attempted ? "Transfer write requires verification" : "Transfer check failed"}: ${message}`,
      nextAttemptAt: now() + Math.min(30_000 * 2 ** item.attempts, 600_000),
    });
    return false;
  }

  async function settle(result: ActualTransferScheduleResult): Promise<boolean> {
    const plan = applyTransferResult(item.financialPlan!, result, new Date(now()).toISOString());
    const status: TransactionImportItemStatus = result.outcome === "created" ? "added"
      : result.outcome === "already_scheduled" || result.outcome === "already_recorded" ? "already_present"
        : result.outcome === "would_create" && plan.automation.eligible && item.automationMode === "automatic" ? "ready" : "needs_review";
    const settled = await store.settleItem(item.userId, item.id, item.claimToken, {
      status, financialPlan: plan, automaticSafe: plan.automation.eligible,
      reconciliationStatus: status === "added" ? "added" : status === "already_present" ? "already_present" : result.outcome === "would_create" ? "would_add" : null,
      lastError: status === "needs_review" ? result.reason : null,
    });
    if (settled) {
      await store.persistFinancialPlanForEmail(item.userId, item.gmailAccountId, item.emailUid, plan).catch(() => undefined);
      if (status === "added" || status === "already_present") {
        await store.incrementRunOutcomes(item.userId, item.runId, { added: status === "added" ? 1 : 0, duplicate: status === "already_present" ? 1 : 0 });
      }
    }
    return result.outcome === "created" || (attempted && result.outcome === "already_scheduled");
  }
}
