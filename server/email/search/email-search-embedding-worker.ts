import db from "../../db/connection.ts";
import {
  estimateTokensFromText,
  recordEmailSearchAiUsage,
} from "./email-search-cost-stats.ts";
import { createEmailSearchEmbeddingClient } from "./email-search-embedding-client.ts";
import {
  createEmailSearchEmbeddingStore,
  detectEmailSearchVectorCapability,
} from "./email-search-embedding-store.ts";
import {
  EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
  EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
  EMAIL_SEARCH_EMBEDDING_MODEL,
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.ts";
import type { Client } from "@libsql/client";
import type { EmailSearchEmbeddingClient, EmailSearchEmbeddingVectors } from "./email-search-embedding-client.ts";
import type { EmailSearchVectorCapability } from "./email-search-embedding-store.ts";
import type { EmailSearchEmbeddingSourceRow } from "./email-search-embeddings.ts";

const DEFAULT_BATCH_LIMIT = 25;
const DEFAULT_EMBEDDING_BATCH_SIZE = 16;
const CORPUS_EMBEDDING_EVENT_TYPE = "corpus_embedding";
const CONTENT_HASH_AUDIT_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface CoverageCounts {
  total_indexed: number;
  fresh_embeddings: number;
  stale_embeddings: number;
  missing_embeddings: number;
  coverage_ratio: number;
}

export interface EmailSearchEmbeddingCoverageStatus extends CoverageCounts {
  semantic_status: string;
  mode: string;
  last_error_class: unknown;
  attempts: number;
  updated_at: unknown;
}

interface WorkerStateRow extends Record<string, unknown> {
  status?: unknown;
  mode?: unknown;
  last_error_class?: unknown;
  attempts?: unknown;
  last_completed_at?: unknown;
  updated_at?: unknown;
}

type FastCoverageStatus = EmailSearchEmbeddingCoverageStatus & {
  last_completed_at: unknown;
};

interface CoverageOptions {
  dbClient?: Client;
  capability?: EmailSearchVectorCapability | null;
}

interface BatchOptions extends CoverageOptions {
  embeddingClient?: EmailSearchEmbeddingClient;
  limit?: string | number;
  batchSize?: string | number;
  recordUsage?: typeof recordEmailSearchAiUsage;
}

interface WorkerStateWrite {
  userId: string;
  status: string;
  mode?: string;
  counts?: Partial<CoverageCounts>;
  error?: unknown;
  started?: boolean;
  completed?: boolean;
}

interface WorkerBatchResult {
  status: string;
  semantic_status: string;
  selected: number;
  embedded: number;
  failed: number;
  error_class?: string;
}

function errorFields(error: unknown): { status?: number; code?: string; name?: string } {
  if (!error || typeof error !== "object") return {};
  const value = error as Record<string, unknown>;
  return {
    ...(typeof value.status === "number" ? { status: value.status } : {}),
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function clampPositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function errorClass(err: unknown): string {
  const fields = errorFields(err);
  return fields.code || fields.name || "email_search_embedding_worker_error";
}

function usageTokensFromEmbeddingResponse(vectors: EmailSearchEmbeddingVectors, texts: string[]) {
  const usage = vectors?.usage || {};
  const providerTokens = Number(
    usage.input_tokens
      ?? usage.prompt_tokens
      ?? usage.total_tokens
      ?? 0,
  );
  if (Number.isFinite(providerTokens) && providerTokens > 0) {
    return {
      usage: { input_tokens: Math.round(providerTokens), output_tokens: 0 },
      estimated: false,
    };
  }
  const inputTokens = texts.reduce(
    (total, text) => total + estimateTokensFromText(text),
    0,
  );
  return {
    usage: { input_tokens: inputTokens, output_tokens: 0 },
    estimated: true,
  };
}

async function safeRecordCorpusEmbeddingUsage(recordUsage: typeof recordEmailSearchAiUsage, userId: string, {
  dbClient,
  vectors,
  texts,
  embedded,
  batchSize,
}: { dbClient: Client; vectors: EmailSearchEmbeddingVectors; texts: string[]; embedded: number; batchSize: number }): Promise<void> {
  const { usage, estimated } = usageTokensFromEmbeddingResponse(vectors, texts);
  try {
    await recordUsage?.(userId, {
      dbClient,
      eventType: CORPUS_EMBEDDING_EVENT_TYPE,
      model: vectors?.model || EMAIL_SEARCH_EMBEDDING_MODEL,
      usage,
      estimated,
      metadata: {
        embedded,
        batch_size: batchSize,
      },
    });
  } catch (err) {
    console.warn("[EA] Failed to record email search corpus embedding usage:", errorMessage(err));
  }
}

function semanticStatus({ total, stale, missing, stateStatus, mode }: { total: number; stale: number; missing: number; stateStatus: unknown; mode: string }): string {
  if (stateStatus === "unavailable") return "unavailable";
  if (mode === "native" && total > 0 && stale === 0 && missing === 0) return "active";
  if (total > 0 && stale === 0 && missing === 0) return "active";
  if (total > 0) return mode === "fallback" ? "local_fallback" : "warming";
  return mode === "fallback" ? "local_fallback" : "warming";
}

async function upsertWorkerState(dbClient: Client, {
  userId,
  status,
  mode,
  counts = {},
  error = null,
  started = false,
  completed = false,
}: WorkerStateWrite): Promise<void> {
  await dbClient.execute({
    sql: `INSERT INTO ea_email_search_embedding_state
            (user_id, status, mode, total_indexed, fresh_embeddings,
             stale_embeddings, missing_embeddings, last_error_class, last_error,
             attempts, last_started_at, last_completed_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            status = excluded.status,
            mode = excluded.mode,
            total_indexed = excluded.total_indexed,
            fresh_embeddings = excluded.fresh_embeddings,
            stale_embeddings = excluded.stale_embeddings,
            missing_embeddings = excluded.missing_embeddings,
            last_error_class = excluded.last_error_class,
            last_error = excluded.last_error,
            attempts = ea_email_search_embedding_state.attempts + excluded.attempts,
            last_started_at = COALESCE(excluded.last_started_at, ea_email_search_embedding_state.last_started_at),
            last_completed_at = COALESCE(excluded.last_completed_at, ea_email_search_embedding_state.last_completed_at),
            updated_at = datetime('now')`,
    args: [
      userId,
      status,
      mode || "fallback",
      Number(counts.total_indexed || 0),
      Number(counts.fresh_embeddings || 0),
      Number(counts.stale_embeddings || 0),
      Number(counts.missing_embeddings || 0),
      error ? errorClass(error) : "",
      error ? errorClass(error) : "",
      started ? 1 : 0,
      started ? new Date().toISOString() : null,
      completed ? new Date().toISOString() : null,
    ],
  });
}

async function loadIndexedRowsForCoverage(dbClient: Client, userId: string): Promise<(EmailSearchEmbeddingSourceRow & Record<string, unknown>)[]> {
  const result = await dbClient.execute({
    sql: `SELECT idx.uid, idx.user_id, idx.account_id, idx.from_name, idx.from_address,
                 idx.subject, idx.body_snippet, idx.body_text,
                 emb.source_hash AS existing_source_hash,
                 emb.document_version AS existing_document_version,
                 emb.embedding_model AS existing_embedding_model,
                 emb.embedding_dimensions AS existing_embedding_dimensions
          FROM ea_email_index idx
          LEFT JOIN ea_email_search_embeddings emb ON emb.uid = idx.uid
          WHERE idx.user_id = ?`,
    args: [userId],
  });
  return result.rows as unknown as (EmailSearchEmbeddingSourceRow & Record<string, unknown>)[];
}

function summarizeCoverage(rows: (EmailSearchEmbeddingSourceRow & Record<string, unknown>)[]): CoverageCounts {
  let fresh = 0;
  let stale = 0;
  let missing = 0;

  for (const row of rows) {
    const document = buildEmailSearchEmbeddingDocument(row);
    const sourceHash = computeEmailSearchEmbeddingSourceHash(document);
    if (!row.existing_source_hash) {
      missing++;
      continue;
    }
    if (
      row.existing_source_hash === sourceHash
      && row.existing_document_version === EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION
      && row.existing_embedding_model === EMAIL_SEARCH_EMBEDDING_MODEL
      && row.existing_embedding_dimensions === EMAIL_SEARCH_EMBEDDING_DIMENSIONS
    ) {
      fresh++;
    } else {
      stale++;
    }
  }

  return {
    total_indexed: rows.length,
    fresh_embeddings: fresh,
    stale_embeddings: stale,
    missing_embeddings: missing,
    coverage_ratio: rows.length ? fresh / rows.length : 0,
  };
}

async function loadWorkerState(dbClient: Client, userId: string): Promise<WorkerStateRow | null> {
  const result = await dbClient.execute({
    sql: `SELECT status, mode, last_error_class, last_error, attempts,
                 last_started_at, last_completed_at, updated_at
          FROM ea_email_search_embedding_state
          WHERE user_id = ?`,
    args: [userId],
  });
  return result.rows[0] as unknown as WorkerStateRow || null;
}

function buildCoverageStatus(counts: CoverageCounts, state: WorkerStateRow | null, mode: string): EmailSearchEmbeddingCoverageStatus {
  return {
    semantic_status: semanticStatus({
      total: counts.total_indexed,
      stale: counts.stale_embeddings,
      missing: counts.missing_embeddings,
      stateStatus: state?.status,
      mode,
    }),
    mode,
    ...counts,
    last_error_class: state?.last_error_class || "",
    attempts: Number(state?.attempts || 0),
    updated_at: state?.updated_at || null,
  };
}

// On-demand, hash-aware coverage. Scans full bodies to detect content/hash
// staleness; used by the status route and exercised directly by tests. The
// 5-min cron uses getCoverageStatusFast instead (see below) to avoid this scan.
export async function getEmailSearchEmbeddingCoverageStatus(userId: string, {
  dbClient = db,
  capability = null,
}: CoverageOptions = {}): Promise<EmailSearchEmbeddingCoverageStatus> {
  const [rows, state] = await Promise.all([
    loadIndexedRowsForCoverage(dbClient, userId),
    loadWorkerState(dbClient, userId),
  ]);
  const counts = summarizeCoverage(rows);
  const mode = capability?.mode || String(state?.mode || "fallback");
  return buildCoverageStatus(counts, state, mode);
}

// Cheap coverage for the 5-min cron: counts via a SQL aggregate so full email
// bodies never leave the DB (P1-9 — the old path scanned every body twice per
// tick, even when idle). "stale" here is config-staleness only (document_version
// / model / dimensions mismatch). Content/hash staleness is detected
// authoritatively by the bounded candidate query (listRowsNeedingEmbeddings),
// which drives what actually gets re-embedded, so embedding correctness is
// unaffected — only the cron's stored display counts skip the hash check.
async function loadCoverageCounts(dbClient: Client, userId: string): Promise<CoverageCounts> {
  const result = await dbClient.execute({
    sql: `SELECT
            COUNT(*) AS total_indexed,
            COUNT(CASE WHEN emb.uid IS NULL THEN 1 END) AS missing_embeddings,
            COUNT(CASE WHEN emb.uid IS NOT NULL
                        AND (emb.document_version != ?
                             OR emb.embedding_model != ?
                             OR emb.embedding_dimensions != ?) THEN 1 END) AS stale_embeddings
          FROM ea_email_index idx
          LEFT JOIN ea_email_search_embeddings emb ON emb.uid = idx.uid
          WHERE idx.user_id = ?`,
    args: [
      EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
      EMAIL_SEARCH_EMBEDDING_MODEL,
      EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
      userId,
    ],
  });
  const row: Record<string, unknown> = result.rows[0] || {};
  const total = Number(row.total_indexed || 0);
  const missing = Number(row.missing_embeddings || 0);
  const stale = Number(row.stale_embeddings || 0);
  const fresh = Math.max(0, total - missing - stale);
  return {
    total_indexed: total,
    fresh_embeddings: fresh,
    stale_embeddings: stale,
    missing_embeddings: missing,
    coverage_ratio: total ? fresh / total : 0,
  };
}

// Query-time coverage signal for retrieval fusion: fresh embeddings / total indexed,
// via the same single SQL aggregate the cron uses (no body scan, no vector capability
// needed). Returns null when nothing is indexed so callers default to full trust.
export async function getEmailSearchEmbeddingCoverageRatio(userId: string, { dbClient = db }: { dbClient?: Client } = {}): Promise<number | null> {
  const counts = await loadCoverageCounts(dbClient, userId);
  if (!counts.total_indexed) return null;
  return counts.coverage_ratio;
}

async function getCoverageStatusFast(userId: string, { dbClient = db, capability = null }: CoverageOptions = {}): Promise<FastCoverageStatus> {
  const [counts, state] = await Promise.all([
    loadCoverageCounts(dbClient, userId),
    loadWorkerState(dbClient, userId),
  ]);
  const mode = capability?.mode || String(state?.mode || "fallback");
  return {
    ...buildCoverageStatus(counts, state, mode),
    last_completed_at: state?.last_completed_at || null,
  };
}

function needsEmbeddingCandidateScan(status: FastCoverageStatus, now = new Date()): boolean {
  if (
    status.semantic_status === "unavailable"
    || status.missing_embeddings > 0
    || status.stale_embeddings > 0
  ) return true;
  const lastCompletedAt = new Date(String(status.last_completed_at || "")).getTime();
  return !Number.isFinite(lastCompletedAt)
    || now.getTime() - lastCompletedAt >= CONTENT_HASH_AUDIT_INTERVAL_MS;
}

export async function processEmailSearchEmbeddingBatch(userId: string, {
  dbClient = db,
  embeddingClient = createEmailSearchEmbeddingClient(),
  capability = null,
  limit = DEFAULT_BATCH_LIMIT,
  batchSize = DEFAULT_EMBEDDING_BATCH_SIZE,
  recordUsage = recordEmailSearchAiUsage,
}: BatchOptions = {}): Promise<WorkerBatchResult> {
  const resolvedCapability = capability || await detectEmailSearchVectorCapability(dbClient);
  const store = createEmailSearchEmbeddingStore(dbClient, resolvedCapability);
  const maxRows = clampPositiveInteger(limit, DEFAULT_BATCH_LIMIT, 100);
  const embedBatchSize = clampPositiveInteger(batchSize, DEFAULT_EMBEDDING_BATCH_SIZE, 100);
  const before = await getCoverageStatusFast(userId, {
    dbClient,
    capability: resolvedCapability,
  });
  if (!needsEmbeddingCandidateScan(before)) {
    return {
      status: "active",
      semantic_status: before.semantic_status,
      selected: 0,
      embedded: 0,
      failed: 0,
    };
  }
  await upsertWorkerState(dbClient, {
    userId,
    status: "running",
    mode: resolvedCapability.mode,
    counts: before,
    started: true,
  });

  const candidates = await store.listRowsNeedingEmbeddings(userId, {
    limit: maxRows,
    scanLimit: Math.max(500, maxRows * 10),
  });
  if (!candidates.length) {
    await upsertWorkerState(dbClient, {
      userId,
      status: "active",
      mode: resolvedCapability.mode,
      counts: before,
      completed: true,
    });
    return {
      status: "active",
      semantic_status: before.semantic_status,
      selected: 0,
      embedded: 0,
      failed: 0,
    };
  }

  let embedded = 0;
  try {
    for (let index = 0; index < candidates.length; index += embedBatchSize) {
      const chunk = candidates.slice(index, index + embedBatchSize);
      const texts = chunk.map((row) => row.document.text);
      const vectors = await embeddingClient.embed(texts);
      // Upsert the whole chunk atomically in one batched round-trip (P3-3),
      // replacing the per-row autocommits.
      await store.upsertEmbeddings(chunk.map((row, vectorIndex) => ({
        uid: String(row.uid || ""),
        user_id: String(row.user_id || ""),
        account_id: String(row.account_id || ""),
        document: row.document,
        source_hash: row.source_hash,
        embedding: vectors[vectorIndex],
      })));
      embedded += chunk.length;
      await safeRecordCorpusEmbeddingUsage(recordUsage, userId, {
        dbClient,
        vectors,
        texts,
        embedded: chunk.length,
        batchSize: embedBatchSize,
      });
    }
  } catch (err) {
    const failedCounts = await getEmailSearchEmbeddingCoverageStatus(userId, {
      dbClient,
      capability: resolvedCapability,
    });
    const status = errorFields(err).status === 503 || errorClass(err) === "email_search_embeddings_unavailable"
      ? "unavailable"
      : "error";
    await upsertWorkerState(dbClient, {
      userId,
      status,
      mode: resolvedCapability.mode,
      counts: failedCounts,
      error: err,
      completed: true,
    });
    return {
      status,
      semantic_status: status,
      selected: candidates.length,
      embedded,
      failed: candidates.length - embedded,
      error_class: errorClass(err),
    };
  }

  const after = await getCoverageStatusFast(userId, {
    dbClient,
    capability: resolvedCapability,
  });
  await upsertWorkerState(dbClient, {
    userId,
    status: "active",
    mode: resolvedCapability.mode,
    counts: after,
    completed: true,
  });

  return {
    status: "active",
    semantic_status: after.semantic_status,
    selected: candidates.length,
    embedded,
    failed: 0,
  };
}

export async function processEmailSearchEmbeddingBatchesForAllUsers({
  dbClient = db,
  embeddingClient = createEmailSearchEmbeddingClient(),
  recordUsage = recordEmailSearchAiUsage,
  limit = DEFAULT_BATCH_LIMIT,
  batchSize = DEFAULT_EMBEDDING_BATCH_SIZE,
  capability = null,
}: BatchOptions = {}) {
  const result = await dbClient.execute(
    "SELECT DISTINCT user_id FROM ea_email_index ORDER BY user_id",
  );
  const users: Array<WorkerBatchResult & { user_id: string }> = [];
  for (const row of result.rows) {
    const userId = String(row.user_id || "");
    const batch = await processEmailSearchEmbeddingBatch(userId, {
      dbClient,
      limit,
      batchSize,
      capability,
      embeddingClient,
      recordUsage,
    });
    users.push({
      user_id: userId,
      status: batch.status,
      semantic_status: batch.semantic_status,
      selected: batch.selected,
      embedded: batch.embedded,
      failed: batch.failed,
      error_class: batch.error_class,
    });
  }
  return {
    processed: users.length > 0,
    users,
  };
}
