// bm25() weights per ea_email_fts column (uid, from_name, from_address, subject,
// body_snippet, body_text): subject dominates so a subject match cannot be buried by
// brand mentions in sender fields or term-dense bodies (prod: 13 from-field "paypal"
// hits outranked the subject-matching statement under unweighted bm25, which also
// exactly tied recurring statement twins).
export const EMAIL_SEARCH_BM25_RANK_SQL = "bm25(ea_email_fts, 0.0, 4.0, 4.0, 10.0, 3.0, 1.0)";

export function sanitizeFtsQuery(raw) {
  const terms = raw
    .replace(/[\u201C\u201D]/g, '"')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  if (terms.length > 0) {
    const last = terms[terms.length - 1];
    terms[terms.length - 1] = last.slice(0, -1) + '"*';
  }
  return terms.join(" ") || `"${raw}"`;
}

// Query filler that poisons AND-of-every-token FTS: unicode61 indexes stopwords, so
// "most recent paypal statement" literally requires 'most' AND 'recent' in the
// document and returns zero (audit B1). Only consulted for FALLBACK forms after a
// zero-result primary pass, so stripping aggressively is safe — the ranker and the
// evidence gate bound whatever extra noise a looser form lets in.
const FTS_QUERY_STOPWORDS = new Set([
  "a", "about", "all", "am", "an", "and", "any", "are", "as", "at", "be", "been",
  "by", "can", "could", "did", "do", "does", "earliest", "email", "emails", "find",
  "first", "for", "from", "get", "had", "has", "have", "her", "his", "how", "i",
  "in", "is", "it", "its", "last", "latest", "look", "looking", "mail", "may", "me",
  "message", "messages", "might", "most", "must", "my", "new", "newest", "no", "not",
  "of", "old", "oldest", "on", "or", "our", "please", "recent", "recently", "search",
  "shall", "should", "show", "some", "that", "the", "their", "these", "this", "those",
  "to", "was", "were", "what", "whats", "when", "whens", "where", "which", "who",
  "why", "will", "with", "would", "your",
]);

// Progressively looser FTS forms for a query whose primary AND pass matched nothing:
// (1) the AND with filler stripped, prefix on the last token (mirrors sanitizeFtsQuery);
// (2) OR of the remaining tokens, each prefix-matched, so a single wrong token can no
// longer zero the whole lexical leg. Token split on non-alphanumerics also dissolves
// possessives ("paypal's" → paypal) that would otherwise become unmatchable phrases.
export function buildFtsFallbackQueries(raw) {
  const tokens = String(raw || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !FTS_QUERY_STOPWORDS.has(token));
  if (!tokens.length) return [];
  const quoted = tokens.map((token) => `"${token}"`);
  const strippedAnd = [...quoted.slice(0, -1), `${quoted[quoted.length - 1]}*`].join(" ");
  const anyToken = quoted.map((token) => `${token}*`).join(" OR ");
  return anyToken === strippedAnd ? [strippedAnd] : [strippedAnd, anyToken];
}

export function unsupportedSearchFlagError(flag) {
  const err = new Error(`Unsupported email search flag: ${flag}`);
  err.status = 400;
  err.code = "unsupported_email_search_flag";
  return err;
}

export function invalidSearchFlagError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "invalid_email_search_flags";
  return err;
}

export function parseEmailSearchQuery(raw) {
  const tokens = String(raw || "").trim().split(/\s+/).filter(Boolean);
  const textTokens = [];
  let readFilter = null;

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (normalized === "is:read" || normalized === "is:unread") {
      const nextReadFilter = normalized === "is:read" ? 1 : 0;
      if (readFilter != null && readFilter !== nextReadFilter) {
        throw invalidSearchFlagError("Conflicting email search flags: is:read and is:unread");
      }
      readFilter = nextReadFilter;
      continue;
    }
    if (/^is:[^\s]+$/i.test(token)) {
      throw unsupportedSearchFlagError(token);
    }
    textTokens.push(token);
  }

  return {
    textQuery: textTokens.join(" "),
    readFilter,
  };
}
