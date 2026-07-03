// Email-content shaping for Alfred tool results: trust fencing, sender formatting,
// quoted-chain stripping, and the compact per-candidate search row. Everything here
// renders attacker-controlled email text for the model, so the fencing rules (ADR
// 0006) live in one place.

// Per-candidate slice of the body lede: the provider snippet is often preheader
// boilerplate that cuts off right before the useful line (balance, due date), so
// each result also carries the first ~300 chars of the actual body text.
const EXCERPT_CHAR_LIMIT = 300;

// Candidates carry `from` as a { name, address } object; get_email_body carries
// it as a string. Flatten to a readable "Name <address>" before fencing so the
// model sees the actual sender instead of "[object Object]".
export function formatSender(from) {
  if (!from) return "";
  if (typeof from === "string") return from;
  const name = String(from.name || "").trim();
  const address = String(from.address || "").trim();
  if (name && address && name !== address) return `${name} <${address}>`;
  return name || address || "";
}

export function wrapEmailContent(uid, text) {
  // Neutralize any attacker-supplied delimiter in the untrusted text so it can't
  // close the trust fence early and smuggle "trusted" instructions after it.
  const safe = String(text || "").replace(/<(\/?)email_content/gi, "&lt;$1email_content");
  return `<email_content uid="${uid}">${safe}</email_content>`;
}

// htmlToPlainText collapses newlines, so the body arrives as one line — quoted
// reply chains can't be detected by a leading ">" or a "-- " signature line.
// Match the chain header inline instead, and cut everything from the EARLIEST
// high-confidence marker onward. Conservative by design: the "On … wrote:"
// attribution requires an email address in the window (a bare "he wrote:" in
// prose is not a quote boundary), so legitimate content is never dropped — at
// worst a chain isn't stripped and the char cap still bounds it.
const QUOTE_MARKERS = [
  /-{2,}\s*Original Message\s*-{2,}/i, // Outlook reply divider
  /-{2,}\s*Forwarded message\s*-{2,}/i, // Gmail/Outlook forward divider
  /\bBegin forwarded message:/i, // Apple Mail forward
  /\bFrom:\s.{1,120}?\bSent:\s.{1,120}?\bTo:\s/i, // Outlook header block
];

export function stripQuotedReply(text) {
  const s = String(text || "");
  let cut = -1;
  for (const re of QUOTE_MARKERS) {
    const m = s.match(re);
    if (m && (cut === -1 || m.index < cut)) cut = m.index;
  }
  // Gmail/Apple "On <date>, <name> <addr> wrote:" — only treat it as a boundary
  // when an email address sits inside the matched header.
  const onWrote = s.match(/\bOn\b[\s\S]{5,240}?\bwrote:/i);
  if (onWrote && /@/.test(onWrote[0]) && (cut === -1 || onWrote.index < cut)) {
    cut = onWrote.index;
  }
  return (cut === -1 ? s : s.slice(0, cut)).trim();
}

// The compact per-candidate row the model reasons over. Every disambiguator the
// re-ranker already used stays visible here (audit C1: deadline, category, bill,
// account, body lede) — otherwise near-duplicate recurring emails are told apart by
// the ranking but indistinguishable to the model. Optional fields are omitted (not
// null) to keep tool results small; raw fused scores are internal and never shown.
export function searchEmailResultRow(candidate) {
  const meta = candidate.metadata || {};
  const account = candidate.account?.email || candidate.account?.label || "";
  const excerpt = String(candidate.body_excerpt || "").slice(0, EXCERPT_CHAR_LIMIT);
  // Same "resolved" rule as email-search-ranking.js: lane/urgency mean "act on this
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
