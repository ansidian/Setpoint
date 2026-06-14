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

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function queryTerms(query) {
  return normalizeText(query)
    .split(/\s+/)
    .map((term) => term.replace(/^"+|"+$/g, ""))
    .filter((term) => term && !/^is:[^\s]+$/.test(term));
}

function hasJsonPayload(value) {
  const text = String(value || "").trim();
  return !!text && text !== "{}" && text !== "null";
}

function parseTime(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : 0;
}

function add(details, label, value) {
  if (!value) return;
  details.push({ label, value });
}

function snapshotValue(row, snapshotKey, triageKey, fallback = null) {
  return row[snapshotKey] ?? row[triageKey] ?? fallback;
}

export function scoreEmailSearchRow(row, { query = "", now = Date.now() } = {}) {
  const nowMs = typeof now === "string" ? parseTime(now) : now;
  const terms = queryTerms(query);
  const phrase = terms.join(" ");
  const subject = normalizeText(row.subject);
  const fromAddress = normalizeText(row.from_address);
  const fromName = normalizeText(row.from_name);
  const body = normalizeText(`${row.body_snippet || ""} ${row.body_highlight || ""} ${row.body_text || ""}`);
  const details = [];
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

  if (lane === "needs_attention" || lane === "action") add(details, "lane_needs_attention", 28);
  if (lane === "fyi") add(details, "lane_fyi", 8);
  if (lane === "noise") add(details, "lane_noise", -65);
  if (handledAt && lane !== "noise") add(details, "handled_neutral", 0);
  if (handledAt && (lane === "needs_attention" || urgency === "high")) add(details, "handled_important", 4);
  if (category && USEFUL_CATEGORIES.has(category)) add(details, "useful_category", 8);
  if (urgency === "high") add(details, "urgency_high", 18);
  if (urgency === "medium") add(details, "urgency_medium", 9);
  if (urgency === "low") add(details, "urgency_low", -2);
  if (escalationBadge) add(details, "escalation_badge", 14);
  if (hasJsonPayload(row.triage_bill_candidate_json)) add(details, "bill_candidate", 16);

  const deadlineMs = parseTime(deadlineAt);
  if (deadlineMs) {
    const daysUntil = (deadlineMs - nowMs) / DAY_MS;
    if (daysUntil >= 0 && daysUntil <= 3) add(details, "deadline_soon", 18);
    else if (daysUntil > 3 && daysUntil <= 14) add(details, "deadline_future", 10);
    else add(details, "deadline_signal", 5);
  }

  if (!row.read) add(details, "unread", 3);
  if (row.snapshot_dismissed_from_today_at) add(details, "dismissed_today", -28);
  if (row.snapshot_provider_removed_at) add(details, "provider_removed", -100);
  if (["removed", "deleted", "archived", "trashed"].includes(row.triage_provider_state)) {
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
  };
}

export function rankEmailSearchRows(rows, {
  query = "",
  limit = 30,
  now = Date.now(),
  debug = false,
} = {}) {
  return [...(rows || [])]
    .map((row) => {
      const scoring = scoreEmailSearchRow(row, { query, now });
      return debug ? { ...row, search_score: scoring.score, search_score_details: scoring } : { ...row, search_score: scoring.score };
    })
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
