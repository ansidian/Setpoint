import { isDemoMode } from "../demo/config";
import { apiFetch } from "./apiFetch";
import type { BillPaySeedRequest, FinancialEmailPlan } from "../../shared/types/bills";
import type { FinancialEventCompletionRequest, FinancialEventDismissalRequest, FinancialEventReviewRequest } from "../../shared/types/financial-operations";

export const resolveFinancialEmailPlan = (payload: BillPaySeedRequest): Promise<FinancialEmailPlan> =>
  apiFetch("/api/briefing/bills/resolve", { method: "POST", body: JSON.stringify(payload || {}) });

// Demo completion is fictional and remains inside the in-memory dispatcher.
export const completeFinancialEvent = async (payload: FinancialEventCompletionRequest): Promise<FinancialEmailPlan> => {
  const notify = (plan?: FinancialEmailPlan) => {
    if (typeof window !== "undefined" && !isDemoMode()) window.dispatchEvent(new CustomEvent("ea-financial-event-changed", {
      detail: { emailUid: payload.emailUid, plan },
    }));
  };
  try {
    const plan = await apiFetch<FinancialEmailPlan>("/api/briefing/financial-events/complete", { method: "POST", body: JSON.stringify(payload) });
    notify(plan);
    return plan;
  } catch (error) {
    // A lost response may still have queued the confirmation. Refresh its
    // durable status while preserving the editor until that outcome is known.
    notify();
    throw error;
  }
};

export async function requestFinancialEventReview(payload: FinancialEventReviewRequest): Promise<FinancialEmailPlan> {
  try {
    return await apiFetch<FinancialEmailPlan>("/api/briefing/financial-events/request", { method: "POST", body: JSON.stringify(payload), timeoutMs: 60_000 });
  } finally {
    if (typeof window !== "undefined" && !isDemoMode()) window.dispatchEvent(new Event("ea-financial-event-changed"));
  }
}

export async function dismissFinancialEvent(payload: FinancialEventDismissalRequest): Promise<FinancialEmailPlan> {
  try {
    return await apiFetch<FinancialEmailPlan>("/api/briefing/financial-events/dismiss", { method: "POST", body: JSON.stringify(payload) });
  } finally {
    if (typeof window !== "undefined" && !isDemoMode()) window.dispatchEvent(new Event("ea-financial-event-changed"));
  }
}
