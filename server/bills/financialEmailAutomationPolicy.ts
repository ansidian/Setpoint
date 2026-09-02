import type {
  BillCandidate,
  FinancialAutomationEligibility,
  FinancialAutomationGate,
  FinancialAutomationOperationClass,
  FinancialEmailInput,
  FinancialEmailReconciliation,
  FinancialIntendedOperationKind,
  FinancialPlanReason,
  FinancialPlanReasonCode,
} from "../../shared/types/bills.ts";

const ENABLED_OPERATION_CLASSES = new Set<FinancialAutomationOperationClass>(["one_time_expense"]);

export function financialEmailAutomationEnabled(operation: FinancialAutomationOperationClass): boolean {
  return ENABLED_OPERATION_CLASSES.has(operation);
}

function operationClass(
  candidate: BillCandidate,
  intended: FinancialIntendedOperationKind | null,
): FinancialAutomationOperationClass {
  if (intended === "no_write") return "no_write";
  if (intended === "create_transfer_schedule") return "transfer_schedule";
  if (intended === "create_schedule") return "utility_schedule";
  if (intended === "create_transaction") {
    return candidate.type === "income" || ["refund", "reward"].includes(String(candidate.event_kind || ""))
      ? "income"
      : "one_time_expense";
  }
  return "unsupported";
}

function gate(
  gateName: FinancialAutomationGate["gate"],
  status: FinancialAutomationGate["status"],
  reasons: FinancialPlanReasonCode[] = [],
): FinancialAutomationGate {
  return { gate: gateName, status, reasons };
}

function uniqueReasonCodes(reasons: FinancialPlanReason[]): FinancialPlanReasonCode[] {
  return [...new Set(reasons.map((item) => item.code))];
}

export function financialEmailAutomationEligibility({
  input,
  candidate,
  evidence,
  targets,
  reconciliation,
  intended,
}: {
  input: FinancialEmailInput;
  candidate: BillCandidate;
  evidence: FinancialPlanReason[];
  targets: FinancialPlanReason[];
  reconciliation: FinancialEmailReconciliation;
  intended: FinancialIntendedOperationKind | null;
}): FinancialAutomationEligibility {
  const semanticReasons = evidence
    .filter((item) => ["semantic_event_missing", "semantic_event_ambiguous", "provider_unavailable"].includes(item.code))
    .map((item) => item.code);
  const amountReasons = evidence
    .filter((item) => item.code === "canonical_amount_missing" || item.code === "minimum_due_only")
    .map((item) => item.code);
  const dateReasons = evidence
    .filter((item) => item.code === "due_date_missing" || item.code === "due_date_invalid")
    .map((item) => item.code);
  const authentication = input.sourceIdentity?.senderAuthentication || "unavailable";
  const authenticationReasons: FinancialPlanReasonCode[] = authentication === "fail"
    ? ["sender_authentication_failed"]
    : authentication === "pass" ? [] : ["sender_authentication_unavailable"];
  const reconciliationGate = reconciliation.disposition === "update_existing"
    ? gate("reconciliation", "pass")
    : reconciliation.status === "needs_review"
    ? gate("reconciliation", "fail", ["reconciliation_conflict"])
    : reconciliation.status === "unavailable" || reconciliation.status === "not_checked"
      ? gate("reconciliation", "unknown", ["reconciliation_unavailable"])
      : gate("reconciliation", "pass");
  const hasBlockingWarnings = (Array.isArray(candidate.blocking_warnings)
    && candidate.blocking_warnings.length > 0)
    || (intended === "create_transaction"
      && (candidate.transaction_import?.currency || candidate.currency) !== "USD");
  const preflight = input.actualPreflight?.status || "not_run";
  const preflightReasons = input.actualPreflight?.reasons || [];
  const automationClass = operationClass(candidate, intended);
  const rollout = financialEmailAutomationEnabled(automationClass) ? "enabled" : "observe_only";
  const gates: FinancialAutomationGate[] = [
    gate("semantic", semanticReasons.length ? "fail" : "pass", semanticReasons),
    intended === "no_write"
      ? gate("canonical_amount", "not_applicable")
      : gate("canonical_amount", amountReasons.length ? "fail" : "pass", amountReasons),
    intended === "no_write"
      ? gate("date", "not_applicable")
      : gate("date", dateReasons.length ? "fail" : "pass", dateReasons),
    intended === "no_write"
      ? gate("targets", "not_applicable")
      : gate("targets", targets.length ? "fail" : "pass", uniqueReasonCodes(targets)),
    gate("authenticity", authentication === "pass" ? "pass" : "fail", authenticationReasons),
    gate(
      "stable_identity",
      input.providerMessageId?.trim() ? "pass" : "fail",
      input.providerMessageId?.trim() ? [] : ["stable_identity_missing"],
    ),
    gate("warnings", hasBlockingWarnings ? "fail" : "pass", hasBlockingWarnings ? ["blocking_warning"] : []),
    reconciliationGate,
    preflight === "passed"
      ? gate("actual_preflight", "pass")
      : preflight === "failed"
        ? gate("actual_preflight", "fail", preflightReasons.length ? preflightReasons : ["actual_preflight_not_run"])
        : gate("actual_preflight", "unknown", ["actual_preflight_not_run"]),
    rollout === "enabled"
      ? gate("rollout", "pass")
      : gate("rollout", "fail", ["automation_class_observe_only"]),
  ];
  const reasons = [...new Set(gates.flatMap((item) => item.reasons))];
  return {
    eligible: reconciliation.disposition !== "no_write"
      && gates.every((item) => item.status === "pass" || item.status === "not_applicable"),
    operationClass: automationClass,
    rollout,
    gates,
    reasons,
  };
}
