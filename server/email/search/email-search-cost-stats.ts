import db from "../../db/connection.ts";
import {
  EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
  EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
  EMAIL_SEARCH_EMBEDDING_MODEL,
} from "./email-search-embeddings.ts";
import type { Client, Value } from "@libsql/client";
import type { EmailSearchCostStats } from "../../../shared/types/email.ts";

export const EMAIL_SEARCH_COST_WINDOW_DAYS = 7;
export const EMAIL_SEARCH_EMBEDDING_PRICE_PER_MILLION = 0.02;
// Alfred is the planner now (the standalone inbox ask-ai planner/answer-compiler
// was retired), so the only live per-query model cost in the search path is the
// query embedding. No gpt-5.4-mini planner pricing, no synthetic planner tokens.
const QUERY_SEARCH_EVENT_TYPES = ["query_embedding"] as const;
const CORPUS_EMBEDDING_EVENT_TYPES = ["corpus_embedding"] as const;

const ESTIMATED_QUERY_CHARS = 120;

interface SemanticStatusInput {
  total: number;
  stale: number;
  missing: number;
  stateStatus: unknown;
  mode: unknown;
}

interface TokenUsage extends Record<string, unknown> {
  input_tokens?: unknown;
  prompt_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: unknown;
  input_tokens_details?: unknown;
}

interface UsageEventSummary {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  estimatedCalls: number;
}

interface UsageSummary extends UsageEventSummary {
  lastUsedAt: string | null;
  byEvent: Record<string, UsageEventSummary | undefined>;
  models: string[];
  cacheHitRate?: number;
}

interface UsageAggregateRow extends Record<string, unknown> {
  event_type?: unknown;
  model?: unknown;
  calls?: unknown;
  input_tokens?: unknown;
  cached_input_tokens?: unknown;
  output_tokens?: unknown;
  estimated_cost_usd?: unknown;
  estimated_calls?: unknown;
  last_used_at?: unknown;
}

interface RecordUsageOptions {
  dbClient?: Client;
  eventType?: string;
  model?: string;
  usage?: TokenUsage;
  estimated?: boolean;
  metadata?: unknown;
  createdAt?: Date | string | number;
}

interface CostStatsOptions {
  dbClient?: Client;
  windowDays?: number;
  now?: Date;
}

interface LoadOptions {
  dbClient: Client;
  cutoff: Date;
  eventTypes?: readonly string[];
}

