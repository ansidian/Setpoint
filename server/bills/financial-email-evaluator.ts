import { planFinancialEmail } from "./financial-email-planner.ts";
import type {
  BillPayResolution,
  FinancialDocumentKind,
  FinancialEmailInput,
  FinancialEmailPlan,
  FinancialOperationKind,
  FinancialPlanReasonCode,
  FinancialPlanTarget,
  FinancialReconciliationStatus,
  FinancialTargetStatus,
} from "../../shared/types/bills.ts";

export interface RedactedLegacyFinancialOutcome {
  mappingStatus: BillPayResolution["mapping"]["status"];
  mappingReason: string | null;
  billType: string | null;
  actualStatus: FinancialReconciliationStatus | null;
}

export interface RedactedFinancialPlanOutcome {
  documentKind: FinancialDocumentKind;
  intendedOperation: Exclude<FinancialOperationKind, "review"> | null;
  operation: FinancialOperationKind;
  targetStatuses: Record<string, FinancialTargetStatus>;
  reconciliationStatus: FinancialReconciliationStatus;
  reconciliationDisposition: "none" | "create" | "update_existing" | "no_write" | "review" | null;
  reviewReasons: FinancialPlanReasonCode[];
  automationEligible: boolean;
  automationOperationClass: FinancialEmailPlan["automation"]["operationClass"];
  automationRollout: FinancialEmailPlan["automation"]["rollout"];
  automationReasons: FinancialPlanReasonCode[];
}

export interface FinancialEmailEvaluation {
  writesEnabled: false;
  legacy: RedactedLegacyFinancialOutcome | null;
  plan: RedactedFinancialPlanOutcome;
  comparison: {
    operationAgreement: boolean | null;
    reconciliationAgreement: boolean | null;
    targetAgreement: Record<string, TargetAgreement> | null;
  };
}

export type TargetAgreement = "agree" | "disagree" | "unresolved" | "not_applicable" | "legacy_target_missing";

function legacyOperation(type: unknown): Exclude<FinancialOperationKind, "review"> | null {
  if (type === "expense" || type === "income") return "create_transaction";
  if (type === "bill") return "create_schedule";
  if (type === "transfer") return "create_transfer_schedule";
  return null;
}

function redactedLegacyOutcome(resolution: BillPayResolution | null): RedactedLegacyFinancialOutcome | null {
  if (!resolution) return null;
  return {
    mappingStatus: resolution.mapping.status,
    mappingReason: resolution.mapping.reason || null,
    billType: typeof resolution.bill.type === "string" ? resolution.bill.type : null,
    actualStatus: resolution.actualStatus?.status || null,
  };
}

function compareTarget(
  planTarget: FinancialPlanTarget,
  legacyValue: unknown,
  planValue: unknown = planTarget.id,
): TargetAgreement {
  if (planTarget.status === "not_applicable") return "not_applicable";
  if (planTarget.status !== "resolved") return "unresolved";
  if (legacyValue == null || String(legacyValue).trim() === "") return "legacy_target_missing";
  return String(planValue || "") === String(legacyValue) ? "agree" : "disagree";
}

function targetAgreement(
  planTargets: Awaited<ReturnType<typeof planFinancialEmail>>["targets"],
  legacyResolution: BillPayResolution | null,
): Record<string, TargetAgreement> | null {
  if (!legacyResolution) return null;
  const legacy = legacyResolution.bill;
  return {
    account: compareTarget(planTargets.account, legacy.account_id),
    payee: compareTarget(planTargets.payee, legacy.payee_id),
    category: compareTarget(planTargets.category, legacy.category_id),
    fromAccount: compareTarget(planTargets.fromAccount, legacy.from_account_id),
    toAccount: compareTarget(planTargets.toAccount, legacy.to_account_id),
    schedule: compareTarget(planTargets.schedule, legacy.schedule_name, planTargets.schedule.label),
  };
}

export async function evaluateFinancialEmail(
  userId: string,
  input: FinancialEmailInput,
  legacyResolution: BillPayResolution | null = null,
): Promise<FinancialEmailEvaluation> {
  const plan = await planFinancialEmail(userId, input);
  const legacy = redactedLegacyOutcome(legacyResolution);
  const expectedLegacyOperation = legacyOperation(legacy?.billType);
  return {
    writesEnabled: false,
    legacy,
    plan: {
      documentKind: plan.classification.documentKind,
      intendedOperation: plan.operation.intended,
      operation: plan.operation.kind,
      targetStatuses: Object.fromEntries(
        Object.entries(plan.targets).map(([key, value]) => [key, value.status]),
      ),
      reconciliationStatus: plan.reconciliation.status,
      reconciliationDisposition: plan.reconciliation.disposition || null,
      reviewReasons: plan.reviewReasons.map((item) => item.code),
      automationEligible: plan.automation.eligible,
      automationOperationClass: plan.automation.operationClass,
      automationRollout: plan.automation.rollout,
      automationReasons: plan.automation.reasons,
    },
    comparison: {
      operationAgreement: expectedLegacyOperation
        ? expectedLegacyOperation === plan.operation.intended
        : null,
      reconciliationAgreement: legacy?.actualStatus
        ? legacy.actualStatus === plan.reconciliation.status
        : null,
      targetAgreement: targetAgreement(plan.targets, legacyResolution),
    },
  };
}
