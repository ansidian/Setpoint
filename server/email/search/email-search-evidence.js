const VECTOR_SEMANTIC_EVIDENCE_FLOOR = 0.32;
// Just under the hard floor, semantic similarity alone is not evidence — but paired
// with a real field-token hit it is (C5: the newest statement sat at 0.31 with a
// subject match and was dropped while a wrong-family 0.35 sibling was kept).
const VECTOR_NEAR_FLOOR = 0.28;
const LEXICAL_EVIDENCE_FLOOR = 0.3;

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "all",
  "and",
  "any",
  "are",
  "can",
  "for",
  "from",
  "have",
  "how",
  "into",
  "job",
  "last",
  "many",
  "my",
  "the",
  "this",
  "to",
  "week",
  "what",
  "when",
  "where",
  "with",
  "you",
  // Address-plumbing sub-tokens: splitting from_address into parts must never let
  // TLDs or no-reply scaffolding count as query evidence.
  "com",
  "net",
  "org",
  "www",
  "mail",
  "email",
  "noreply",
  "reply",
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

// The candidate text the gate may cite as evidence: header fields plus the visible
// body snippet — the anchor incident's disambiguating line ("Statement balance …
// due date") lived in the body, which the gate never read (C5).
function fieldText(candidate = {}) {
  return clean([
    candidate.subject,
    candidate.from?.name,
    candidate.from?.address,
    candidate.body_snippet,
  ].filter(Boolean).join(" "));
}

function tokensFromText(value) {
  const tokens = [];
  for (const raw of clean(value).split(/[^a-z0-9@._-]+/i)) {
    // Composite tokens (email addresses, domains, hyphenations) also emit their
    // parts: pre-audit "no-reply@chase.com" stayed ONE token, so the query term
    // "chase" could never match the sender that FTS itself matched on (C5).
    const parts = raw.split(/[@._-]+/);
    for (const part of (parts.length > 1 ? [raw, ...parts] : parts)) {
      const term = part.replace(/s$/, "");
      if (term.length >= 3 && !STOPWORDS.has(term)) tokens.push(term);
    }
  }
  return [...new Set(tokens)];
}

function queryTerms({ q, plan } = {}) {
  const text = [
    q,
    plan?.semantic_query,
    ...(Array.isArray(plan?.lexical_queries) ? plan.lexical_queries : []),
  ].map(clean).filter(Boolean).join(" ");
  return [...new Set(
    tokensFromText(text),
  )];
}

function plannedPhrases(plan = {}) {
  return [...new Set(
    (Array.isArray(plan?.lexical_queries) ? plan.lexical_queries : [])
      .map(clean)
      .filter((phrase) => phrase.length >= 3),
  )];
}

function hasPlannedPhraseEvidence(candidate, phrases) {
  if (!phrases.length) return false;
  const text = fieldText(candidate);
  return phrases.some((phrase) => text.includes(phrase));
}

// A term matches a field token exactly, or as a prefix when it is substantial
// (4+ chars) — mirroring the FTS prefix semantics that retrieved the candidate:
// "synchrony"* matches the synchronybank domain label, so the gate must too.
const PREFIX_MATCH_MIN_TERM_LENGTH = 4;

function fieldTokenMatchCount(candidate, terms) {
  if (!terms.length) return 0;
  const fieldTokens = tokensFromText(fieldText(candidate));
  const exact = new Set(fieldTokens);
  return terms.filter((term) => exact.has(term)
    || (term.length >= PREFIX_MATCH_MIN_TERM_LENGTH
      && fieldTokens.some((token) => token.startsWith(term)))).length;
}

export function filterEmailSearchCandidatesForEvidence(candidates, { q, plan } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const phrases = plannedPhrases(plan);
  const terms = queryTerms({ q, plan });
  if (!phrases.length && !terms.length) return list;

  return list.filter((candidate) => {
    if (Number(candidate?.scores?.vector || 0) >= VECTOR_SEMANTIC_EVIDENCE_FLOOR) return true;
    // The lexical floor treats "the FTS engine matched the planned keywords" as
    // evidence in itself. Rows retrieved by a loosened zero-result fallback pass
    // (stopword-stripped / OR-of-tokens) carry no such evidence — they must qualify
    // through the field/phrase/vector checks below like vector-only candidates.
    if (candidate?.provenance?.lexical && !candidate?.provenance?.lexical_fallback
      && Number(candidate?.scores?.lexical || 0) >= LEXICAL_EVIDENCE_FLOOR) return true;
    if (hasPlannedPhraseEvidence(candidate, phrases)) return true;
    const matches = fieldTokenMatchCount(candidate, terms);
    if (Number(candidate?.scores?.vector || 0) >= VECTOR_NEAR_FLOOR && matches >= 1) return true;
    return terms.length > 0 && matches >= Math.min(2, terms.length);
  });
}
