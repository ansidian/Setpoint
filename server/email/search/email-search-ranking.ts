const DAY_MS = 24 * 60 * 60 * 1000;
const USEFUL_CATEGORIES = new Set([
  "finance",
  "bills",
  "school",
  "security",
  "work",
  "travel",
  "health",
  "legal",
]);

export interface EmailSearchRankingRow extends Record<string, unknown> {
  uid?: unknown;
  from_address?: unknown;
  from_name?: unknown;
  subject?: unknown;
  body_snippet?: unknown;
  body_highlight?: unknown;
  body_text?: unknown;
  email_date?: unknown;
  email_date_utc?: unknown;
  thread_id?: unknown;
  read?: unknown;
  snapshot_dismissed_from_today_at?: unknown;
  snapshot_provider_removed_at?: unknown;
  snapshot_source_at?: unknown;
  snapshot_updated_at?: unknown;
  snapshot_resurfaced_at?: unknown;
  triage_updated_at?: unknown;
  triage_provider_state?: unknown;
  triage_bill_candidate_json?: unknown;
  snapshot_handled_at?: unknown;
  triage_handled_at?: unknown;
  rank?: unknown;
}

export interface EmailSearchScoreDetail {
  label: string;
  value: number;
}

export interface EmailSearchScoring {
  score: number;
  details: EmailSearchScoreDetail[];
  lane: unknown;
  category: unknown;
  urgency: unknown;
  penalized: boolean;
}

export type RankedEmailSearchRow<T extends EmailSearchRankingRow = EmailSearchRankingRow> = T & {
  search_score: number;
  search_penalized: boolean;
  search_score_details?: EmailSearchScoring;
};

interface ScoreOptions {
  query?: string;
  now?: string | number;
}

function normalizeText(value: unknown): string {
  return String(value || "").toLowerCase();
}

function queryTerms(query: unknown): string[] {
  return normalizeText(query)
    .split(/\s+/)
    .map((term) => term.replace(/^"+|"+$/g, ""))
    .filter((term) => term && !/^is:[^\s]+$/.test(term));
}

export function hasJsonPayload(value: unknown): boolean {
  const text = String(value || "").trim();
  return !!text && text !== "{}" && text !== "null";
}

