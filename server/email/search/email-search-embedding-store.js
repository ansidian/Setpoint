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

function buildEmbeddingQueryFilters({ readFilter = null, dateWindow = null } = {}) {
  const filters = [];
  const args = [];
  if (readFilter != null) {
    filters.push("idx.read = ?");
    args.push(readFilter);
  }
  // P3-51: rows with an unparseable/missing Date header have an empty/NULL email_date_utc
  // (NOT NULL DEFAULT ''); let them PASS the window rather than be silently dropped, matching
  // buildPlanFilters in email-search-retrieval.js so the plan and embedding paths agree.
  if (dateWindow?.after) {
    filters.push("(idx.email_date_utc IS NULL OR idx.email_date_utc = '' OR idx.email_date_utc >= ?)");
    args.push(dateWindow.after);
  }
  if (dateWindow?.before) {
    filters.push("(idx.email_date_utc IS NULL OR idx.email_date_utc = '' OR idx.email_date_utc <= ?)");
    args.push(dateWindow.before);
  }
  return {
    sql: filters.length ? ` AND ${filters.join(" AND ")}` : "",
    args,
  };
}

// Vector capability is fixed for a given connection's lifetime, but was probed
// with a DB round-trip on every search and every worker batch. Memoize the
// in-flight/resolved probe per db connection. The probe never rejects (errors
// resolve to a fallback verdict), so the cached promise is safe to keep. Keyed
// by the db object so the production singleton probes once while test mock-dbs
// (fresh objects) each resolve independently.
const vectorCapabilityCache = new WeakMap();

export function detectEmailSearchVectorCapability(db) {
  const cached = vectorCapabilityCache.get(db);
  if (cached) return cached;
  const probe = (async () => {
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
  })();
  vectorCapabilityCache.set(db, probe);
  return probe;
}

export function createEmailSearchEmbeddingStore(db, capability = { mode: "fallback" }) {
  const mode = capability?.mode === "native" ? "native" : "fallback";

  function buildUpsertEmbeddingStatement({
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
    return {
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
    };
  }

  async function upsertEmbedding(fields) {
    await db.execute(buildUpsertEmbeddingStatement(fields));
  }

  // Atomically upsert a whole chunk in one round-trip (P3-3). db.batch wraps the
  // statements in an implicit transaction on the store's connection, so a chunk
  // either fully lands or not at all — replacing N per-row autocommits.
  async function upsertEmbeddings(rows) {
    if (!rows.length) return;
    await db.batch(rows.map(buildUpsertEmbeddingStatement));
  }

  async function listRowsNeedingEmbeddings(userId, { limit = 50, scanLimit = 500 } = {}) {
    const maxResults = Math.min(parseInt(limit, 10) || 50, 500);
    const maxScan = Math.max(maxResults, Math.min(parseInt(scanLimit, 10) || 500, 5000));
    const result = await db.execute({
      sql: `SELECT idx.uid, idx.user_id, idx.account_id, idx.account_label, idx.account_email,
                   idx.account_color, idx.account_icon, idx.from_name, idx.from_address,
                   idx.subject, idx.body_snippet, idx.body_text, idx.email_date, idx.email_date_utc, idx.read,
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
              idx.email_date_utc DESC, idx.email_date DESC
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

  async function querySimilarEmbeddings(userId, queryEmbedding, {
    limit = 20,
    readFilter = null,
    dateWindow = null,
  } = {}) {
    const maxResults = Math.min(parseInt(limit, 10) || 20, 100);
    const filters = buildEmbeddingQueryFilters({ readFilter, dateWindow });
    if (mode === "native") {
      const result = await db.execute({
        // Project only the columns consumers read: uid (+ identity/source_hash)
        // and the cosine distance. The email-body blobs (document_text/document_json)
        // are never read off this result — email-search-retrieval.js loads bodies by
        // uid separately — so they stay out of the projection.
        sql: `SELECT emb.uid, emb.user_id, emb.account_id,
                     emb.source_hash,
                     vector_distance_cos(emb.embedding, vector32(?)) AS distance
              FROM ea_email_search_embeddings emb
              JOIN ea_email_index idx
                ON idx.uid = emb.uid
               AND idx.user_id = emb.user_id
              WHERE emb.user_id = ?
                AND emb.document_version = ?
                AND emb.embedding_model = ?
                AND emb.embedding_dimensions = ?${filters.sql}
              ORDER BY distance ASC
              LIMIT ?`,
        args: [
          vectorToJson(queryEmbedding),
          userId,
          EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
          EMAIL_SEARCH_EMBEDDING_MODEL,
          EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
          ...filters.args,
          maxResults,
        ],
      });
      return result.rows.map((row) => ({
        uid: row.uid,
        user_id: row.user_id,
        account_id: row.account_id,
        source_hash: row.source_hash,
        distance: Number(row.distance),
        similarity: 1 - Number(row.distance),
      }));
    }

    // P3-41: the fallback (dev/local SQLite) path scores cosine similarity in JS,
    // so it cannot rank in SQL — but it previously loaded the entire embedding
    // corpus into Node. Bound the transfer to the most-recent candidates
    // (maxResults * 4, capped at 1000) before JS re-ranking. Production uses the
    // native vector path and is unaffected.
    const fallbackScanLimit = Math.min(maxResults * 4, 1000);
    const result = await db.execute({
      sql: `SELECT emb.uid, emb.user_id, emb.account_id,
                   emb.source_hash, emb.embedding
            FROM ea_email_search_embeddings emb
            JOIN ea_email_index idx
              ON idx.uid = emb.uid
             AND idx.user_id = emb.user_id
            WHERE emb.user_id = ?
              AND emb.document_version = ?
              AND emb.embedding_model = ?
              AND emb.embedding_dimensions = ?${filters.sql}
            ORDER BY idx.email_date_utc DESC, idx.email_date DESC
            LIMIT ?`,
      args: [
        userId,
        EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
        EMAIL_SEARCH_EMBEDDING_MODEL,
        EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
        ...filters.args,
        fallbackScanLimit,
      ],
    });

    return result.rows
      .map((row) => {
        const similarity = cosineSimilarity(queryEmbedding, bufferToVector(row.embedding));
        return {
          uid: row.uid,
          user_id: row.user_id,
          account_id: row.account_id,
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
    upsertEmbeddings,
    listRowsNeedingEmbeddings,
    querySimilarEmbeddings,
  };
}
