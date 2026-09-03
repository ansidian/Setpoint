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

export interface AiUsageCategory extends AiUsageTotals {
  byPurpose: Partial<Record<AiUsagePurpose, AiUsageTotals>>;
  models: string[];
}

export interface EmailAiUsageStats {
  generatedAt: string;
  windowDays: number;
  ledgerStartedAt: string;
  contexts: Record<AiUsageRunContext, {
    triage: AiUsageCategory;
    financialEmail: AiUsageCategory;
  }>;
}
