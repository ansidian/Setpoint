// bm25() weights per ea_email_fts column (uid, from_name, from_address, subject,
// body_snippet, body_text): subject dominates so a subject match cannot be buried by
// brand mentions in sender fields or term-dense bodies (prod: 13 from-field "paypal"
// hits outranked the subject-matching statement under unweighted bm25, which also
// exactly tied recurring statement twins).
export const EMAIL_SEARCH_BM25_RANK_SQL = "bm25(ea_email_fts, 0.0, 4.0, 4.0, 10.0, 3.0, 1.0)";

const MIN_VARIANT_TOKEN_LENGTH = 4;

// Query-side singular/plural expansion (audit B2). Deliberately NOT a porter
// tokenizer migration: prod FTS runs on Turso's hosted engine, and a one-shot
// FTS rebuild against an engine we can't test locally is the works-locally/
// breaks-prod class of change. Regular English noun inflection covers the
// measured corpus gap.
export function pluralVariants(token) {
  const t = String(token || "").toLowerCase();
  if (t.length < MIN_VARIANT_TOKEN_LENGTH || /[^a-z]/.test(t)) return [];
  if (t.endsWith("ies")) return [`${t.slice(0, -3)}y`];
  if (/(ses|xes|zes|ches|shes)$/.test(t)) return [t.slice(0, -2)];
  if (t.endsWith("ss")) return [];
  if (t.endsWith("s")) return [t.slice(0, -1)];
  if (t.endsWith("y") && !/[aeiou]y$/.test(t)) return [`${t.slice(0, -1)}ies`];
  return [`${t}s`];
}

const DATE_TOKEN_RE = /^(\d{1,2})([/-])(\d{1,2})(?:\2(\d{2,4}))?$/;

// Audit B5: in-body dates like "07/07/2026" tokenize (unicode61) into
// adjacent numeric tokens, so "7/7" can only match via an adjacency phrase
// with the same zero-padding. Expand date-shaped query tokens into padded
// and unpadded phrase variants.
export function dateTokenVariants(token) {
  const m = DATE_TOKEN_RE.exec(String(token || ""));
  if (!m) return [];
  const [, first, , second, year] = m;
  const pad = (n) => String(n).padStart(2, "0");
  const unpad = (n) => String(Number(n));
  const variants = [];
  for (const a of [...new Set([pad(first), unpad(first)])]) {
    for (const b of [...new Set([pad(second), unpad(second)])]) {
      const phrase = year ? `${a} ${b} ${year}` : `${a} ${b}`;
      if (!variants.includes(phrase)) variants.push(phrase);
    }
  }
  return variants;
}

export function sanitizeFtsQuery(raw) {
  const tokens = String(raw || "")
    .replace(/[\u201C\u201D]/g, '"')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return raw ? `"${raw}"` : "";
  // FTS5 only allows implicit-AND adjacency between bare phrases; a parenthesized
  // OR-group next to anything else (bare or grouped) is a syntax error and needs an
  // explicit AND (verified against the libsql fts5 parser used here and in prod).
  return tokens
    .map((token, i) => {
      const star = i === tokens.length - 1 ? "*" : "";
      const escaped = token.replace(/"/g, '""');
      const dates = dateTokenVariants(token);
      const forms = dates.length
        ? [`"${escaped}"${star}`, ...dates.map((p) => `"${p}"`)]
        : [`"${escaped}"${star}`, ...pluralVariants(escaped).map((v) => `"${v}"${star}`)];
      return forms.length === 1 ? forms[0] : `(${forms.join(" OR ")})`;
    })
    .join(" AND ");
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
  const strippedAndGroups = tokens.map((token, i) => {
    const star = i === tokens.length - 1 ? "*" : "";
    const forms = [`"${token}"${star}`, ...pluralVariants(token).map((v) => `"${v}"${star}`)];
    return forms.length === 1 ? forms[0] : `(${forms.join(" OR ")})`;
  });
  const strippedAnd = strippedAndGroups.join(" AND ");
  const quoted = tokens.map((token) => `"${token}"`);
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
