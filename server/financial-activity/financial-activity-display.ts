import type { FinancialOriginalReceipt } from "../../shared/types/financial-activity.ts";
import { projectReviewItem } from "../financial-events/financial-event-review.ts";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Completed labels describe captured results, never a later source reassessment. */
export function capturedActivityDisplay(receipt: FinancialOriginalReceipt | undefined) {
  const saved = object(receipt?.input);
  const operation = object(saved.operation);
  const input = object(operation.input || saved.input || saved);
  if (typeof input.amountCents === "number") return {
    payee: typeof input.payee === "string" ? input.payee : typeof input.name === "string" ? input.name : null,
    amountCents: input.amountCents, currency: "USD",
  };
  const plan = object(saved.plan || saved);
  if (plan.candidate) {
    const display = projectReviewItem({ plan_json: JSON.stringify(plan) });
    return { payee: display.payee, amountCents: display.amount == null ? null : Math.round(display.amount * 100), currency: display.currency };
  }
  return { payee: null, amountCents: null, currency: null };
}

export function capturedActivitySources(receipt: FinancialOriginalReceipt | undefined): unknown[] | null {
  const saved = object(receipt?.input);
  const sources = saved.sources || object(saved.operation).sourceEvidence || saved.sourceEvidence;
  return Array.isArray(sources) ? sources : null;
}