function parseTime(value: unknown): number {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function add(details: EmailSearchScoreDetail[], label: string, value: number): void {
  if (!value) return;
  details.push({ label, value });
}

function snapshotValue(row: EmailSearchRankingRow, snapshotKey: string, triageKey: string, fallback: unknown = null): unknown {
  return row[snapshotKey] ?? row[triageKey] ?? fallback;
}

export function scoreEmailSearchRow(row: EmailSearchRankingRow, { query = "", now = Date.now() }: ScoreOptions = {}): EmailSearchScoring {
  const nowMs = typeof now === "string" ? parseTime(now) : now;
  const terms = queryTerms(query);
  const phrase = terms.join(" ");
  const subject = normalizeText(row.subject);
  const fromAddress = normalizeText(row.from_address);
  const fromName = normalizeText(row.from_name);
  const body = normalizeText(`${row.body_snippet || ""} ${row.body_highlight || ""} ${row.body_text || ""}`);
  const details: EmailSearchScoreDetail[] = [];
  let score = 0;

  if (phrase) {
    if (fromAddress === phrase || fromAddress.includes(`@${phrase}`)) add(details, "exact_sender", 45);
    if (fromAddress.split("@")[1] === phrase) add(details, "sender_domain", 42);
    if (subject.includes(phrase)) add(details, "subject_phrase", 34);
    if (fromName.includes(phrase)) add(details, "sender_name", 18);
  }

  for (const term of terms) {
    if (!term) continue;
    if (fromAddress.includes(term)) add(details, "sender_token", 15);
    if (subject.includes(term)) add(details, "subject_token", 9);
    if (body.includes(term)) add(details, "body_token", 2);
  }
  if (terms.length > 1 && terms.every((term) => body.includes(term))) {
    add(details, "body_all_terms", 12);
  }

  const lane = snapshotValue(row, "snapshot_lane", "triage_lane", "untriaged");
  const category = snapshotValue(row, "snapshot_category", "triage_category", "uncategorized");
  const urgency = snapshotValue(row, "snapshot_urgency", "triage_urgency", "normal");
  const deadlineAt = snapshotValue(row, "snapshot_deadline_at", "triage_deadline_at", null);
  const escalationBadge = snapshotValue(row, "snapshot_escalation_badge", "triage_escalation_badge", null);
  const handledAt = row.snapshot_handled_at || row.triage_handled_at || null;
  const deadlineMs = parseTime(deadlineAt);
  // Triage attention signals describe "act on this now", not a permanent trait of the
  // email. Once the item is handled or its deadline has passed they are stale, and a
  // recurring bill/statement would otherwise outrank its own newer sibling forever
  // (needs_attention+high+badge ≈ +60 vs a recency ceiling of 20). Traits that aid
  // findability (bill_candidate, useful_category, urgency_low demotion) do not expire.
  const resolved = Boolean(handledAt) || Boolean(deadlineMs && deadlineMs < nowMs);

  if (lane === "needs_attention" || lane === "action") {
    if (resolved) add(details, "lane_needs_attention_resolved", 8);
    else add(details, "lane_needs_attention", 28);
  }
  if (lane === "fyi") add(details, "lane_fyi", 8);
  if (lane === "noise") add(details, "lane_noise", -65);
  if (typeof category === "string" && USEFUL_CATEGORIES.has(category)) add(details, "useful_category", 8);
  if (!resolved) {
    if (urgency === "high") add(details, "urgency_high", 18);
    if (urgency === "medium") add(details, "urgency_medium", 9);
  }
  if (urgency === "low") add(details, "urgency_low", -2);
  if (escalationBadge && !resolved) add(details, "escalation_badge", 14);
  if (hasJsonPayload(row.triage_bill_candidate_json)) add(details, "bill_candidate", 16);

  if (deadlineMs && !resolved) {
    const daysUntil = (deadlineMs - nowMs) / DAY_MS;
    if (daysUntil >= 0 && daysUntil <= 3) add(details, "deadline_soon", 18);
    else if (daysUntil > 3 && daysUntil <= 14) add(details, "deadline_future", 10);
    else add(details, "deadline_signal", 5);
  }

  if (!row.read) add(details, "unread", 3);
  if (row.snapshot_dismissed_from_today_at) add(details, "dismissed_today", -28);
  if (row.snapshot_provider_removed_at) add(details, "provider_removed", -100);
  if (["removed", "deleted", "archived", "trashed"].includes(String(row.triage_provider_state || ""))) {
    add(details, "provider_state_removed", -100);
  }

  const emailMs = parseTime(row.email_date_utc || row.email_date);
  if (emailMs && nowMs) {
    const ageDays = Math.max(0, (nowMs - emailMs) / DAY_MS);
    add(details, "recency", Math.max(0, 20 - Math.min(20, ageDays * 0.35)));
  }

  const interactionMs = Math.max(
    parseTime(row.snapshot_source_at),
    parseTime(row.snapshot_updated_at),
    parseTime(row.triage_updated_at),
    Number(row.snapshot_resurfaced_at || 0),
  );
  if (interactionMs && nowMs) {
    const interactionAgeDays = Math.max(0, (nowMs - interactionMs) / DAY_MS);
    if (interactionAgeDays <= 7) {
      add(details, "recent_interaction", Math.max(0, 4 - interactionAgeDays * 0.5));
    }
  }

  for (const detail of details) score += detail.value;
  return {
    score,
    details,
    lane,
    category,
    urgency,
    // Deliberately-demoted rows (noise lane, provider-removed, dismissed): the family
    // clamp must not treat them as the ranking anchor for their siblings, and query
    // points can push their TOTAL positive, so the flag is derived from the penalty
    // sources rather than the score.
    penalized: lane === "noise"
      || Boolean(row.snapshot_dismissed_from_today_at)
      || Boolean(row.snapshot_provider_removed_at)
      || ["removed", "deleted", "archived", "trashed"].includes(String(row.triage_provider_state || "")),
  };
}

function familyKey(row: EmailSearchRankingRow): string | null {
  const from = normalizeText(row.from_address).trim();
  const subject = normalizeText(row.subject).trim();
  // Subjectless emails from one sender are distinct messages, not a recurring series.
  if (!from || !subject) return null;
  return `${from}|${subject}`;
}

function threadKey(row: EmailSearchRankingRow): string | null {
  const thread = String(row.thread_id || "").trim();
  return thread || null;
}

// Recurring emails (same sender + same subject: monthly statements, autopay notices)
// must surface newest-first: any metadata edge an older sibling still carries is stale
// context, not higher relevance. Clamp older siblings to the newest member's score so
// the date tie-break orders the family newest-first — unless the newest is deliberately
// penalized (negative score: noise/removed/dismissed), where demotion is intentional
// and clamping would drag the rest of the family down with it.
//
// (generalized from the family-only version; see the family comment above —
// the same stale-metadata logic applies to reply threads, whose subjects
// diverge ("Re:") and so escape the from+subject family key.)
function applyRecencyDominance<T extends RankedEmailSearchRow>(rows: T[], keyOf: (row: T) => string | null, label: string): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const members = groups.get(key);
    if (members) members.push(row);
    else groups.set(key, [row]);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const newest = members.reduce((best, row) => (
      parseTime(row.email_date_utc || row.email_date) > parseTime(best.email_date_utc || best.email_date) ? row : best
    ));
    if (newest.search_penalized || newest.search_score < 0) continue;
    for (const row of members) {
      if (row === newest || row.search_score <= newest.search_score) continue;
      const delta = newest.search_score - row.search_score;
      row.search_score = newest.search_score;
      if (row.search_score_details) {
        row.search_score_details.details.push({ label, value: delta });
        row.search_score_details.score = row.search_score;
      }
    }
  }
  return rows;
}

function applyFamilyRecencyDominance<T extends RankedEmailSearchRow>(rows: T[]): T[] {
  applyRecencyDominance(rows, familyKey, "family_recency_clamp");
  return applyRecencyDominance(rows, threadKey, "thread_recency_clamp");
}

export function rankEmailSearchRows<T extends EmailSearchRankingRow>(rows: T[] | null | undefined, {
  query = "",
  limit = 30,
  now = Date.now(),
  debug = false,
}: ScoreOptions & { limit?: number; debug?: boolean } = {}): RankedEmailSearchRow<T>[] {
  const scored = [...(rows || [])]
    .map((row) => {
      const scoring = scoreEmailSearchRow(row, { query, now });
      return debug
        ? { ...row, search_score: scoring.score, search_penalized: scoring.penalized, search_score_details: scoring }
        : { ...row, search_score: scoring.score, search_penalized: scoring.penalized };
    });
  return applyFamilyRecencyDominance(scored)
    .sort((a, b) => {
      if (b.search_score !== a.search_score) return b.search_score - a.search_score;
      const dateDiff = parseTime(b.email_date_utc || b.email_date) - parseTime(a.email_date_utc || a.email_date);
      if (dateDiff) return dateDiff;
      const rankDiff = Number(a.rank || 0) - Number(b.rank || 0);
      if (rankDiff) return rankDiff;
      return String(a.uid || "").localeCompare(String(b.uid || ""));
    })
    .slice(0, limit);
}
