import db from "../../db/connection.js";
import {
  estimateTokensFromText,
  recordEmailSearchAiUsage,
} from "./email-search-cost-stats.js";
import { createEmailSearchEmbeddingClient } from "./email-search-embedding-client.js";
import {
  createEmailSearchEmbeddingStore,
  detectEmailSearchVectorCapability,
} from "./email-search-embedding-store.js";
import {
  EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
  EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
  EMAIL_SEARCH_EMBEDDING_MODEL,
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.js";

const DEFAULT_BATCH_LIMIT = 25;
const DEFAULT_EMBEDDING_BATCH_SIZE = 16;
const CORPUS_EMBEDDING_EVENT_TYPE = "corpus_embedding";

function clampPositiveInteger(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function errorClass(err) {
  return err?.code || err?.name || "email_search_embedding_worker_error";
}

function usageTokensFromEmbeddingResponse(vectors, texts) {
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

async function safeRecordCorpusEmbeddingUsage(recordUsage, userId, {
  dbClient,
  vectors,
  texts,
  embedded,
  batchSize,
}) {
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
    console.warn("[EA] Failed to record email search corpus embedding usage:", err.message);
  }
}

function semanticStatus({ total, stale, missing, stateStatus, mode }) {
  if (stateStatus === "unavailable") return "unavailable";
  if (mode === "native" && total > 0 && stale === 0 && missing === 0) return "active";
  if (total > 0 && stale === 0 && missing === 0) return "active";
  if (total > 0) return mode === "fallback" ? "local_fallback" : "warming";
  return mode === "fallback" ? "local_fallback" : "warming";
}

async function upsertWorkerState(dbClient, {
  userId,
  status,
  mode,
  counts = {},
  error = null,
  started = false,
  completed = false,
}) {
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

async function loadIndexedRowsForCoverage(dbClient, userId) {
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
  return result.rows;
}

function summarizeCoverage(rows) {
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

async function loadWorkerState(dbClient, userId) {
  const result = await dbClient.execute({
    sql: `SELECT status, mode, last_error_class, last_error, attempts,
                 last_started_at, last_completed_at, updated_at
          FROM ea_email_search_embedding_state
          WHERE user_id = ?`,
    args: [userId],
  });
  return result.rows[0] || null;
}

export async function getEmailSearchEmbeddingCoverageStatus(userId, {
  dbClient = db,
  capability = null,
} = {}) {
  const [rows, state] = await Promise.all([
    loadIndexedRowsForCoverage(dbClient, userId),
    loadWorkerState(dbClient, userId),
  ]);
  const counts = summarizeCoverage(rows);
  const mode = capability?.mode || state?.mode || "fallback";

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

export async function processEmailSearchEmbeddingBatch(userId, {
  dbClient = db,
  embeddingClient = createEmailSearchEmbeddingClient(),
  capability = null,
  limit = DEFAULT_BATCH_LIMIT,
  batchSize = DEFAULT_EMBEDDING_BATCH_SIZE,
  recordUsage = recordEmailSearchAiUsage,
} = {}) {
  const resolvedCapability = capability || await detectEmailSearchVectorCapability(dbClient);
  const store = createEmailSearchEmbeddingStore(dbClient, resolvedCapability);
  const maxRows = clampPositiveInteger(limit, DEFAULT_BATCH_LIMIT, 100);
  const embedBatchSize = clampPositiveInteger(batchSize, DEFAULT_EMBEDDING_BATCH_SIZE, 100);
  const before = await getEmailSearchEmbeddingCoverageStatus(userId, {
    dbClient,
    capability: resolvedCapability,
  });
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
      for (let vectorIndex = 0; vectorIndex < chunk.length; vectorIndex += 1) {
        const row = chunk[vectorIndex];
        await store.upsertEmbedding({
          uid: row.uid,
          user_id: row.user_id,
          account_id: row.account_id,
          document: row.document,
          source_hash: row.source_hash,
          embedding: vectors[vectorIndex],
        });
        embedded++;
      }
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
    const status = err?.status === 503 || errorClass(err) === "email_search_embeddings_unavailable"
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

  const after = await getEmailSearchEmbeddingCoverageStatus(userId, {
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
} = {}) {
  const result = await dbClient.execute(
    "SELECT DISTINCT user_id FROM ea_email_index ORDER BY user_id",
  );
  const users = [];
  for (const row of result.rows) {
    const batch = await processEmailSearchEmbeddingBatch(row.user_id, {
      dbClient,
      limit,
      batchSize,
      capability,
      embeddingClient,
      recordUsage,
    });
    users.push({
      user_id: row.user_id,
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