interface CorpusEstimate {
  model: string;
  embeddedDocuments: number;
  documentChars: number;
  estimatedInputTokens: number;
  estimatedCostUsd: number;
  note: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function errorClass(error: unknown): string {
  if (!isRecord(error)) return "email_search_coverage_unavailable";
  return String(error.code || error.name || "email_search_coverage_unavailable");
}

function semanticStatus({ total, stale, missing, stateStatus, mode }: SemanticStatusInput): string {
  if (stateStatus === "unavailable") return "unavailable";
  if (mode === "native" && total > 0 && stale === 0 && missing === 0) return "active";
  if (total > 0 && (stale > 0 || missing > 0)) return "warming";
  if (total > 0) return "local_fallback";
  return "empty";
}

function tokenCount(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function cachedInputTokens(usage: TokenUsage = {}): number {
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  return tokenCount(
    promptDetails.cached_tokens
      ?? inputDetails.cached_tokens,
  );
}

export function estimateTokensFromChars(chars: unknown): number {
  const number = Number(chars || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.ceil(number / 4);
}

export function estimateTokensFromText(text: unknown): number {
  return estimateTokensFromChars(String(text || "").length);
}

function roundMoney(value: unknown): number {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function roundRate(value: unknown): number {
  return Math.round(Number(value || 0) * 10_000) / 10_000;
}

function priceForModel(model: unknown): { input: number; cachedInput: number; output: number } | null {
  const modelId = String(model || "");
  if (modelId === EMAIL_SEARCH_EMBEDDING_MODEL) {
    return { input: EMAIL_SEARCH_EMBEDDING_PRICE_PER_MILLION, cachedInput: 0, output: 0 };
  }
  return null;
}

function estimateCost({ model, inputTokens = 0, cachedInputTokens: cached = 0, outputTokens = 0 }: { model: unknown; inputTokens?: unknown; cachedInputTokens?: unknown; outputTokens?: unknown }): number {
  const price = priceForModel(model);
  if (!price) return 0;
  const uncachedInput = Math.max(0, tokenCount(inputTokens) - tokenCount(cached));
  return roundMoney(
    ((uncachedInput / 1_000_000) * price.input)
      + ((tokenCount(cached) / 1_000_000) * price.cachedInput)
      + ((tokenCount(outputTokens) / 1_000_000) * price.output),
  );
}

function safeMetadata(metadata: unknown = {}): string {
  try {
    return JSON.stringify(metadata || {});
  } catch {
    return "{}";
  }
}

function emptyUsageSummary(): UsageSummary {
  return {
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    estimatedCalls: 0,
    lastUsedAt: null,
    byEvent: {},
    models: [],
  };
}

function addUsage(summary: UsageSummary, row: UsageAggregateRow): void {
  const eventType = String(row.event_type || "unknown");
  if (!summary.byEvent[eventType]) {
    summary.byEvent[eventType] = {
      calls: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      estimatedCalls: 0,
    };
  }
  const event = summary.byEvent[eventType]!;
  const calls = Number(row.calls || 0);
  const inputTokens = tokenCount(row.input_tokens);
  const cached = tokenCount(row.cached_input_tokens);
  const outputTokens = tokenCount(row.output_tokens);
  const storedEstimatedCost = roundMoney(row.estimated_cost_usd);
  const estimatedCost = storedEstimatedCost || estimateCost({
    model: row.model,
    inputTokens,
    cachedInputTokens: cached,
    outputTokens,
  });
  const estimatedCalls = Number(row.estimated_calls || 0);

  summary.calls += calls;
  summary.inputTokens += inputTokens;
  summary.cachedInputTokens += cached;
  summary.outputTokens += outputTokens;
  summary.estimatedCostUsd += estimatedCost;
  summary.estimatedCalls += estimatedCalls;
  if (row.model) summary.models.push(String(row.model));
  const lastUsedAt = row.last_used_at ? String(row.last_used_at) : null;
  if (lastUsedAt && (!summary.lastUsedAt || lastUsedAt > summary.lastUsedAt)) {
    summary.lastUsedAt = lastUsedAt;
  }

  event.calls += calls;
  event.inputTokens += inputTokens;
  event.cachedInputTokens += cached;
  event.outputTokens += outputTokens;
  event.estimatedCostUsd += estimatedCost;
  event.estimatedCalls += estimatedCalls;
}

function finalizeUsageSummary(summary: UsageSummary): UsageSummary {
  summary.estimatedCostUsd = roundMoney(summary.estimatedCostUsd);
  summary.cacheHitRate = summary.inputTokens
    ? roundRate(summary.cachedInputTokens / summary.inputTokens)
    : 0;
  summary.models = [...new Set(summary.models)].filter(Boolean).sort();
  for (const event of Object.values(summary.byEvent)) {
    if (!event) continue;
    event.estimatedCostUsd = roundMoney(event.estimatedCostUsd);
  }
  return summary;
}

function perQueryEstimate() {
  const queryEmbeddingTokens = estimateTokensFromChars(ESTIMATED_QUERY_CHARS);
  return {
    note: "Estimated cost of embedding one search query (Alfred is the planner; no separate planner call).",
    model: EMAIL_SEARCH_EMBEDDING_MODEL,
    inputTokens: queryEmbeddingTokens,
    estimatedCostUsd: estimateCost({ model: EMAIL_SEARCH_EMBEDDING_MODEL, inputTokens: queryEmbeddingTokens }),
  };
}

export async function recordEmailSearchAiUsage(userId: string, {
  dbClient = db,
  eventType,
  model,
  usage = {},
  estimated = false,
  metadata = {},
  createdAt = new Date(),
}: RecordUsageOptions = {}): Promise<void> {
  if (!userId || !eventType || !model) return;
  const inputTokens = tokenCount(usage.input_tokens);
  const cached = cachedInputTokens(usage);
  const outputTokens = tokenCount(usage.output_tokens);
  const estimatedCostUsd = estimateCost({
    model,
    inputTokens,
    cachedInputTokens: cached,
    outputTokens,
  });
  const createdDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const createdAtIso = Number.isNaN(createdDate.getTime())
    ? new Date().toISOString()
    : createdDate.toISOString();
  try {
    await dbClient.execute({
      sql: `INSERT INTO ea_email_search_ai_usage
              (user_id, event_type, model, input_tokens, cached_input_tokens,
               output_tokens, estimated, estimated_cost_usd, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        userId,
        eventType,
        model,
        inputTokens,
        cached,
        outputTokens,
        estimated ? 1 : 0,
        estimatedCostUsd,
        safeMetadata(metadata),
        createdAtIso,
      ],
    });
  } catch (err) {
    if (!/no such table/i.test(errorMessage(err))) {
      console.warn("[EA] Failed to record email search AI usage:", errorMessage(err));
    }
  }
}

function eventTypeFilter(eventTypes: readonly string[]): { sql: string; args: Value[] } {
  if (!eventTypes?.length) {
    return { sql: "", args: [] };
  }
  return {
    sql: ` AND event_type IN (${eventTypes.map(() => "?").join(", ")})`,
    args: [...eventTypes],
  };
}

async function loadUsageSummary(userId: string, { dbClient, cutoff, eventTypes = [] }: LoadOptions): Promise<UsageSummary> {
  const summary = emptyUsageSummary();
  const filter = eventTypeFilter(eventTypes);
  try {
    const result = await dbClient.execute({
      sql: `SELECT event_type, model,
                   COUNT(*) AS calls,
                   SUM(input_tokens) AS input_tokens,
                   SUM(cached_input_tokens) AS cached_input_tokens,
                   SUM(output_tokens) AS output_tokens,
                   SUM(estimated_cost_usd) AS estimated_cost_usd,
                   SUM(CASE WHEN estimated = 1 THEN 1 ELSE 0 END) AS estimated_calls,
                   MAX(created_at) AS last_used_at
            FROM ea_email_search_ai_usage
            WHERE user_id = ?
              AND created_at >= ?${filter.sql}
            GROUP BY event_type, model
            ORDER BY event_type ASC, model ASC`,
      args: [userId, cutoff.toISOString(), ...filter.args],
    });
    for (const row of result.rows) addUsage(summary, row as UsageAggregateRow);
  } catch (err) {
    if (!/no such table/i.test(errorMessage(err))) throw err;
  }
  return finalizeUsageSummary(summary);
}

// P3-6: the corpus estimate sums LENGTH(document_text) across the whole
// embedding corpus. It is only reached via the opt-in cache-stats diagnostics
// (?semantic=1), but a short-TTL memo keeps repeated refreshes from re-running
// the full aggregate. Keyed by dbClient so the production singleton memoizes
// while each test's distinct connection stays isolated.
const CORPUS_ESTIMATE_TTL_MS = 60_000;
const corpusEstimateCache = new WeakMap<Client, Map<string, { value: CorpusEstimate; expiresAt: number }>>();

async function loadCorpusEmbeddingEstimate(userId: string, { dbClient }: { dbClient: Client }): Promise<CorpusEstimate> {
  const byUser = corpusEstimateCache.get(dbClient);
  const cached = byUser?.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const result = await dbClient.execute({
      sql: `SELECT COUNT(*) AS embedded_documents,
                   COALESCE(SUM(LENGTH(document_text)), 0) AS document_chars
            FROM ea_email_search_embeddings
            WHERE user_id = ?
              AND document_version = ?
              AND embedding_model = ?
              AND embedding_dimensions = ?`,
      args: [
        userId,
        EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
        EMAIL_SEARCH_EMBEDDING_MODEL,
        EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
      ],
    });
    const row: Record<string, unknown> = result.rows[0] || {};
    const documentChars = Number(row.document_chars || 0);
    const estimatedInputTokens = estimateTokensFromChars(documentChars);
    const value = {
      model: EMAIL_SEARCH_EMBEDDING_MODEL,
      embeddedDocuments: Number(row.embedded_documents || 0),
      documentChars,
      estimatedInputTokens,
      estimatedCostUsd: estimateCost({
        model: EMAIL_SEARCH_EMBEDDING_MODEL,
        inputTokens: estimatedInputTokens,
      }),
      note: "Current-corpus replacement estimate from stored embedding documents; historical re-embeds are not reconstructed.",
    };
    const entries = byUser || new Map();
    entries.set(userId, { value, expiresAt: Date.now() + CORPUS_ESTIMATE_TTL_MS });
    if (!byUser) corpusEstimateCache.set(dbClient, entries);
    return value;
  } catch (err) {
    if (!/no such table/i.test(errorMessage(err))) throw err;
    return {
      model: EMAIL_SEARCH_EMBEDDING_MODEL,
      embeddedDocuments: 0,
      documentChars: 0,
      estimatedInputTokens: 0,
      estimatedCostUsd: 0,
      note: "Embedding table is not available in this database.",
    };
  }
}

async function loadCorpusEmbeddingUsage(userId: string, { dbClient, cutoff }: { dbClient: Client; cutoff: Date }): Promise<UsageSummary> {
  return loadUsageSummary(userId, {
    dbClient,
    cutoff,
    eventTypes: CORPUS_EMBEDDING_EVENT_TYPES,
  });
}

async function loadCoverage(userId: string, { dbClient }: { dbClient: Client }) {
  try {
    const result = await dbClient.execute({
      sql: `SELECT status, mode, total_indexed, fresh_embeddings, stale_embeddings,
                   missing_embeddings, last_error_class, attempts, updated_at
            FROM ea_email_search_embedding_state
            WHERE user_id = ?`,
      args: [userId],
    });
    const state = result.rows[0] || null;
    if (state) {
      const total = Number(state.total_indexed || 0);
      const fresh = Number(state.fresh_embeddings || 0);
      const stale = Number(state.stale_embeddings || 0);
      const missing = Number(state.missing_embeddings || 0);
      const mode = state.mode || "fallback";
      return {
        semantic_status: semanticStatus({
          total,
          stale,
          missing,
          stateStatus: state.status,
          mode,
        }),
        mode: String(mode),
        total_indexed: total,
        fresh_embeddings: fresh,
        stale_embeddings: stale,
        missing_embeddings: missing,
        coverage_ratio: total ? fresh / total : 0,
        last_error_class: state.last_error_class || "",
        attempts: Number(state.attempts || 0),
        updated_at: state.updated_at || null,
        source: "worker_state",
      };
    }

    const counts = await dbClient.execute({
      sql: `SELECT
              (SELECT COUNT(*) FROM ea_email_index WHERE user_id = ?) AS total_indexed,
              (SELECT COUNT(*) FROM ea_email_search_embeddings
                WHERE user_id = ?
                  AND document_version = ?
                  AND embedding_model = ?
                  AND embedding_dimensions = ?) AS fresh_embeddings`,
      args: [
        userId,
        userId,
        EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
        EMAIL_SEARCH_EMBEDDING_MODEL,
        EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
      ],
    });
    const row: Record<string, unknown> = counts.rows[0] || {};
    const total = Number(row.total_indexed || 0);
    const fresh = Number(row.fresh_embeddings || 0);
    const missing = Math.max(0, total - fresh);
    return {
      semantic_status: semanticStatus({
        total,
        stale: 0,
        missing,
        stateStatus: null,
        mode: "unknown",
      }),
      mode: "unknown",
      total_indexed: total,
      fresh_embeddings: fresh,
      stale_embeddings: 0,
      missing_embeddings: missing,
      coverage_ratio: total ? fresh / total : 0,
      last_error_class: "",
      attempts: 0,
      updated_at: null,
      source: "count_fallback",
    };
  } catch (err) {
    return {
      semantic_status: "unavailable",
      mode: "unknown",
      total_indexed: 0,
      fresh_embeddings: 0,
      stale_embeddings: 0,
      missing_embeddings: 0,
      coverage_ratio: 0,
      last_error_class: errorClass(err),
    };
  }
}

export async function getEmailSearchCostStats(userId: string, {
  dbClient = db,
  windowDays = EMAIL_SEARCH_COST_WINDOW_DAYS,
  now = new Date(),
}: CostStatsOptions = {}): Promise<EmailSearchCostStats> {
  const cutoff = new Date(now.getTime() - (windowDays * 24 * 60 * 60 * 1000));
  const [coverage, corpusEmbeddings, queryUsage, corpusEmbeddingUsage] = await Promise.all([
    loadCoverage(userId, { dbClient }),
    loadCorpusEmbeddingEstimate(userId, { dbClient }),
    loadUsageSummary(userId, { dbClient, cutoff, eventTypes: QUERY_SEARCH_EVENT_TYPES }),
    loadCorpusEmbeddingUsage(userId, { dbClient, cutoff }),
  ]);

  return {
    askAi: undefined,
    windowDays,
    generatedAt: now.toISOString(),
    pricing: {
      source: "OpenAI standard API pricing, stored as code constants for estimates",
      tokenHeuristic: "Approximate text tokens as ceil(characters / 4) when provider usage is not available.",
      models: {
        [EMAIL_SEARCH_EMBEDDING_MODEL]: {
          input: EMAIL_SEARCH_EMBEDDING_PRICE_PER_MILLION,
          unit: "USD per 1M input tokens",
        },
      },
    },
    coverage,
    corpusEmbeddings: { ...corpusEmbeddings, actualUsage: corpusEmbeddingUsage },
    querySearch: {
      actualUsage: queryUsage,
      perQueryEstimate: perQueryEstimate(),
    },
  };
}
