import type { Client } from "@libsql/client";
import type {
  EmailSearchAccount,
  EmailSearchResponse,
  EmailSearchResult,
} from "../../shared/types/email.ts";
import db from "../db/connection.ts";
import { normalizeBillCandidate } from "../snapshots/snapshot-service.ts";
import { EMAIL_SEARCH_BM25_RANK_SQL, parseEmailSearchQuery, sanitizeFtsQuery } from "./search/email-search-query.ts";
import { rankEmailSearchRows } from "./search/email-search-ranking.ts";
import type { EmailSearchRankingRow, RankedEmailSearchRow } from "./search/email-search-ranking.ts";

interface EmailSearchRow extends EmailSearchRankingRow {
  uid: string;
  account_id: string;
  account_label: string;
  account_email: string;
  account_color: string | null;
  account_icon: string | null;
  from_name: string | null;
  from_address: string | null;
  subject: string | null;
  body_snippet: string | null;
  email_date: string | null;
  read: number | boolean | null;
  subject_highlight: string | null;
  body_highlight: string | null;
  triage_bill_candidate_json?: string | null;
}

interface SearchEmailsOptions {
  q: string;
  limit?: string | number;
  offset?: string | number;
  debug?: boolean;
  dbClient?: Client;
}

function buildEmailWebUrl(uid: string, accountId: string, accountEmail: string): string | null {
  if (!uid?.startsWith("gmail-")) return null;
  const prefix = `gmail-${accountId}-`;
  if (!uid.startsWith(prefix)) return null;
  const messageId = uid.slice(prefix.length);
  if (!messageId) return null;
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${messageId}`;
}

function parseJsonPayload(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function searchEmails(userId: string, { q, limit, offset, debug = false, dbClient = db }: SearchEmailsOptions): Promise<EmailSearchResponse> {
  const maxResults = Math.min(parseInt(String(limit)) || 30, 100);
  const start = Math.max(parseInt(String(offset)) || 0, 0);
  const fetchLimit = Math.min(Math.max(maxResults * 8, 200), 500);
  const { textQuery, readFilter } = parseEmailSearchQuery(q);
  const hasTextQuery = textQuery.trim().length > 0;
  const readPredicate = readFilter == null ? "" : " AND idx.read = ?";
  // Both branches first bound the driving row set to fetchLimit via a CTE, then
  // attach triage + the latest-active-snapshot row. This keeps the (byte-for-
  // byte unchanged) per-row correlated snapshot subquery, but runs it against at
  // most fetchLimit rows instead of every FTS match / every indexed row
  // (P2-14 + P2-24). `alias` is the bounded CTE so the subquery keys are stable.
  const buildSnapshotJoins = (alias: string): string => `
              LEFT JOIN ea_email_triage triage
                ON triage.user_id = ${alias}.user_id
               AND triage.account_id = ${alias}.account_id
               AND triage.email_id = ${alias}.uid
              LEFT JOIN ea_briefing_snapshot_items snap
                ON snap.id = (
                  SELECT si.id
                  FROM ea_briefing_snapshot_items si
                  JOIN ea_briefing_snapshots s ON s.id = si.snapshot_id
                  WHERE si.user_id = ${alias}.user_id
                    AND si.account_id = ${alias}.account_id
                    AND si.email_id = ${alias}.uid
                    AND s.status = 'active'
                  ORDER BY si.updated_at DESC, si.id DESC
                  LIMIT 1
                )`;
  const rankingColumns = `,
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
  // `matched` is bounded twice — best-by-weighted-bm25 plus newest-by-date — so a
  // brand-new match can never be pushed out of the rankable pool by older term-dense
  // matches; the date tiebreak keeps recurring twins (identical bm25) newest-first.
  const recentMatchSlice = 50;
  const result = hasTextQuery
    ? await dbClient.execute({
        sql: `WITH matched AS (
                SELECT
                  idx.uid, idx.account_id, idx.account_label, idx.account_email,
                  idx.account_color, idx.account_icon,
                  idx.from_name, idx.from_address, idx.subject, idx.body_snippet,
                  idx.email_date, idx.email_date_utc, idx.read, idx.user_id, idx.thread_id,
                  snippet(ea_email_fts, 3, '<mark>', '</mark>', '...', 32) AS subject_highlight,
                  snippet(ea_email_fts, 5, '<mark>', '</mark>', '...', 48) AS body_highlight,
                  ${EMAIL_SEARCH_BM25_RANK_SQL} AS rank
                FROM ea_email_fts
                JOIN ea_email_index idx ON idx.uid = ea_email_fts.uid
                WHERE ea_email_fts MATCH ? AND idx.user_id = ?${readPredicate}
              ),
              bounded AS (
                SELECT * FROM (SELECT * FROM matched ORDER BY rank, email_date_utc DESC LIMIT ?)
                UNION
                SELECT * FROM (SELECT * FROM matched ORDER BY email_date_utc DESC, rank LIMIT ?)
              )
              SELECT
                bounded.uid, bounded.account_id, bounded.account_label, bounded.account_email,
                bounded.account_color, bounded.account_icon,
                bounded.from_name, bounded.from_address, bounded.subject, bounded.body_snippet,
                bounded.email_date, bounded.email_date_utc, bounded.read, bounded.thread_id,
                bounded.subject_highlight, bounded.body_highlight, bounded.rank
                ${rankingColumns}
              FROM bounded
              ${buildSnapshotJoins("bounded")}
              ORDER BY bounded.rank, bounded.email_date_utc DESC`,
        args: readFilter == null
          ? [sanitizeFtsQuery(textQuery), userId, fetchLimit, recentMatchSlice]
          : [sanitizeFtsQuery(textQuery), userId, readFilter, fetchLimit, recentMatchSlice],
      })
    : await dbClient.execute({
        sql: `WITH bounded AS (
                SELECT
                  idx.uid, idx.account_id, idx.account_label, idx.account_email,
                  idx.account_color, idx.account_icon,
                  idx.from_name, idx.from_address, idx.subject, idx.body_snippet,
                  idx.email_date, idx.email_date_utc, idx.read, idx.user_id, idx.thread_id
                FROM ea_email_index idx
                WHERE idx.user_id = ?${readPredicate}
                ORDER BY idx.email_date_utc DESC
                LIMIT ?
              )
              SELECT
                bounded.uid, bounded.account_id, bounded.account_label, bounded.account_email,
                bounded.account_color, bounded.account_icon,
                bounded.from_name, bounded.from_address, bounded.subject, bounded.body_snippet,
                bounded.email_date, bounded.email_date_utc, bounded.read, bounded.thread_id,
                NULL AS subject_highlight,
                NULL AS body_highlight,
                0 AS rank
                ${rankingColumns}
              FROM bounded
              ${buildSnapshotJoins("bounded")}
              ORDER BY bounded.email_date_utc DESC`,
        args: readFilter == null
          ? [userId, fetchLimit]
          : [userId, readFilter, fetchLimit],
      });

  const ranked = rankEmailSearchRows(result.rows as unknown as EmailSearchRow[], {
    query: textQuery,
    limit: Infinity,
    debug,
  });
  const total = ranked.length;
  const pageRows = ranked.slice(start, start + maxResults);
  const capped = result.rows.length >= fetchLimit;

  const byAccount: Record<string, EmailSearchAccount> = {};
  const results: EmailSearchResult[] = [];
  const buildResult = (row: RankedEmailSearchRow<EmailSearchRow>): EmailSearchResult => {
    const billCandidate = parseJsonPayload(row.triage_bill_candidate_json);
    const email: EmailSearchResult = {
      uid: row.uid,
      from_name: row.from_name,
      from_address: row.from_address,
      subject: row.subject,
      body_snippet: row.body_snippet,
      subject_highlight: row.subject_highlight,
      body_highlight: row.body_highlight,
      email_date: row.email_date,
      read: !!row.read,
      web_url: buildEmailWebUrl(row.uid, row.account_id, row.account_email),
      account_id: row.account_id,
      account_label: row.account_label,
      account_email: row.account_email,
      account_color: row.account_color,
      account_icon: row.account_icon,
    };
    if (billCandidate) {
      email.hasBill = true;
      email.bill_candidate = billCandidate;
      email.extractedBill = normalizeBillCandidate(billCandidate);
    }
    if (debug) {
      email.search_score = row.search_score;
      email.search_score_details = row.search_score_details;
    }
    return email;
  };

  for (const row of pageRows) {
    const key = row.account_id;
    if (!byAccount[key]) {
      byAccount[key] = {
        account_id: row.account_id,
        account_label: row.account_label,
        account_email: row.account_email,
        account_color: row.account_color,
        account_icon: row.account_icon,
        results: [],
      };
    }
    const email = buildResult(row);
    results.push(email);
    byAccount[key].results.push(email);
  }

  return {
    results,
    accounts: Object.values(byAccount),
    total,
    offset: start,
    has_more: start + maxResults < total,
    capped,
    query: q,
  };
}
