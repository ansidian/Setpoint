import type { FinancialEmailPlan } from "../../../../shared/types/bills";

export interface FinancialPlanPresentation {
  tone: "ready" | "review" | "no_write" | "loading";
  title: string;
  detail: string;
}

function purposeLabel(plan: FinancialEmailPlan): string {
  switch (plan.classification.documentKind) {
    case "credit_card_statement": return "Card payment";
    case "utility_statement": return "Recurring bill";
    case "income": return "Income";
    case "informational": return "No automatic entry";
    default: return "One-time expense";
  }
}

function destination(plan: FinancialEmailPlan): string | null {
  if (plan.classification.documentKind === "credit_card_statement") {
    const from = plan.targets.fromAccount.status === "resolved" ? plan.targets.fromAccount.label : null;
    const to = plan.targets.toAccount.status === "resolved" ? plan.targets.toAccount.label : null;
    return (from && to ? `${from} → ${to}` : to || from) || null;
  }
  return [plan.targets.payee, plan.targets.account, plan.targets.category]
    .filter((target) => target.status === "resolved" && target.label)
    .map((target) => target.label)
    .join(" · ") || null;
}

function noWriteDetail(plan: FinancialEmailPlan): string {
  if (plan.reconciliation.status === "already_recorded") return "An exact transaction is already in Actual.";
  if (plan.reconciliation.status === "already_scheduled") return "An exact schedule is already in Actual.";
  if (plan.classification.eventKind === "payment_cancelled") return "The email was assessed as a cancelled payment. Confirm the details below if a record is needed.";
  if (plan.classification.eventKind === "payment_failed") return "The email was assessed as a failed payment. Confirm the details below if a record is needed.";
  return "No automatic entry is planned for this email. You can confirm the details below.";
}

export function presentFinancialPlan(
  plan: FinancialEmailPlan | null | undefined,
  loading: boolean,
): FinancialPlanPresentation | null {
  if (loading) return { tone: "loading", title: "Planning Actual entry…", detail: "Checking current accounts and history." };
  if (!plan) return null;
  if (plan.operation.kind === "no_write" || plan.operation.intended === "no_write") {
    return { tone: "no_write", title: purposeLabel(plan), detail: noWriteDetail(plan) };
  }
  if (plan.operation.kind === "review") {
    return {
      tone: "review",
      title: `${purposeLabel(plan)} needs review`,
      detail: plan.reviewReasons[0]?.message || "Choose the missing Actual details before sending.",
    };
  }
  return {
    tone: "ready",
    title: `${purposeLabel(plan)} ready to review`,
    detail: destination(plan) || "Confirm the Actual details below before sending.",
  };
}
