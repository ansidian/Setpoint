import {
  EMAIL_SEARCH_BM25_RANK_SQL,
  buildFtsFallbackQueries,
  sanitizeFtsQuery,
} from "./email-search-query.ts";
import { rankEmailSearchRows } from "./email-search-ranking.ts";
import type { Client, Value } from "@libsql/client";
import type { EmailSearchDateWindow } from "./email-search-date-window.ts";
import type { EmailSearchRankingRow, RankedEmailSearchRow } from "./email-search-ranking.ts";

export interface EmailSearchDbRow extends EmailSearchRankingRow {
  uid: string;
  account_id?: unknown;
  account_label?: unknown;
  account_email?: unknown;
  account_color?: unknown;
  account_icon?: unknown;
  lexical_fallback?: boolean;
  search_score?: number;
  search_penalized?: boolean;
}

interface EmailSearchLexicalPlan {
  date_window?: EmailSearchDateWindow | null;
}

interface QueryFilters {
  sql: string;
  args: Value[];
}

interface LoadEmailSearchLexicalRowsOptions {
  textQueries?: unknown[];
  fallbackQuery?: unknown;
  readFilter: 0 | 1 | null;
  plan: EmailSearchLexicalPlan | null;
  limit: number;
  now?: string | number;
}

interface LoadEmailSearchRowsByUidOptions {
  readFilter: 0 | 1 | null;
  plan: EmailSearchLexicalPlan | null;
}

// The bm25-ordered fetch is blind to recency: on broad queries a brand-new match can
// sit past the fetch ceiling and never reach the re-ranker (prod: the newest "account"
// match sat at bm25 position 325). Union in the newest matches so recency-shaped
// queries always have them in the rankable pool.
const RECENT_MATCH_SLICE = 50;
// Each planned lexical query is its own FTS pass; the passes are unioned before
// ranking. Bounded so a planner cannot fan one search out into arbitrary SQL.
const MAX_LEXICAL_QUERY_PASSES = 3;

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

function dbRows(rows: readonly Record<string, unknown>[]): EmailSearchDbRow[] {
  return rows as unknown as EmailSearchDbRow[];
}

function buildPlanFilters(plan: EmailSearchLexicalPlan | null, readFilter: 0 | 1 | null, alias = "idx"): QueryFilters {
  const filters: string[] = [];
  const args: Value[] = [];
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

// One FTS pass. `matched` is bounded twice — best-by-bm25 plus newest-by-date — then
// the snapshot join runs against that bounded union only. The final SELECT aliases the
// union back to `idx` so SNAPSHOT_JOIN/RANKING_COLUMNS apply verbatim.
async function fetchFtsRows(dbClient: Client, userId: string, { ftsQuery, filters, fetchLimit }: { ftsQuery: string; filters: QueryFilters; fetchLimit: number }): Promise<EmailSearchDbRow[]> {
  const result = await dbClient.execute({
    sql: `WITH matched AS (
            SELECT
              idx.uid, idx.user_id, idx.account_id, idx.account_label, idx.account_email,
              idx.account_color, idx.account_icon,
              idx.from_name, idx.from_address, idx.subject, idx.body_snippet, idx.body_text,
              idx.email_date, idx.email_date_utc, idx.read, idx.thread_id,
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
    args: [ftsQuery, userId, ...filters.args, fetchLimit, RECENT_MATCH_SLICE],
  });
  return dbRows(result.rows);
}

export async function loadEmailSearchLexicalRows(dbClient: Client, userId: string, {
  textQueries = [],
  fallbackQuery = "",
  readFilter,
  plan,
  limit,
  now = Date.now(),
}: LoadEmailSearchLexicalRowsOptions): Promise<RankedEmailSearchRow<EmailSearchDbRow>[]> {
  const fetchLimit = Math.min(Math.max(limit * 8, 100), 500);
  const filters = buildPlanFilters(plan, readFilter);
  const queries = textQueries
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, MAX_LEXICAL_QUERY_PASSES);
  if (queries.length) {
    // Every planned lexical query gets its own FTS pass (the schema advertises an
    // array; pre-audit only [0] ever reached FTS — C2). Union by uid, first pass
    // wins: per-pass bm25 ranks are not comparable across MATCH strings, and rank
    // is only a late tiebreaker after score and date.
    const ftsQueries = [...new Set(queries.map((query) => sanitizeFtsQuery(query)))];
    const passes = await Promise.all(
      ftsQueries.map((ftsQuery) => fetchFtsRows(dbClient, userId, { ftsQuery, filters, fetchLimit })),
    );
    const rowsByUid = new Map<string, EmailSearchDbRow>();
    for (const rows of passes) {
      for (const row of rows) {
        if (!rowsByUid.has(row.uid)) rowsByUid.set(row.uid, row);
      }
    }
    // Zero-result recovery ladder (audit B1/C3): when no primary pass matched, retry
    // the NL query in progressively looser forms and stop at the first that matches
    // anything — so filler words or one wrong token degrade the leg instead of
    // zeroing it (which silently collapsed retrieval to vector-only).
    if (!rowsByUid.size) {
      const tried = new Set(ftsQueries.map((query) => query.toLowerCase()));
      for (const variant of buildFtsFallbackQueries(fallbackQuery || queries[0])) {
        if (tried.has(variant.toLowerCase())) continue;
        tried.add(variant.toLowerCase());
        const rows = await fetchFtsRows(dbClient, userId, { ftsQuery: variant, filters, fetchLimit });
        if (!rows.length) continue;
        // Fallback matches are speculative (a loosened query, not the planned one):
        // tag them so the evidence gate does not treat the engine match itself as
        // evidence the way it does for primary-pass rows.
        for (const row of rows) rowsByUid.set(row.uid, { ...row, lexical_fallback: true });
        break;
      }
    }
    return rankEmailSearchRows([...rowsByUid.values()], {
      query: queries[0] || "",
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
            idx.email_date, idx.email_date_utc, idx.read, idx.thread_id,
            0 AS rank
            ${RANKING_COLUMNS}
          FROM ea_email_index idx
          ${SNAPSHOT_JOIN}
          WHERE idx.user_id = ?${filters.sql}
          ORDER BY idx.email_date_utc DESC, idx.email_date DESC
          LIMIT ?`,
    args: [userId, ...filters.args, fetchLimit],
  });
  return rankEmailSearchRows(dbRows(result.rows), {
    // Only reachable when every text query was blank — score recency/quality alone.
    query: "",
    limit: fetchLimit,
    now,
    debug: true,
  });
}

export async function loadEmailSearchRowsByUid(dbClient: Client, userId: string, uids: string[], {
  readFilter,
  plan,
}: LoadEmailSearchRowsByUidOptions): Promise<EmailSearchDbRow[]> {
  if (!uids.length) return [];
  const filters = buildPlanFilters(plan, readFilter);
  const result = await dbClient.execute({
    sql: `SELECT
            idx.uid, idx.account_id, idx.account_label, idx.account_email,
            idx.account_color, idx.account_icon,
            idx.from_name, idx.from_address, idx.subject, idx.body_snippet, idx.body_text,
            idx.email_date, idx.email_date_utc, idx.read, idx.thread_id,
            0 AS rank
            ${RANKING_COLUMNS}
          FROM ea_email_index idx
          ${SNAPSHOT_JOIN}
          WHERE idx.user_id = ?
            AND idx.uid IN (${uids.map(() => "?").join(",")})${filters.sql}
          ORDER BY idx.email_date_utc DESC, idx.email_date DESC`,
    args: [userId, ...uids, ...filters.args],
  });
  return dbRows(result.rows);
}
