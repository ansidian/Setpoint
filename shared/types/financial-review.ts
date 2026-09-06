export type FinancialReviewAttention = "complete_details" | "check_actual" | "retrying";

export interface FinancialEventReviewItem {
  id: string;
  emailUid: string;
  subject: string;
  from: string;
  receivedAt: string;
  payee: string | null;
  amount: number | null;
  currency: string | null;
  state: "waiting" | "needs_review";
  reason: string;
  relatedEmails: number;
  createdAt: number;
  nextAttemptAt: number | null;
  canComplete: boolean;
  attention: FinancialReviewAttention;
}

export interface FinancialEventReviewResponse {
  items: FinancialEventReviewItem[];
  total: number;
  offset: number;
  limit: 20;
}

export interface FinancialReviewChangeCursor {
  updatedAt: number;
  id: string;
}

export interface FinancialReviewChangesResponse {
  items: Array<{ key: string; emailUid: string }>;
  cursor: FinancialReviewChangeCursor | null;
  hasMore: boolean;
}
