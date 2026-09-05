import type { AlfredSearchCandidate } from "./alfred-types.ts";

// Email-content shaping for Alfred tool results: trust fencing, sender formatting,
// and the compact per-candidate search row. Everything here
// renders attacker-controlled email text for the model, so the fencing rules (ADR
// 0006) live in one place.

// Per-candidate slice of the body lede: the provider snippet is often preheader
// boilerplate that cuts off right before the useful line (balance, due date), so
// each result also carries the first ~300 chars of the actual body text.
const EXCERPT_CHAR_LIMIT = 300;

// Candidates carry `from` as a { name, address } object; get_email_body carries
// it as a string. Flatten to a readable "Name <address>" before fencing so the
// model sees the actual sender instead of "[object Object]".
export function formatSender(from: AlfredSearchCandidate["from"]): string {
  if (!from) return "";
  if (typeof from === "string") return from;
  const name = String(from.name || "").trim();
  const address = String(from.address || "").trim();
  if (name && address && name !== address) return `${name} <${address}>`;
  return name || address || "";
}

export function wrapEmailContent(uid: string, text: unknown): string {
  // Neutralize any attacker-supplied delimiter in the untrusted text so it can't
  // close the trust fence early and smuggle "trusted" instructions after it.
  const safe = String(text || "").replace(/<(\/?)email_content/gi, "&lt;$1email_content");
  const safeUid = String(uid || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  return `<email_content uid="${safeUid}">${safe}</email_content>`;
}

// The compact per-candidate row the model reasons over. Every disambiguator the
// re-ranker already used stays visible here (audit C1: deadline, category, bill,
// account, body lede) — otherwise near-duplicate recurring emails are told apart by
// the ranking but indistinguishable to the model. Optional fields are omitted (not
// null) to keep tool results small; raw fused scores are internal and never shown.
export function searchEmailResultRow(candidate: AlfredSearchCandidate): Record<string, unknown> {
  const meta = candidate.metadata || {};
  const account = candidate.account?.email || candidate.account?.label || "";
  const excerpt = String(candidate.body_excerpt || "").slice(0, EXCERPT_CHAR_LIMIT);
  // Same "resolved" rule as email-search-ranking.ts: lane/urgency mean "act on this
  // now"; once the item is handled or its deadline has passed they are frozen history
  // (the anchor incident: a PAID statement still advertised needs_attention/high while
  // its newer sibling read fyi/medium — every label the model saw pointed at the
  // wrong email). Suppress them; deadline_at itself stays, a past date reads honestly.
  const deadlineMs = Date.parse(meta.deadline_at || "");
  const resolved = Boolean(meta.handled) || (Number.isFinite(deadlineMs) && deadlineMs < Date.now());
  return {
    uid: candidate.uid,
    // subject/from are attacker-controlled too — wrap them in the untrusted
    // delimiter so the system prompt's distrust rule covers them, not just the body.
    from: wrapEmailContent(candidate.uid, formatSender(candidate.from)),
    subject: wrapEmailContent(candidate.uid, candidate.subject),
    date: candidate.email_date_utc || candidate.email_date,
    read: candidate.read,
    ...(account ? { account } : {}),
    snippet: wrapEmailContent(candidate.uid, candidate.body_snippet),
    ...(excerpt ? { excerpt: wrapEmailContent(candidate.uid, excerpt) } : {}),
    ...(meta.category && meta.category !== "uncategorized" ? { category: meta.category } : {}),
    ...(meta.deadline_at ? { deadline_at: meta.deadline_at } : {}),
    ...(meta.bill_candidate ? { bill: true } : {}),
    ...(meta.handled ? { handled: true } : {}),
    ...(!resolved && meta.lane && meta.lane !== "untriaged" ? { lane: meta.lane } : {}),
    ...(!resolved && meta.urgency && meta.urgency !== "normal" ? { urgency: meta.urgency } : {}),
  };
}
