import db from "../../db/connection.js";
import { createEmailSearchEmbeddingClient } from "./email-search-embedding-client.js";
import { resolveEmailSearchDateWindow } from "./email-search-date-window.js";
import {
  createEmailSearchEmbeddingStore,
  detectEmailSearchVectorCapability,
} from "./email-search-embedding-store.js";
import { filterEmailSearchCandidatesForEvidence } from "./email-search-evidence.js";
import { parseEmailSearchQuery, sanitizeFtsQuery } from "./email-search-query.js";
import { rankEmailSearchRows } from "./email-search-ranking.js";

const DEFAULT_LIMIT = 12;

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

function bounded(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
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
  if (plan?.date_window?.after) {
    filters.push(`NULLIF(${alias}.email_date_utc, '') >= ?`);
    args.push(plan.date_window.after);
  }
  if (plan?.date_window?.before) {
    filters.push(`NULLIF(${alias}.email_date_utc, '') <= ?`);
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

async function loadLexicalRows(dbClient, userId, { textQuery, readFilter, plan, limit }) {
  const fetchLimit = Math.min(Math.max(limit * 8, 100), 500);
  const filters = buildPlanFilters(plan, readFilter);
  if (textQuery.trim()) {
    const result = await dbClient.execute({
      sql: `SELECT
              idx.uid, idx.account_id, idx.account_label, idx.account_email,
              idx.account_color, idx.account_icon,
              idx.from_name, idx.from_address, idx.subject, idx.body_snippet, idx.body_text,
              idx.email_date, idx.email_date_utc, idx.read,
              rank
              ${RANKING_COLUMNS}
            FROM ea_email_fts
            JOIN ea_email_index idx ON idx.uid = ea_email_fts.uid
            ${SNAPSHOT_JOIN}
            WHERE ea_email_fts MATCH ? AND idx.user_id = ?${filters.sql}
            ORDER BY rank
            LIMIT ?`,
      args: [sanitizeFtsQuery(textQuery), userId, ...filters.args, fetchLimit],
    });
    return rankEmailSearchRows(result.rows, {
      query: textQuery,
      limit: fetchLimit,
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

function mergeCandidates({ lexicalRows, vectorMatches, vectorRows, limit }) {
  const byUid = new Map();
  const vectorScoreByUid = new Map(vectorMatches.map((match) => [match.uid, bounded(match.similarity)]));

  for (const row of lexicalRows) {
    const lexicalScore = bounded(Number(row.search_score || 0) / 100, -1, 1);
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
      existing.scores.combined = bounded((existing.scores.lexical * 0.45) + (vectorScore * 0.55), -1, 1);
      continue;
    }
    byUid.set(row.uid, {
      ...candidateFromRow(row),
      provenance: { lexical: false, vector: true },
      scores: {
        lexical: 0,
        vector: vectorScore,
        combined: bounded(vectorScore * 0.55, -1, 1),
      },
    });
  }

  return [...byUid.values()]
    .sort((a, b) => {
      if (b.scores.combined !== a.scores.combined) return b.scores.combined - a.scores.combined;
      return String(a.uid).localeCompare(String(b.uid));
    })
    .slice(0, limit);
}

export async function retrieveInboxAiSearch(userId, {
  q,
  limit = DEFAULT_LIMIT,
  dbClient = db,
  embeddingClient = createEmailSearchEmbeddingClient(),
  capability = null,
  plan = null,
  now = Date.now(),
} = {}) {
  const maxResults = clampLimit(limit);
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
  const vectorLimit = effectivePlan?.date_window?.after || effectivePlan?.date_window?.before
    ? 100
    : Math.max(maxResults * 2, 20);
  const candidatePoolLimit = Math.max(maxResults * 4, 50);

  const lexicalPromise = loadLexicalRows(dbClient, userId, {
    textQuery,
    readFilter,
    plan: effectivePlan,
    limit: maxResults,
  });
  const vectorPromise = (async () => {
    if (!vectorQuery.trim()) return { status: "skipped", matches: [] };
    try {
      const [queryEmbedding] = await embeddingClient.embed([vectorQuery]);
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

  const [lexicalRows, vector] = await Promise.all([lexicalPromise, vectorPromise]);
  const vectorRows = await loadRowsByUid(dbClient, userId, vector.matches.map((match) => match.uid), { readFilter, plan: effectivePlan });
  const candidatePool = mergeCandidates({
    lexicalRows,
    vectorMatches: vector.matches,
    vectorRows,
    limit: candidatePoolLimit,
  });
  const candidates = filterEmailSearchCandidatesForEvidence(candidatePool, { q, plan: effectivePlan }).slice(0, maxResults);

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
    total: candidates.length,
    candidates,
  };
}
