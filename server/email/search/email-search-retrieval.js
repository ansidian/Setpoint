import db from "../../db/connection.js";
import { createEmailSearchEmbeddingClient } from "./email-search-embedding-client.js";
import { resolveEmailSearchDateWindow } from "./email-search-date-window.js";
import {
  createEmailSearchEmbeddingStore,
  detectEmailSearchVectorCapability,
} from "./email-search-embedding-store.js";
import { getEmailSearchEmbeddingCoverageRatio } from "./email-search-embedding-worker.js";
import { filterEmailSearchCandidatesForEvidence } from "./email-search-evidence.js";
import { EMAIL_SEARCH_BM25_RANK_SQL, parseEmailSearchQuery, sanitizeFtsQuery } from "./email-search-query.js";
import { rankEmailSearchRows } from "./email-search-ranking.js";
import { recordEmailSearchAiUsage, estimateTokensFromText } from "./email-search-cost-stats.js";
import { EMAIL_SEARCH_EMBEDDING_MODEL } from "./email-search-embeddings.js";

const DEFAULT_LIMIT = 12;
const LEXICAL_FUSION_WEIGHT = 0.45;
const VECTOR_FUSION_WEIGHT = 0.55;
// Hard ceiling on the rankable pool the model can page through before it must
// narrow the query. Bounds tool-result/context cost while comfortably covering
// realistic "exhaust this set" cases (e.g. ~89 matches).
const MAX_RETRIEVAL_POOL = 200;
// The bm25-ordered fetch is blind to recency: on broad queries a brand-new match can
// sit past the fetch ceiling and never reach the re-ranker (prod: the newest "account"
// match sat at bm25 position 325). Union in the newest matches so recency-shaped
// queries always have them in the rankable pool.
const RECENT_MATCH_SLICE = 50;

const SNAPSHOT_JOIN = `
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
                  ORDER BY si.updated_at DESC, si.id DESC
                  LIMIT 1
                )`;

const RANKING_COLUMNS = `,
                triage.lane AS triage_lane,
                triage.category AS triage_category,
                triage.urgency AS triage_urgency,
                triage.deadline_at AS triage_deadline_at,
                triage.escalation_badge AS triage_escalation_badge,
                triage.bill_candidate_json AS triage_bill_candidate_json,
                triage.handled_at AS triage_handled_at,
                triage.provider_state AS triage_provider_state,
                triage.updated_at AS triage_updated_at,
                snap.lane_at_snapshot AS snapshot_lane,
                snap.category_at_snapshot AS snapshot_category,
                snap.urgency_at_snapshot AS snapshot_urgency,
                snap.deadline_at_snapshot AS snapshot_deadline_at,
                snap.escalation_badge_at_snapshot AS snapshot_escalation_badge,
                snap.dismissed_from_today_at AS snapshot_dismissed_from_today_at,
                snap.handled_at AS snapshot_handled_at,
                snap.provider_removed_at AS snapshot_provider_removed_at,
                snap.source_at AS snapshot_source_at,
                snap.resurfaced_at AS snapshot_resurfaced_at,
                snap.updated_at AS snapshot_updated_at`;

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, 50);
}

function clampOffset(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_RETRIEVAL_POOL - 1);
}

