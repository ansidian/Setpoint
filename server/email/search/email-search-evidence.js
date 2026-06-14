const VECTOR_SEMANTIC_EVIDENCE_FLOOR = 0.32;
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
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function fieldText(candidate = {}) {
  return clean([
    candidate.subject,
    candidate.from?.name,
    candidate.from?.address,
  ].filter(Boolean).join(" "));
}

function tokensFromText(value) {
  return clean(value)
    .split(/[^a-z0-9@._-]+/i)
    .map((term) => term.replace(/s$/, ""))
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term));
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

function hasSubjectOrSenderEvidence(candidate, terms) {
  if (!terms.length) return false;
  const fieldTokens = new Set(tokensFromText(fieldText(candidate)));
  const matched = terms.filter((term) => fieldTokens.has(term));
  return matched.length >= Math.min(2, terms.length);
}

export function filterEmailSearchCandidatesForEvidence(candidates, { q, plan } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const phrases = plannedPhrases(plan);
  const terms = queryTerms({ q, plan });
  if (!phrases.length && !terms.length) return list;

  return list.filter((candidate) => {
    if (Number(candidate?.scores?.vector || 0) >= VECTOR_SEMANTIC_EVIDENCE_FLOOR) return true;
    if (candidate?.provenance?.lexical
      && Number(candidate?.scores?.lexical || 0) >= LEXICAL_EVIDENCE_FLOOR) return true;
    if (hasPlannedPhraseEvidence(candidate, phrases)) return true;
    return hasSubjectOrSenderEvidence(candidate, terms);
  });
}
