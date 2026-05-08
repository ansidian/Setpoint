import {
  EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
  EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
  EMAIL_SEARCH_EMBEDDING_MODEL,
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.js";

function vectorToJson(vector) {
  return JSON.stringify(Array.from(vector || [], Number));
}

function vectorToBuffer(vector) {
  return Buffer.from(new Float32Array(vector || []).buffer);
}

function bufferToVector(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const bytes = buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
    ? buffer.buffer
    : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return Array.from(new Float32Array(bytes));
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    aMag += a[index] * a[index];
    bMag += b[index] * b[index];
  }
  if (!aMag || !bMag) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function rowToEmbeddingCandidate(row) {
  const document = buildEmailSearchEmbeddingDocument(row);
  return {
    ...row,
    document,
    source_hash: computeEmailSearchEmbeddingSourceHash(document),
  };
}

export async function detectEmailSearchVectorCapability(db) {
  try {
    await db.execute("SELECT vector_distance_cos(vector32('[1,0]'), vector32('[1,0]')) AS distance");
    return { mode: "native", native: true };
  } catch (err) {
    return {
      mode: "fallback",
      native: false,
      reason: err?.message || "Vector functions unavailable",
    };
  }
}

export function createEmailSearchEmbeddingStore(db, capability = { mode: "fallback" }) {
  const mode = capability?.mode === "native" ? "native" : "fallback";

  async function upsertEmbedding({
    uid,
    user_id,
    account_id,
    document,
    source_hash,
    embedding,
    model = EMAIL_SEARCH_EMBEDDING_MODEL,
    dimensions = EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
    document_version = EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
  }) {
    const embeddingValue = mode === "native" ? vectorToJson(embedding) : vectorToBuffer(embedding);
    await db.execute({
      sql: `INSERT INTO ea_email_search_embeddings
              (uid, user_id, account_id, document_text, document_json, source_hash,
               document_version, embedding_model, embedding_dimensions, embedding)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${mode === "native" ? "vector32(?)" : "?"})
            ON CONFLICT(uid) DO UPDATE SET
              user_id = excluded.user_id,
              account_id = excluded.account_id,
              document_text = excluded.document_text,
              document_json = excluded.document_json,
              source_hash = excluded.source_hash,
              document_version = excluded.document_version,
              embedding_model = excluded.embedding_model,
              embedding_dimensions = excluded.embedding_dimensions,
              embedding = excluded.embedding,
              updated_at = datetime('now')`,
      args: [
        uid,
        user_id,
        account_id,
        document.text,
        JSON.stringify(document),
        source_hash,
        document_version,
        model,
        dimensions,
        embeddingValue,
      ],
    });
  }

  async function listRowsNeedingEmbeddings(userId, { limit = 50, scanLimit = 500 } = {}) {
    const maxResults = Math.min(parseInt(limit, 10) || 50, 500);
    const maxScan = Math.max(maxResults, Math.min(parseInt(scanLimit, 10) || 500, 5000));
    const result = await db.execute({
      sql: `SELECT idx.uid, idx.user_id, idx.account_id, idx.account_label, idx.account_email,
                   idx.account_color, idx.account_icon, idx.from_name, idx.from_address,
                   idx.subject, idx.body_snippet, idx.body_text, idx.email_date, idx.read,
                   emb.source_hash AS existing_source_hash,
                   emb.document_version AS existing_document_version,
                   emb.embedding_model AS existing_embedding_model,
                   emb.embedding_dimensions AS existing_embedding_dimensions,
                   triage.lane AS triage_lane,
                   triage.urgency AS triage_urgency,
                   snap.id AS active_snapshot_item_id
            FROM ea_email_index idx
            LEFT JOIN ea_email_search_embeddings emb ON emb.uid = idx.uid
            LEFT JOIN ea_email_triage triage
              ON triage.user_id = idx.user_id
             AND triage.account_id = idx.account_id
             AND triage.email_id = idx.uid
            LEFT JOIN ea_briefing_snapshot_items snap
              ON snap.id = (
                SELECT si.id
                FROM ea_briefing_snapshot_items si
                JOIN ea_briefing_snapshots s ON s.id = si.snapshot_id
                WHERE si.user_id = idx.user_id
                  AND si.account_id = idx.account_id
                  AND si.email_id = idx.uid
                  AND s.status = 'active'
                  AND si.provider_removed_at IS NULL
                ORDER BY si.updated_at DESC, si.id DESC
                LIMIT 1
              )
            WHERE idx.user_id = ?
            ORDER BY
              CASE
                WHEN emb.uid IS NULL THEN 0
                WHEN emb.document_version != ? THEN 0
                WHEN emb.embedding_model != ? THEN 0
                WHEN emb.embedding_dimensions != ? THEN 0
                ELSE 1
              END ASC,
              CASE
                WHEN snap.id IS NOT NULL THEN 0
                WHEN triage.lane IN ('needs_attention', 'action') THEN 1
                WHEN triage.urgency = 'high' THEN 2
                ELSE 3
              END ASC,
              idx.email_date DESC
            LIMIT ?`,
      args: [
        userId,
        EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
        EMAIL_SEARCH_EMBEDDING_MODEL,
        EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
        maxScan,
      ],
    });

    return result.rows
      .map(rowToEmbeddingCandidate)
      .filter((row) => row.existing_source_hash !== row.source_hash
        || row.existing_document_version !== EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION
        || row.existing_embedding_model !== EMAIL_SEARCH_EMBEDDING_MODEL
        || row.existing_embedding_dimensions !== EMAIL_SEARCH_EMBEDDING_DIMENSIONS)
      .slice(0, maxResults);
  }

  async function querySimilarEmbeddings(userId, queryEmbedding, { limit = 20 } = {}) {
    const maxResults = Math.min(parseInt(limit, 10) || 20, 100);
    if (mode === "native") {
      const result = await db.execute({
        sql: `SELECT uid, user_id, account_id, document_text, document_json, source_hash,
                     vector_distance_cos(embedding, vector32(?)) AS distance
              FROM ea_email_search_embeddings
              WHERE user_id = ?
                AND document_version = ?
                AND embedding_model = ?
                AND embedding_dimensions = ?
              ORDER BY distance ASC
              LIMIT ?`,
        args: [
          vectorToJson(queryEmbedding),
          userId,
          EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
          EMAIL_SEARCH_EMBEDDING_MODEL,
          EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
          maxResults,
        ],
      });
      return result.rows.map((row) => ({
        uid: row.uid,
        user_id: row.user_id,
        account_id: row.account_id,
        document: JSON.parse(row.document_json),
        source_hash: row.source_hash,
        distance: Number(row.distance),
        similarity: 1 - Number(row.distance),
      }));
    }

    const result = await db.execute({
      sql: `SELECT uid, user_id, account_id, document_json, source_hash, embedding
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

    return result.rows
      .map((row) => {
        const similarity = cosineSimilarity(queryEmbedding, bufferToVector(row.embedding));
        return {
          uid: row.uid,
          user_id: row.user_id,
          account_id: row.account_id,
          document: JSON.parse(row.document_json),
          source_hash: row.source_hash,
          similarity,
          distance: 1 - similarity,
        };
      })
      .sort((a, b) => {
        if (b.similarity !== a.similarity) return b.similarity - a.similarity;
        return String(a.uid).localeCompare(String(b.uid));
      })
      .slice(0, maxResults);
  }

  return {
    mode,
    upsertEmbedding,
    listRowsNeedingEmbeddings,
    querySimilarEmbeddings,
  };
}