function bounded(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

// The lexical/quality component for fusion: scoreEmailSearchRow's output (a points total
// that can go negative under noise/provider_removed penalties) normalized into the fusion
// band [-1, 1]. Lexical and vector-only rows are both pre-scored, so both derive it the
// same way — keep this single source of truth so the two fusion branches can't drift.
function lexicalScoreFromRow(row) {
  return bounded(Number(row.search_score || 0) / 100, -1, 1);
}

function candidateDateMs(candidate) {
  const ms = Date.parse(candidate.email_date_utc || candidate.email_date || "");
  return Number.isFinite(ms) ? ms : 0;
}

function candidateFamilyKey(candidate) {
  const from = String(candidate.from?.address || "").toLowerCase().trim();
  const subject = String(candidate.subject || "").toLowerCase().trim();
  if (!from || !subject) return null;
  return `${from}|${subject}`;
}

function candidatePenalized(candidate) {
  return candidate.metadata?.lane === "noise" || Boolean(candidate.metadata?.provider_removed);
}

// Fused-level mirror of applyFamilyRecencyDominance (email-search-ranking.js): the
// per-pool clamp cannot see a recurring family whose siblings arrive via different
// retrieval legs (newest lexical-only, older vector-only), and vector-similarity
// epsilon between near-identical recurring bodies would re-split an exact score tie
// before the date tiebreak fires. Clamping the fused score keeps families newest-first
// regardless of which leg surfaced each sibling.
function applyFamilyDominanceToCandidates(candidates) {
  const families = new Map();
  for (const candidate of candidates) {
    const key = candidateFamilyKey(candidate);
    if (!key) continue;
    const members = families.get(key);
    if (members) members.push(candidate);
    else families.set(key, [candidate]);
  }
  for (const members of families.values()) {
    if (members.length < 2) continue;
    const newest = members.reduce((best, candidate) => (
      candidateDateMs(candidate) > candidateDateMs(best) ? candidate : best
    ));
    if (candidatePenalized(newest) || newest.scores.combined < 0) continue;
    for (const candidate of members) {
      if (candidate === newest || candidate.scores.combined <= newest.scores.combined) continue;
      candidate.scores.combined = newest.scores.combined;
    }
  }
  return candidates;
}

function readFilterFromPlan(plan) {
  if (plan?.read_filter === "read") return 1;
  if (plan?.read_filter === "unread") return 0;
  return null;
}

function buildPlanFilters(plan, readFilter, alias = "idx") {
  const filters = [];
  const args = [];
  if (readFilter != null) {
    filters.push(`${alias}.read = ?`);
    args.push(readFilter);
  }
  // Rows with an unparseable/missing Date header have an empty (or NULL) email_date_utc
  // — the column is NOT NULL DEFAULT ''. Let them PASS the window rather than be silently
  // dropped (P3-51); email_date holds the raw header string, so COALESCE-ing to it would
  // be unsound. Test the raw column directly: NULLIF(x,'') is NULL when x is empty, so a
  // NULLIF-based "= ''" guard can never match.
  if (plan?.date_window?.after) {
    filters.push(`(${alias}.email_date_utc IS NULL OR ${alias}.email_date_utc = '' OR ${alias}.email_date_utc >= ?)`);
    args.push(plan.date_window.after);
  }
  if (plan?.date_window?.before) {
    filters.push(`(${alias}.email_date_utc IS NULL OR ${alias}.email_date_utc = '' OR ${alias}.email_date_utc <= ?)`);
    args.push(plan.date_window.before);
  }
  return {
    sql: filters.length ? ` AND ${filters.join(" AND ")}` : "",
    args,
  };
}

function metadataFromRow(row) {
  return {
    lane: row.snapshot_lane || row.triage_lane || "untriaged",
    category: row.snapshot_category || row.triage_category || "uncategorized",
    urgency: row.snapshot_urgency || row.triage_urgency || "normal",
    deadline_at: row.snapshot_deadline_at || row.triage_deadline_at || null,
    escalation_badge: row.snapshot_escalation_badge || row.triage_escalation_badge || null,
    handled: Boolean(row.snapshot_handled_at || row.triage_handled_at),
    provider_removed: Boolean(row.snapshot_provider_removed_at),
  };
}

function candidateFromRow(row) {
  return {
    uid: row.uid,
    subject: row.subject,
    body_snippet: row.body_snippet,
    body_excerpt: String(row.body_text || "").slice(0, 1200),
    email_date: row.email_date,
    email_date_utc: row.email_date_utc || null,
    read: !!row.read,
    from: {
      name: row.from_name,
      address: row.from_address,
    },
    account: {
      id: row.account_id,
      label: row.account_label,
      email: row.account_email,
      color: row.account_color,
      icon: row.account_icon,
    },
    metadata: metadataFromRow(row),
  };
}

async function loadLexicalRows(dbClient, userId, { textQuery, readFilter, plan, limit, now = Date.now() }) {
  const fetchLimit = Math.min(Math.max(limit * 8, 100), 500);
  const filters = buildPlanFilters(plan, readFilter);
  if (textQuery.trim()) {
    // `matched` is bounded twice — best-by-bm25 plus newest-by-date — then the snapshot
    // join runs against that bounded union only. The final SELECT aliases the union back
    // to `idx` so SNAPSHOT_JOIN/RANKING_COLUMNS apply verbatim.
    const result = await dbClient.execute({
      sql: `WITH matched AS (
              SELECT
                idx.uid, idx.user_id, idx.account_id, idx.account_label, idx.account_email,
                idx.account_color, idx.account_icon,
                idx.from_name, idx.from_address, idx.subject, idx.body_snippet, idx.body_text,
                idx.email_date, idx.email_date_utc, idx.read,
                ${EMAIL_SEARCH_BM25_RANK_SQL} AS rank
              FROM ea_email_fts
              JOIN ea_email_index idx ON idx.uid = ea_email_fts.uid
              WHERE ea_email_fts MATCH ? AND idx.user_id = ?${filters.sql}
            ),
            bounded AS (
              SELECT * FROM (SELECT * FROM matched ORDER BY rank, email_date_utc DESC LIMIT ?)
              UNION
              SELECT * FROM (SELECT * FROM matched ORDER BY email_date_utc DESC, rank LIMIT ?)
            )
            SELECT
              idx.*
              ${RANKING_COLUMNS}
            FROM bounded idx
            ${SNAPSHOT_JOIN}
            ORDER BY idx.rank, idx.email_date_utc DESC`,
      args: [sanitizeFtsQuery(textQuery), userId, ...filters.args, fetchLimit, RECENT_MATCH_SLICE],
    });
    return rankEmailSearchRows(result.rows, {
      query: textQuery,
      limit: fetchLimit,
      now,
      debug: true,
    });
  }

  const result = await dbClient.execute({
    sql: `SELECT
            idx.uid, idx.account_id, idx.account_label, idx.account_email,
            idx.account_color, idx.account_icon,
            idx.from_name, idx.from_address, idx.subject, idx.body_snippet, idx.body_text,
            idx.email_date, idx.email_date_utc, idx.read,
            0 AS rank
            ${RANKING_COLUMNS}
          FROM ea_email_index idx
          ${SNAPSHOT_JOIN}
          WHERE idx.user_id = ?${filters.sql}
          ORDER BY idx.email_date_utc DESC, idx.email_date DESC
          LIMIT ?`,
    args: [userId, ...filters.args, fetchLimit],
  });
  return rankEmailSearchRows(result.rows, {
    query: textQuery,
    limit: fetchLimit,
    now,
    debug: true,
  });
}

async function loadRowsByUid(dbClient, userId, uids, { readFilter, plan }) {
  if (!uids.length) return [];
  const filters = buildPlanFilters(plan, readFilter);
  const result = await dbClient.execute({
    sql: `SELECT
            idx.uid, idx.account_id, idx.account_label, idx.account_email,
            idx.account_color, idx.account_icon,
            idx.from_name, idx.from_address, idx.subject, idx.body_snippet, idx.body_text,
            idx.email_date, idx.email_date_utc, idx.read,
            0 AS rank
            ${RANKING_COLUMNS}
          FROM ea_email_index idx
          ${SNAPSHOT_JOIN}
          WHERE idx.user_id = ?
            AND idx.uid IN (${uids.map(() => "?").join(",")})${filters.sql}
          ORDER BY idx.email_date_utc DESC, idx.email_date DESC`,
    args: [userId, ...uids, ...filters.args],
  });
  return result.rows;
}

// Fusion is coverage-aware: the vector coefficient is scaled by the fraction of the
// corpus that is actually embedded. At coverage 1.0 this is exactly the prior formula
// (so the vector signal is not flattened on a fully-embedded corpus). The scaling is
// continuous and linear, so a near-complete inbox (a few in-flight embeds) is
// down-weighted only negligibly, while genuinely partial coverage (dev freeze, prod
// backfill/outage lag) shrinks the vector term toward lexical so a fresh strong-lexical
// email is no longer structurally displaced by a stale embedded one. Lexical
// coefficients are deliberately untouched.
export function mergeCandidates({ lexicalRows, vectorMatches, vectorRows, limit, coverageRatio = 1 }) {
  const coverageFactor = bounded(coverageRatio, 0, 1);
  const effectiveVectorWeight = VECTOR_FUSION_WEIGHT * coverageFactor;
  const byUid = new Map();
  const vectorScoreByUid = new Map(vectorMatches.map((match) => [match.uid, bounded(match.similarity)]));

  for (const row of lexicalRows) {
    const lexicalScore = lexicalScoreFromRow(row);
    byUid.set(row.uid, {
      ...candidateFromRow(row),
      provenance: { lexical: true, vector: false },
      scores: {
        lexical: lexicalScore,
        vector: 0,
        combined: lexicalScore,
      },
    });
  }

  for (const row of vectorRows) {
    const existing = byUid.get(row.uid);
    const vectorScore = vectorScoreByUid.get(row.uid) || 0;
    if (existing) {
      existing.provenance.vector = true;
      existing.scores.vector = vectorScore;
      existing.scores.combined = bounded((existing.scores.lexical * LEXICAL_FUSION_WEIGHT) + (vectorScore * effectiveVectorWeight), -1, 1);
      continue;
    }
    // Vector-only rows are pre-scored through scoreEmailSearchRow (via rankEmailSearchRows
    // in the retrieval layer), so their search_score carries the same quality/recency
    // penalties as lexical rows — noise lane, provider_removed, dismissed, stale recency.
    // Fuse that quality component with the vector term so a high-similarity noise/removed
    // email can no longer surface as a top vector-only candidate unpenalized. provenance
    // stays vector-only (it did not match FTS); only the ranking score changes.
    const lexicalScore = lexicalScoreFromRow(row);
    byUid.set(row.uid, {
      ...candidateFromRow(row),
      provenance: { lexical: false, vector: true },
      scores: {
        lexical: lexicalScore,
        vector: vectorScore,
        combined: bounded((lexicalScore * LEXICAL_FUSION_WEIGHT) + (vectorScore * effectiveVectorWeight), -1, 1),
      },
    });
  }

  return applyFamilyDominanceToCandidates([...byUid.values()])
    .sort((a, b) => {
      if (b.scores.combined !== a.scores.combined) return b.scores.combined - a.scores.combined;
      // Recency breaks fused-score ties (recurring twins often tie exactly) so the
      // newest copy wins; uid only stabilizes genuinely identical rows.
      const dateDiff = candidateDateMs(b) - candidateDateMs(a);
      if (dateDiff) return dateDiff;
      return String(a.uid).localeCompare(String(b.uid));
    })
    .slice(0, limit);
}

// Resolve the embedding coverage factor for fusion. Any failure or "nothing indexed"
// defaults to full trust (1) so the coverage-aware down-weighting only ever activates
// when coverage is positively measured low — the default path stays today's behavior.
async function resolveEmbeddingCoverage(userId, dbClient) {
  try {
    const ratio = await getEmailSearchEmbeddingCoverageRatio(userId, { dbClient });
    return ratio == null ? 1 : bounded(ratio, 0, 1);
  } catch {
    return 1;
  }
}

export async function retrieveInboxAiSearch(userId, {
  q,
  limit = DEFAULT_LIMIT,
  offset = 0,
  dbClient = db,
  embeddingClient = createEmailSearchEmbeddingClient(),
  recordUsage = recordEmailSearchAiUsage,
  capability = null,
  coverageRatio = null,
  plan = null,
  now = Date.now(),
} = {}) {
  const maxResults = clampLimit(limit);
  const start = clampOffset(offset);
  const { textQuery: rawTextQuery, readFilter: explicitReadFilter } = parseEmailSearchQuery(q);
  const dateWindow = resolveEmailSearchDateWindow(q, plan?.date_window, { now });
  const effectivePlan = plan || dateWindow ? {
    ...(plan || {}),
    date_window: dateWindow,
  } : null;
  const planReadFilter = readFilterFromPlan(plan);
  const readFilter = explicitReadFilter == null ? planReadFilter : explicitReadFilter;
  const textQuery = plan?.lexical_queries?.[0] || plan?.semantic_query || rawTextQuery;
  const vectorQuery = plan?.semantic_query || rawTextQuery;
  const resolvedCapability = capability || await detectEmailSearchVectorCapability(dbClient);
  // Sizing is INDEPENDENT of offset so `total`/`has_more`/`capped` and the page
  // ordering stay stable across paged calls of the same query. Fetch sizes match the
  // pre-pagination defaults (a default offset-0 call returns the same top rows); only
  // the merged-pool cap is widened to MAX_RETRIEVAL_POOL so the model can page through
  // one ranked list instead of re-sampling the top.
  const lexicalFetchLimit = Math.min(Math.max(maxResults * 8, 100), 500);
  const vectorLimit = effectivePlan?.date_window?.after || effectivePlan?.date_window?.before
    ? 100
    : Math.max(maxResults * 2, 20);
  const candidatePoolLimit = MAX_RETRIEVAL_POOL;

  const lexicalPromise = loadLexicalRows(dbClient, userId, {
    textQuery,
    readFilter,
    plan: effectivePlan,
    limit: maxResults,
    now,
  });
  const vectorPromise = (async () => {
    if (!vectorQuery.trim()) return { status: "skipped", matches: [] };
    try {
      const [queryEmbedding] = await embeddingClient.embed([vectorQuery]);
      // Cost visibility (email/search area rule): every embedding API call reports
      // through email-search-cost-stats. Fire-and-forget — a recording failure must
      // never break search. Alfred is the planner now, so this is the only live
      // per-query model cost in the search path.
      recordUsage(userId, {
        dbClient,
        eventType: "query_embedding",
        model: EMAIL_SEARCH_EMBEDDING_MODEL,
        usage: { input_tokens: estimateTokensFromText(vectorQuery) },
        estimated: true,
      }).catch(() => {});
      const store = createEmailSearchEmbeddingStore(dbClient, resolvedCapability);
      const matches = await store.querySimilarEmbeddings(userId, queryEmbedding, {
        limit: vectorLimit,
        readFilter,
        dateWindow: effectivePlan?.date_window,
      });
      return { status: "ok", matches };
    } catch (err) {
      const unavailable = err?.status === 503 || err?.code === "email_search_embeddings_unavailable";
      return {
        status: unavailable ? "unavailable" : "error",
        matches: [],
        error_class: err?.code || err?.name || "email_search_vector_error",
      };
    }
  })();

  // Coverage depends only on userId/dbClient, so resolve it alongside lexical/vector
  // rather than as an extra serial round-trip on the hot path.
  const coveragePromise = coverageRatio != null
    ? Promise.resolve(bounded(coverageRatio, 0, 1))
    : resolveEmbeddingCoverage(userId, dbClient);
  const [lexicalRows, vector, resolvedCoverage] = await Promise.all([lexicalPromise, vectorPromise, coveragePromise]);
  const vectorRows = await loadRowsByUid(dbClient, userId, vector.matches.map((match) => match.uid), { readFilter, plan: effectivePlan });
  // Pre-score the vector rows through the SAME ranking pass as the lexical rows so the
  // lexical/quality component (noise/provider_removed penalties, recency) is computed
  // uniformly for every candidate. mergeCandidates then fuses search_score with the
  // vector term for vector-only rows instead of treating them as quality-neutral. limit
  // is the row count so ranking only scores+attaches; the merged pool does the ordering.
  const scoredVectorRows = rankEmailSearchRows(vectorRows, {
    query: textQuery,
    limit: vectorRows.length,
    now,
    debug: true,
  });
  const candidatePool = mergeCandidates({
    lexicalRows,
    vectorMatches: vector.matches,
    vectorRows: scoredVectorRows,
    limit: candidatePoolLimit,
    coverageRatio: resolvedCoverage,
  });
  const filtered = filterEmailSearchCandidatesForEvidence(candidatePool, { q, plan: effectivePlan });
  // `total` is the retrievable count for this query within the rankable pool (stable
  // across pages because sizing is offset-independent). `candidates` is the requested page.
  const total = filtered.length;
  const candidates = filtered.slice(start, start + maxResults);
  // The result set exceeds what we ranked here (FTS keyword matches hit the fetch
  // ceiling, or the merged pool filled MAX_RETRIEVAL_POOL): `total` is then a lower
  // bound and the model should narrow rather than assume it has seen everything.
  const capped = lexicalRows.length >= lexicalFetchLimit || candidatePool.length >= MAX_RETRIEVAL_POOL;

  return {
    mode: vector.status === "ok" && vector.matches.length ? "hybrid" : "lexical",
    query: q,
    parsed_query: {
      text: textQuery,
      read_filter: readFilter,
      date_window: effectivePlan?.date_window || null,
      planned: !!plan,
    },
    lexical: {
      status: "ok",
      count: lexicalRows.length,
    },
    vector: {
      status: vector.status,
      count: vector.matches.length,
      error_class: vector.error_class,
    },
    total,
    offset: start,
    has_more: start + maxResults < total,
    capped,
    candidates,
  };
}
