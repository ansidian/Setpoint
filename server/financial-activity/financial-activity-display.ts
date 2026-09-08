import type { FinancialOriginalReceipt } from "../../shared/types/financial-activity.ts";
import { projectReviewItem } from "../financial-events/financial-event-review.ts";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Source/transfer magnitudes need a direction; transaction cents are already signed. */
export function activitySignedAmountCents(amountCents: number | null, type: unknown): number | null {
  if (amountCents == null) return null;
  if (type === "income") return Math.abs(amountCents);
  if (["expense", "payment", "bill", "transfer", "completed_transfer", "transfer_schedule", "utility_schedule"].includes(String(type))) {
    return -Math.abs(amountCents);
  }
  return amountCents;
}

/** Completed labels describe captured results, never a later source reassessment. */
export function capturedActivityDisplay(receipt: FinancialOriginalReceipt | undefined) {
  const saved = object(receipt?.input);
  const operation = object(saved.operation);
  const input = object(operation.input || saved.input || saved);
  if (typeof input.amountCents === "number") return {
    payee: typeof input.payee === "string" ? input.payee : typeof input.name === "string" ? input.name : null,
    amountCents: activitySignedAmountCents(input.amountCents, operation.executor === "transfer_schedule" ? "transfer_schedule" : input.kind || input.type), currency: "USD",
  };
  const plan = object(saved.plan || saved);
  if (plan.candidate) {
    const display = projectReviewItem({ plan_json: JSON.stringify(plan) });
    return { payee: display.payee, amountCents: activitySignedAmountCents(display.amount == null ? null : Math.round(display.amount * 100), object(plan.candidate).type), currency: display.currency };
  }
  return { payee: null, amountCents: null, currency: null };
}

export function capturedActivitySources(receipt: FinancialOriginalReceipt | undefined): unknown[] | null {
  const saved = object(receipt?.input);
  const sources = saved.sources || object(saved.operation).sourceEvidence || saved.sourceEvidence;
  return Array.isArray(sources) ? sources : null;
}
