import db from "../db/connection.ts";
import type { AiUsageDb } from "./ai-usage.ts";
import type { AiUsageCategory, AiUsagePurpose, AiUsageTotals, EmailAiUsageStats } from "../../shared/types/ai-usage.ts";

function emptyTotals(): AiUsageTotals {
  return {
    calls: 0, failures: 0, pendingCalls: 0,
    inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0,
    estimatedCostUsd: 0, missingUsageCalls: 0, unpricedCalls: 0,
    totalProviderLatencyMs: 0, averageProviderLatencyMs: null,
  };
}

function emptyCategory(): AiUsageCategory {
  return { ...emptyTotals(), byPurpose: {}, models: [] };
}

const measurements = {
  inputTokens: "input_tokens", outputTokens: "output_tokens", cachedInputTokens: "cached_input_tokens",
  cacheCreationInputTokens: "cache_creation_input_tokens", estimatedCostUsd: "estimated_cost_usd",
  totalProviderLatencyMs: "provider_latency_ms",
} as const;

function addRow(totals: AiUsageTotals, row: Record<string, unknown>) {
  for (const [field, column] of Object.entries(measurements) as Array<[keyof typeof measurements, string]>) {
    const value = row[column] == null ? null : Number(row[column]);
    totals[field] = totals.calls === 0 ? value
      : totals[field] === null && value === null ? null : (totals[field] ?? 0) + (value ?? 0);
  }
  totals.calls += Number(row.calls);
  totals.failures += Number(row.failures);
  totals.pendingCalls += Number(row.pending_calls);
  totals.missingUsageCalls += Number(row.missing_usage_calls);
  totals.unpricedCalls += Number(row.unpriced_calls);
  totals.averageProviderLatencyMs = totals.calls && totals.totalProviderLatencyMs !== null
    ? totals.totalProviderLatencyMs / totals.calls : null;
}

// Bounded rollup, not email reconstruction. Existing evaluation records stay
// separate for compatibility; the UI reads only production and new evaluations
// bypass accounting entirely.
export async function getEmailAiUsageStats(userId: string, {
  dbClient = db,
  now = new Date(),
  windowDays = 7,
}: { dbClient?: AiUsageDb; now?: Date; windowDays?: number } = {}): Promise<EmailAiUsageStats> {
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
  const [boundary, result] = await Promise.all([
    dbClient.execute({ sql: "SELECT started_at FROM ea_ai_usage_cutover WHERE id = 1", args: [] }),
    dbClient.execute({
      sql: `SELECT run_context, purpose, provider, model, COUNT(*) AS calls,
        SUM(outcome IN ('provider_error', 'parse_error')) AS failures,
        SUM(outcome = 'response_received') AS pending_calls,
        SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
        SUM(cached_input_tokens) AS cached_input_tokens,
        SUM(cache_creation_input_tokens) AS cache_creation_input_tokens,
        SUM(estimated_cost_usd) AS estimated_cost_usd,
        SUM(provider_latency_ms) AS provider_latency_ms,
        SUM(input_tokens IS NULL OR output_tokens IS NULL OR cached_input_tokens IS NULL
          OR cache_creation_input_tokens IS NULL) AS missing_usage_calls,
        SUM(estimated_cost_usd IS NULL) AS unpriced_calls
        FROM ea_ai_usage_events WHERE user_id = ? AND started_at >= ? AND started_at <= ?
        GROUP BY run_context, purpose, provider, model`,
      args: [userId, cutoff, now.toISOString()],
    }),
  ]);
  const response: EmailAiUsageStats = {
    generatedAt: now.toISOString(), windowDays,
    ledgerStartedAt: String(boundary.rows[0]?.started_at ?? ""),
    contexts: {
      production: { triage: emptyCategory(), financialEmail: emptyCategory() },
      evaluation: { triage: emptyCategory(), financialEmail: emptyCategory() },
    },
  };
  for (const row of result.rows) {
    const purpose = row.purpose as AiUsagePurpose;
    const context = row.run_context === "evaluation" ? response.contexts.evaluation : response.contexts.production;
    const category = purpose.startsWith("triage_") ? context.triage : context.financialEmail;
    addRow(category, row);
    const detail = category.byPurpose[purpose] ??= emptyTotals();
    addRow(detail, row);
    const model = `${row.provider}: ${row.model}`;
    if (!category.models.includes(model)) category.models.push(model);
  }
  for (const context of Object.values(response.contexts)) {
    context.triage.models.sort();
    context.financialEmail.models.sort();
  }
  return response;
}
