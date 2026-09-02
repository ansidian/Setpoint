import { createHash } from "node:crypto";
import { financialEmailAutomationEnabled, selectSemanticBillAmount } from "../bills/financial-email-planner.ts";
import { redactTransactionImportPlan } from "./transaction-import-planner-adapter.ts";
import { isTransactionParserOwnedEmail } from "./parsers/parser-registry.ts";
import {
  transactionImportStore,
  type InsertItemInput,
  type TransactionImportStore,
} from "./transaction-import-store.ts";
import type {
  FinancialAutomationGateKind,
  FinancialEmailPlan,
  FinancialPlanReasonCode,
} from "../../shared/types/bills.ts";
import type { ActualImportItemOutcome } from "../../shared/types/transaction-imports.ts";

const REQUIRED_GATES: FinancialAutomationGateKind[] = [
  "semantic",
  "canonical_amount",
  "date",
  "targets",
  "authenticity",
  "stable_identity",
  "warnings",
];

export interface FinancialEmailPreflightContext {
  accountId: string;
  emailId: string;
  emailSubject?: string | null;
  emailFrom?: string | null;
  emailBody?: string | null;
}

function stableId(prefix: string, identity: string): string {
  return `${prefix}:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function gatePassed(plan: FinancialEmailPlan, gate: FinancialAutomationGateKind): boolean {
  return plan.automation.gates.some((entry) => entry.gate === gate && entry.status === "pass");
}

export function financialEmailPreflightItem(
  userId: string,
  runId: string,
  itemId: string,
  context: FinancialEmailPreflightContext,
  plan: FinancialEmailPlan,
): InsertItemInput | null {
  if (isTransactionParserOwnedEmail({
    from: context.emailFrom || "", subject: context.emailSubject || "", text: context.emailBody,
  })) return null;
  if (plan.automation.operationClass !== "one_time_expense"
    || plan.operation.kind === "no_write"
    || plan.reconciliation.disposition === "no_write"
    || plan.identity.status !== "resolved"
    || !plan.identity.key
    || (plan.candidate.transaction_import?.currency || plan.candidate.currency) !== "USD"
    || !REQUIRED_GATES.every((gate) => gatePassed(plan, gate))) return null;
  const reconciliationGate = plan.automation.gates.find((gate) => gate.gate === "reconciliation");
  if (reconciliationGate?.status === "fail") return null;
  const amount = selectSemanticBillAmount(plan.candidate)?.amount;
  const amountCents = Number.isFinite(amount) ? -Math.round(Number(amount) * 100) : 0;
  const date = plan.candidate.due_date;
  const accountId = plan.targets.account.status === "resolved" ? plan.targets.account.id : null;
  const payee = plan.candidate.payee || plan.targets.payee.label;
  if (amountCents >= 0 || !date || !accountId || !payee) return null;
  const categoryId = plan.targets.category.status === "resolved" ? plan.targets.category.id ?? null : null;
  const financialPlan = redactTransactionImportPlan({
    ...plan,
    candidate: {
      ...plan.candidate,
      transaction_import: {
        source: "generic",
        parserVersion: "financial-email-plan-v1",
        externalId: plan.identity.key,
        importedId: plan.identity.key,
        amountCents,
        currency: "USD",
      },
    },
  });
  return {
    id: itemId,
    runId,
    userId,
    gmailAccountId: context.accountId,
    gmailMessageId: context.emailId,
    emailUid: context.emailId,
    emailSubject: String(context.emailSubject || "").slice(0, 500),
    internetMessageId: null,
    candidateKey: plan.identity.key,
    source: "generic",
    parserVersion: "financial-email-plan-v1",
    externalId: plan.identity.key,
    importedId: plan.identity.key,
    date,
    amountCents,
    currency: "USD",
    payee,
    notes: String(plan.candidate.notes || "").slice(0, 2_000),
    actualAccountId: accountId,
    actualCategoryId: categoryId,
    automationMode: plan.automation.rollout === "enabled"
      && financialEmailAutomationEnabled(plan.automation.operationClass) ? "automatic" : "observe",
    automaticSafe: false,
    blockingWarnings: [],
    evidence: [{ code: "financial_email_identity", value: plan.identity.key }],
    financialPlan,
    planShadow: null,
    status: "queued",
  };
}

export async function stageFinancialEmailPreflight(
  userId: string,
  context: FinancialEmailPreflightContext,
  plan: FinancialEmailPlan,
  store: TransactionImportStore = transactionImportStore,
): Promise<{ staged: boolean; runId: string | null }> {
  if (!plan.identity.key) return { staged: false, runId: null };
  const runId = stableId("financial-email-run", plan.identity.key);
  const item = financialEmailPreflightItem(
    userId,
    runId,
    stableId("financial-email-item", plan.identity.key),
    context,
    plan,
  );
  if (!item) return { staged: false, runId: null };
  await store.createRun({
    id: runId,
    userId,
    trigger: "arrival",
    optionsKey: `financial-email:${plan.identity.key}`,
    gmailAccountIds: [context.accountId],
    sources: ["generic"],
    startDate: null,
    endDate: null,
  });
  const inserted = await store.insertItem(item);
  if (inserted) {
    await store.updateRunProgress(userId, runId, {
      cursor: { complete: true },
      status: "completed",
      discovered: 1,
      parsed: 1,
      queued: 1,
    });
  }
  return { staged: inserted, runId };
}

export function applyFinancialEmailPreflightOutcome(
  plan: FinancialEmailPlan,
  outcome: ActualImportItemOutcome,
  checkedAt: string,
): FinancialEmailPlan {
  const passed = outcome !== "failed";
  const duplicate = outcome === "already_present";
  const missingDuplicateCheck = outcome === "would_add" && plan.automation.rollout === "enabled"
    && (plan.reconciliation.status !== "not_scheduled" || plan.reconciliation.disposition !== "create");
  const reconciliation = missingDuplicateCheck ? plan.reconciliation : duplicate
    ? { status: "already_recorded" as const, disposition: "no_write" as const, reason: "exact_imported_id_match", checkedAt, evidence: null }
    : outcome === "would_update"
      ? { status: "needs_review" as const, disposition: "update_existing" as const, reason: "exact_imported_id_update", checkedAt, evidence: null }
      : outcome === "would_add"
        ? { status: "not_scheduled" as const, disposition: "create" as const, reason: "actual_dry_run_would_add", checkedAt, evidence: null }
        : { status: "unavailable" as const, disposition: "review" as const, reason: "actual_dry_run_failed", checkedAt, evidence: null };
  const gates = plan.automation.gates.map((gate) => {
    if (gate.gate === "actual_preflight") {
      return passed
        ? { ...gate, status: "pass" as const, reasons: [] }
        : { ...gate, status: "fail" as const, reasons: ["actual_preflight_not_run" as const] };
    }
    if (gate.gate === "reconciliation") {
      if (missingDuplicateCheck) return gate;
      return passed
        ? { ...gate, status: "pass" as const, reasons: [] }
        : { ...gate, status: "fail" as const, reasons: ["reconciliation_unavailable" as const] };
    }
    return gate;
  });
  const reasons = [...new Set(gates.flatMap((gate) => gate.reasons))] as FinancialPlanReasonCode[];
  const eligible = outcome === "would_add"
    && plan.reconciliation.status === "not_scheduled"
    && plan.reconciliation.disposition === "create"
    && plan.automation.rollout === "enabled"
    && financialEmailAutomationEnabled(plan.automation.operationClass)
    && [...REQUIRED_GATES, "reconciliation", "actual_preflight", "rollout"].every((required) => (
      gates.some((gate) => gate.gate === required && gate.status === "pass")
    ));
  return {
    ...plan,
    operation: duplicate
      ? { intended: plan.operation.intended, kind: "no_write", reasons: ["already_recorded"] }
      : plan.operation,
    reconciliation,
    reviewReasons: duplicate ? [] : missingDuplicateCheck ? plan.reviewReasons : plan.reviewReasons.filter((reason) => (
      reason.code !== "reconciliation_unavailable" && reason.code !== "reconciliation_conflict"
    )),
    automation: {
      ...plan.automation,
      eligible,
      gates,
      reasons,
    },
  };
}
