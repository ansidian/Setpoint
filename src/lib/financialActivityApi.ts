import { apiFetch } from "./apiFetch";
import type { FinancialActivity, FinancialActivityPage, FinancialActivityQuery, FinancialActivityReference,
  FinancialBindingInspection } from "../../shared/types/financial-activity";

export function listFinancialActivity(query: FinancialActivityQuery = {}, options: { signal?: AbortSignal } = {}): Promise<FinancialActivityPage> {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  return apiFetch(`/api/briefing/financial-activity?${params}`, options);
}
export function getFinancialActivity(reference: FinancialActivityReference): Promise<FinancialActivity> {
  const query = reference.owner === "import" ? `?runId=${encodeURIComponent(reference.runId)}` : "";
  return apiFetch(`/api/briefing/financial-activity/${reference.owner}/${encodeURIComponent(reference.id)}${query}`);
}
export function inspectFinancialActivityBinding(reference: FinancialActivityReference, budgetId: string): Promise<FinancialBindingInspection> {
  return apiFetch("/api/briefing/financial-activity/binding", { method: "POST", body: JSON.stringify({ reference, budgetId }) });
}
