import { isDemoMode } from "../demo/config";
import { apiFetch } from "./apiFetch";
import type { BillCandidate, BillExtractionInput, BillMutationResponse, BillPaySeedRequest,
  FinancialEmailExtractionResponse, FinancialEmailPlan } from "../../shared/types/bills";
import type { FinancialEventCompletionRequest } from "../../shared/types/financial-operations";

export const sendToActualBudget = (bill: BillCandidate): Promise<BillMutationResponse> =>
  apiFetch("/api/briefing/actual/send", { method: "POST", body: JSON.stringify(bill) });
export const extractBillFromEmail = ({ subject, from, body }: BillExtractionInput): Promise<FinancialEmailExtractionResponse> =>
  apiFetch("/api/briefing/bills/extract", { method: "POST", body: JSON.stringify({ subject, from, body }) });
export const resolveFinancialEmailPlan = (payload: BillPaySeedRequest): Promise<FinancialEmailPlan> =>
  apiFetch("/api/briefing/bills/resolve", { method: "POST", body: JSON.stringify(payload || {}) });

// Intentionally unavailable in demo; the demo dispatcher rejects this write.
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
