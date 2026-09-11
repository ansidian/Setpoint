export type AiUsageRunContext = "production" | "evaluation";
export type AiUsagePurpose = "triage_cheap" | "triage_strong" | "extraction" | "verification" | "matching";
export type AiUsageOrigin = "background_triage" | "reader_adoption" | "manual_extraction" | "transaction_import" | "evaluation";

export interface AiUsageTotals {
  calls: number;
  failures: number;
  pendingCalls: number;
  // Nullable when no call supplied the measurement; partial sums are accompanied
  // by missingUsageCalls / unpricedCalls rather than presented as complete.
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  estimatedCostUsd: number | null;
  missingUsageCalls: number;
  unpricedCalls: number;
  totalProviderLatencyMs: number | null;
  averageProviderLatencyMs: number | null;
}

export type AiUsageFailureCode = "output_limit" | "content_filter" | "invalid_json" | "invalid_response" | "http_error" | "timeout" | "transport_error";

export interface AiUsageDiagnostics {
  responseStatus: string | null;
  stopReason: string | null;
  maxOutputTokens: number | null;
  reasoningTokens: number | null;
  failureCode: AiUsageFailureCode | null;
}

export interface AiUsageFailure {
  eventId: string;
  runId: string;
  purpose: AiUsagePurpose;
  origin: AiUsageOrigin;
  provider: "openai" | "anthropic";
  model: string;
  startedAt: string;
  providerLatencyMs: number;
  outcome: "provider_error" | "parse_error";
  httpStatus: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  diagnostics: AiUsageDiagnostics | null;
}

export interface AiUsageCategory extends AiUsageTotals {
  byPurpose: Partial<Record<AiUsagePurpose, AiUsageTotals>>;
  models: string[];
  recentFailures: AiUsageFailure[];
}

export interface EmailAiUsageStats {
  generatedAt: string;
  windowDays: number;
  ledgerStartedAt: string;
  byProvider: Record<"openai" | "anthropic", EmailAiUsageStats["contexts"]>;
  contexts: Record<AiUsageRunContext, {
    triage: AiUsageCategory;
    financialEmail: AiUsageCategory;
  }>;
}
