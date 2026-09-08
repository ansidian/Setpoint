import { apiFetch } from "./apiFetch";
import type { FinancialReviewChangeCursor, FinancialReviewChangesResponse } from "../../shared/types/financial-review";

export const financialReviewHref = (emailUid?: string) =>
  `/finance?financial=list&view=needs_attention&source=managed${emailUid ? `&financialEmail=${encodeURIComponent(emailUid)}` : ""}`;

export const getFinancialReviewChanges = (after: FinancialReviewChangeCursor | null): Promise<FinancialReviewChangesResponse> =>
  apiFetch(`/api/briefing/financial-events/review-changes${after ? `?afterAt=${after.updatedAt}&afterId=${encodeURIComponent(after.id)}` : ""}`, { timeoutMs: 15_000 });
