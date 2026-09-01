import type {
  BillCandidate,
  FinancialEmailInput,
  FinancialEmailPlan,
  FinancialPlanTarget,
} from "../../shared/types/bills.ts";
import type {
  TransactionImportPlanShadow,
  TransactionImportPlanTargetComparison,
} from "../../shared/types/transaction-imports.ts";
import { planFinancialEmail } from "../bills/financial-email-planner.ts";
import { normalizedMailbox } from "./parsers/parser-utils.ts";
import type { InsertItemInput } from "./transaction-import-store.ts";

const MAX_CONCURRENT_SHADOW_PLANS = 4;

export type TransactionImportFinancialPlanner = (
  userId: string,
  input: FinancialEmailInput,
) => Promise<FinancialEmailPlan>;

function parserWarnings(item: InsertItemInput): unknown[] {
  return item.blockingWarnings.filter((warning) => (
    typeof warning !== "object" || warning === null || (warning as { code?: unknown }).code !== "missing_mapping"
  ));
}

function blockingParserWarnings(item: InsertItemInput): unknown[] {
  return parserWarnings(item).filter((warning) => (
    typeof warning === "object" && warning !== null && (warning as { blocking?: unknown }).blocking === true
  ));
}

function senderAddress(item: InsertItemInput): string | null {
  const sender = item.evidence.find((entry) => (
    typeof entry === "object" && entry !== null && (entry as { code?: unknown }).code === "sender"
  ));
  const value = sender && (sender as { value?: unknown }).value;
  return typeof value === "string" && value.trim() ? normalizedMailbox(value) : null;
}

export function transactionImportPlannerInput(item: InsertItemInput): FinancialEmailInput | null {
  if (!item.date || item.amountCents == null || !item.payee) return null;
  const warnings = parserWarnings(item);
  const candidate: BillCandidate = {
    payee: item.payee,
    payee_hint: item.payee,
    amount: Math.abs(item.amountCents) / 100,
    amount_kind: "transaction_amount",
    amount_candidates: [{
      kind: "transaction_amount",
      value: Math.abs(item.amountCents) / 100,
      confidence: 1,
    }],
    amount_verification: {
      status: "kept_initial",
      source_value_count: 1,
      initial_covered_count: 1,
      verified_covered_count: 1,
      provider: "source_adapter",
      model: item.parserVersion,
    },
    event_kind: "purchase",
    event_confidence: 1,
    event_verification: {
      status: "kept_initial",
      provider: "source_adapter",
      model: item.parserVersion,
    },
    semantic_enrichment: {
      status: "complete",
      provider: "source_adapter",
      model: item.parserVersion,
    },
    due_date: item.date,
    type: "expense",
    notes: item.notes,
    blocking_warnings: blockingParserWarnings(item),
    transaction_import: {
      source: item.source,
      parserVersion: item.parserVersion,
      externalId: item.externalId,
      importedId: item.importedId,
      amountCents: item.amountCents,
      currency: item.currency,
    },
  };
  const sender = senderAddress(item);
  const untrusted = warnings.some((warning) => (
    typeof warning === "object" && warning !== null && (warning as { code?: unknown }).code === "untrusted_sender"
  ));
  return {
    candidate,
    source: "transaction_import",
    providerMessageId: item.importedId,
    sourceIdentity: {
      provider: item.source,
      accountId: item.gmailAccountId,
      senderAddress: sender,
      senderAuthentication: untrusted ? "fail" : sender ? "pass" : "unavailable",
      authenticationEvidence: [`parser:${item.parserVersion}`, `source:${item.source}`],
    },
  };
}

function redactTarget(target: FinancialPlanTarget): FinancialPlanTarget {
  return {
    ...target,
    provenance: target.provenance.map(({ evidence: _evidence, ...entry }) => entry),
  };
}

export function redactTransactionImportPlan(plan: FinancialEmailPlan): FinancialEmailPlan {
  const {
    event_evidence: _eventEvidence,
    account_last4_evidence: _accountEvidence,
    target_evidence: _targetEvidence,
    ...candidate
  } = plan.candidate;
  return {
    ...plan,
    candidate: {
      ...candidate,
      amount_candidates: candidate.amount_candidates?.map(({ evidence: _evidence, ...amount }) => amount),
    },
    classification: { ...plan.classification, evidence: undefined },
    targets: {
      account: redactTarget(plan.targets.account),
      payee: redactTarget(plan.targets.payee),
      category: redactTarget(plan.targets.category),
      fromAccount: redactTarget(plan.targets.fromAccount),
      toAccount: redactTarget(plan.targets.toAccount),
      schedule: redactTarget(plan.targets.schedule),
    },
  };
}

function compareTarget(liveId: string | null | undefined, target: FinancialPlanTarget): TransactionImportPlanTargetComparison {
  const plannedId = target.status === "resolved" ? target.id ?? null : null;
  return {
    liveId: liveId ?? null,
    plannedId,
    agreement: !plannedId ? "unresolved" : liveId === plannedId ? "match" : "mismatch",
  };
}

function plannedShadow(item: InsertItemInput, plan: FinancialEmailPlan): TransactionImportPlanShadow {
  return {
    status: "planned",
    operation: plan.operation.kind,
    reconciliationStatus: plan.reconciliation.status,
    account: compareTarget(item.actualAccountId, plan.targets.account),
    category: compareTarget(item.actualCategoryId, plan.targets.category),
    automationEligible: plan.automation.eligible,
    automationReasons: plan.automation.reasons,
    failureCode: null,
  };
}

function emptyShadow(
  item: InsertItemInput,
  status: "not_plannable" | "failed",
  failureCode: string,
): TransactionImportPlanShadow {
  return {
    status,
    operation: null,
    reconciliationStatus: null,
    account: { liveId: item.actualAccountId ?? null, plannedId: null, agreement: "unresolved" },
    category: { liveId: item.actualCategoryId ?? null, plannedId: null, agreement: "unresolved" },
    automationEligible: false,
    automationReasons: [],
    failureCode,
  };
}

export async function attachTransactionImportFinancialPlans(
  userId: string,
  items: InsertItemInput[],
  planner: TransactionImportFinancialPlanner = planFinancialEmail,
): Promise<InsertItemInput[]> {
  const results = new Array<InsertItemInput>(items.length);
  let nextIndex = 0;
  async function planNext(): Promise<void> {
    const index = nextIndex++;
    if (index >= items.length) return;
    const item = items[index]!;
    const input = transactionImportPlannerInput(item);
    if (!input) {
      results[index] = { ...item, financialPlan: null, planShadow: emptyShadow(item, "not_plannable", "canonical_fields_missing") };
    } else try {
      const plan = redactTransactionImportPlan(await planner(userId, input));
      results[index] = { ...item, financialPlan: plan, planShadow: plannedShadow(item, plan) };
    } catch {
      results[index] = { ...item, financialPlan: null, planShadow: emptyShadow(item, "failed", "planner_unavailable") };
    }
    await planNext();
  }
  await Promise.all(Array.from(
    { length: Math.min(MAX_CONCURRENT_SHADOW_PLANS, items.length) },
    () => planNext(),
  ));
  return results;
}
