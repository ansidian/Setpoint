export type EmailProvider = "gmail" | "icloud";

export interface EmailAccountSummary {
  id: string;
  type: EmailProvider;
  email: string;
  label: string;
  color: string;
  icon: string;
}

export interface NormalizedFetchedEmail extends Record<string, unknown> {
  uid: string;
  account_id: string;
  account_label: string;
  account_email: string;
  account_color?: string;
  account_icon?: string;
  from: string;
  from_email?: string;
  subject: string;
  body_preview: string;
  body_text: string;
  date: string;
  read: boolean;
  message_id?: string | null;
  thread_id?: string | null;
  labels?: string[];
  folders?: string[];
}

export interface EmailHtmlBody {
  html_body: string;
  subject: string;
  from: string;
  date: string;
}

export interface EmailPlainBody {
  body: string;
  uid?: string;
  subject?: string;
  from?: string;
  date?: string;
}

export type EmailBody = EmailHtmlBody | EmailPlainBody;

export interface EmailMutationResponse {
  ok: true;
}

export interface EmailBatchReadFailure {
  provider: EmailProvider | "unknown";
  uids: string[];
  message: string;
}

export interface EmailBatchReadResponse {
  ok: boolean;
  updatedUids: string[];
  failed: EmailBatchReadFailure[];
}

export interface EmailArrivalGraceResponse extends EmailMutationResponse {
  settled: number;
  emailIds: string[];
}

export interface EmailSearchResult extends Record<string, unknown> {
  uid: string;
  from_name: string | null;
  from_address: string | null;
  subject: string | null;
  body_snippet: string | null;
  subject_highlight: string | null;
  body_highlight: string | null;
  email_date: string | null;
  read: boolean;
  web_url: string | null;
  account_id: string;
  account_label: string;
  account_email: string;
  account_color: string | null;
  account_icon: string | null;
  hasBill?: true;
  bill_candidate?: Record<string, unknown>;
  extractedBill?: Record<string, unknown> | null;
  search_score?: number;
  search_score_details?: {
    score: number;
    details: Array<{ label: string; value: number }>;
    lane: unknown;
    category: unknown;
    urgency: unknown;
    penalized: boolean;
  };
}

export interface EmailSearchAccount {
  account_id: string;
  account_label: string;
  account_email: string;
  account_color: string | null;
  account_icon: string | null;
  results: EmailSearchResult[];
}

export interface EmailSearchResponse {
  results: EmailSearchResult[];
  accounts: EmailSearchAccount[];
  total: number;
  offset: number;
  has_more: boolean;
  capped: boolean;
  query: string;
}

// Older indexed-search responses grouped results under each account. The
// Inbox client still accepts that shape at its API boundary, while server
// search implementations retain the stricter EmailSearchResponse contract.
export type EmailSearchClientResponse =
  | EmailSearchResponse
  | Omit<EmailSearchResponse, "results">;

export interface EmailDevReindexResponse {
  indexed: number;
  hoursBack: number;
}

export interface EmailRangeResult {
  emails: NormalizedFetchedEmail[];
  nextPageToken?: string | null;
  resultSizeEstimate?: number;
  cursor?: string | null;
}

export interface EmailProviderMutationResult {
  provider: EmailProvider;
  accountId: string;
}

export interface PinnedEmailSnapshot extends Record<string, unknown> {
  account_id?: string | null;
  subject?: string;
  from?: string;
  from_email?: string;
  preview?: string;
  date?: string | null;
  read?: boolean;
  account_label?: string | null;
  account_email?: string | null;
  account_color?: string | null;
  account_icon?: string | null;
  urgency?: string | null;
}

export interface PinnedEmailEntry {
  uid: string;
  pinned_at: string;
  account_id: string | null;
  subject: string;
  from_name: string;
  from_address: string;
  preview: string;
  date: string | null;
  read: boolean;
  account_label: string | null;
  account_email: string | null;
  account_color: string | null;
  account_icon: string | null;
  lane: string | null;
  urgency: string | null;
  category: string | null;
  handled_at: string | null;
  provider_state: string | null;
}

export interface EmailIndexBackfillState {
  mailbox_scope: unknown;
  status: unknown;
  target_days: unknown;
  oldest_target_date: unknown;
  oldest_indexed_date: unknown;
  last_scanned_at: unknown;
  current_window: unknown;
  cursor_json: Record<string, unknown>;
  indexed_count: number;
  last_error: unknown;
  attempts: number;
  started_at: unknown;
  completed_at: unknown;
  updated_at: unknown;
}

export interface EmailIndexHealthAccount {
  account_id: string;
  label: string;
  email: string;
  type: EmailProvider;
  indexed_count: number;
  oldest_indexed_date: unknown;
  newest_indexed_date: unknown;
  last_indexed_at: unknown;
  backfill: EmailIndexBackfillState;
}

export interface EmailIndexHealthResponse {
  accounts: EmailIndexHealthAccount[];
}

export interface EmailIndexBackfillAccount {
  account_id: string;
  label: string;
  email: string;
  type: EmailProvider;
  status: "queued";
}

export interface EmailIndexBackfillResponse {
  queued: boolean;
  mailbox_scope: string;
  target_days: number;
  oldest_target_date: string | null;
  accounts: EmailIndexBackfillAccount[];
}

export interface EmailSearchUsageEventSummary {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  estimatedCalls: number;
}

export interface EmailSearchUsageSummary extends EmailSearchUsageEventSummary {
  lastUsedAt: string | null;
  byEvent: Record<string, EmailSearchUsageEventSummary | undefined>;
  models: string[];
  cacheHitRate?: number;
}

export interface EmailSearchCoverage {
  semantic_status: string;
  mode: string;
  total_indexed: number;
  fresh_embeddings: number;
  stale_embeddings: number;
  missing_embeddings: number;
  coverage_ratio: number;
  last_error_class: unknown;
  attempts?: number;
  updated_at?: unknown;
  source?: string;
}

export interface EmailSearchCostStats {
  askAi?: undefined;
  windowDays: number;
  generatedAt: string;
  pricing: {
    source: string;
    tokenHeuristic: string;
    models: Record<string, { input: number; unit: string }>;
  };
  coverage: EmailSearchCoverage;
  corpusEmbeddings: {
    model: string;
    embeddedDocuments: number;
    documentChars: number;
    estimatedInputTokens: number;
    estimatedCostUsd: number;
    note: string;
    actualUsage: EmailSearchUsageSummary;
  };
  querySearch: {
    actualUsage: EmailSearchUsageSummary;
    perQueryEstimate: {
      note: string;
      model: string;
      inputTokens: number;
      estimatedCostUsd: number;
    };
  };
}

export interface GmailPubSubStatus {
  configured: boolean;
  healthy: boolean;
  deliveryMode: "periodic" | "push_and_periodic";
  deliveryStatus: "periodic_reconciliation" | "near_real_time";
  delayedUpdates: boolean;
  topic: { source: "stored" | "environment" | "disabled" | "absent"; configured: boolean };
  pushToken: { source: "stored" | "environment" | "disabled" | "absent"; configured: boolean };
  callbackUrl: string;
  watchTest: {
    lastTestedAt: string | null;
    lastSucceededAt: string | null;
    lastFailedAt: string | null;
    errorCode: string | null;
  };
}

export interface GmailPubSubCallbackResponse {
  callbackUrl: string;
  externalSubscriptionUpdateRequired: true;
  status: GmailPubSubStatus;
}

export interface GmailPubSubWatchTestResponse {
  ok: boolean;
  errorCode: string | null;
  checked: number;
  registered: number;
}
