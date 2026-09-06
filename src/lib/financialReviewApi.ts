import { apiFetch } from "./apiFetch";
import type { FinancialEventReviewResponse, FinancialReviewChangeCursor, FinancialReviewChangesResponse } from "../../shared/types/financial-review";

export const financialReviewHref = (emailUid?: string) =>
  `/settings?tab=finance${emailUid ? `&financialEmail=${encodeURIComponent(emailUid)}` : ""}#financial-event-review`;

export const getFinancialEventReview = (offset = 0): Promise<FinancialEventReviewResponse> =>
  apiFetch(`/api/briefing/financial-events/review?offset=${offset}`, { timeoutMs: 15_000 });

export const getFinancialReviewChanges = (after: FinancialReviewChangeCursor | null): Promise<FinancialReviewChangesResponse> =>
  apiFetch(`/api/briefing/financial-events/review-changes${after ? `?afterAt=${after.updatedAt}&afterId=${encodeURIComponent(after.id)}` : ""}`, { timeoutMs: 15_000 });
