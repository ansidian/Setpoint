import db from "../../db/connection.ts";
import { createEmailSearchEmbeddingClient } from "./email-search-embedding-client.ts";
import { resolveEmailSearchDateWindow } from "./email-search-date-window.ts";
import {
  createEmailSearchEmbeddingStore,
  detectEmailSearchVectorCapability,
} from "./email-search-embedding-store.ts";
import { getEmailSearchEmbeddingCoverageRatio } from "./email-search-embedding-worker.ts";
import { filterEmailSearchCandidatesForEvidence } from "./email-search-evidence.ts";
import {
  loadEmailSearchLexicalRows,
  loadEmailSearchRowsByUid,
} from "./email-search-lexical-retrieval.ts";
import { parseEmailSearchQuery } from "./email-search-query.ts";
import { hasJsonPayload, rankEmailSearchRows } from "./email-search-ranking.ts";
import { recordEmailSearchAiUsage, estimateTokensFromText } from "./email-search-cost-stats.ts";
import { EMAIL_SEARCH_EMBEDDING_MODEL } from "./email-search-embeddings.ts";
import type { Client } from "@libsql/client";
import type { EmailSearchEmbeddingClient } from "./email-search-embedding-client.ts";
import type { EmailSearchDateWindow } from "./email-search-date-window.ts";
import type { EmailSearchVectorCapability, EmailSearchVectorMatch } from "./email-search-embedding-store.ts";
import type { EmailSearchDbRow } from "./email-search-lexical-retrieval.ts";

export interface EmailSearchRetrievalPlan extends Record<string, unknown> {
  semantic_query?: string;
  lexical_queries?: string[];
  sender_domains?: string[];
  intents?: string[];
  urgency?: string[];
  read_filter?: "read" | "unread" | string;
  date_window?: EmailSearchDateWindow | null;
}

interface EmailSearchCandidateBase extends Record<string, unknown> {
  uid: string;
  subject: unknown;
  body_snippet: unknown;
  body_excerpt: string;
  email_date: unknown;
  email_date_utc: unknown;
  read: boolean;
  thread_id: unknown;
  from: { name: unknown; address: unknown };
  account: { id: unknown; label: unknown; email: unknown; color: unknown; icon: unknown };
  metadata: {
    lane: unknown;
    category: unknown;
    urgency: unknown;
    deadline_at: unknown;
    escalation_badge: unknown;
    bill_candidate: boolean;
    handled: boolean;
    provider_removed: boolean;
  };
}

export interface EmailSearchCandidate extends EmailSearchCandidateBase {
  provenance: { lexical: boolean; vector: boolean; lexical_fallback?: true };
  scores: { lexical: number; vector: number; combined: number };
}

export interface EmailSearchRetrievalEnvelope {
  mode: "hybrid" | "lexical";
  query: unknown;
  parsed_query: {
    text: string;
    read_filter: 0 | 1 | null;
    date_window: EmailSearchDateWindow | null;
    planned: boolean;
  };
  lexical: { status: "ok"; count: number };
  vector: { status: string; count: number; error_class?: string };
  total: number;
  offset: number;
  has_more: boolean;
  capped: boolean;
  candidates: EmailSearchCandidate[];
}

export interface RetrievalOptions {
  q?: unknown;
  limit?: string | number;
  offset?: string | number;
  dbClient?: Client;
  embeddingClient?: EmailSearchEmbeddingClient;
  recordUsage?: typeof recordEmailSearchAiUsage;
  capability?: EmailSearchVectorCapability | { mode: string } | null;
  coverageRatio?: number | null;
  plan?: EmailSearchRetrievalPlan | null;
  now?: string | number;
}

interface MergeCandidatesOptions {
  lexicalRows: EmailSearchDbRow[];
  vectorMatches: EmailSearchVectorMatch[];
  vectorRows: EmailSearchDbRow[];
  limit: number;
  coverageRatio?: number;
}

function errorFields(error: unknown): { status?: number; code?: string; name?: string } {
  if (!error || typeof error !== "object") return {};
  const value = error as Record<string, unknown>;
  return {
    ...(typeof value.status === "number" ? { status: value.status } : {}),
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
  };
}

const DEFAULT_LIMIT = 12;
const LEXICAL_FUSION_WEIGHT = 0.45;
const VECTOR_FUSION_WEIGHT = 0.55;
// Hard ceiling on the rankable pool the model can page through before it must
// narrow the query. Bounds tool-result/context cost while comfortably covering
// realistic "exhaust this set" cases (e.g. ~89 matches).
const MAX_RETRIEVAL_POOL = 200;

function clampLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, 50);
}

function clampOffset(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_RETRIEVAL_POOL - 1);
}

function bounded(value: unknown, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

// The lexical/quality component for fusion: scoreEmailSearchRow's output (a points total
// that can go negative under noise/provider_removed penalties) normalized into the fusion
// band [-1, 1]. Lexical and vector-only rows are both pre-scored, so both derive it the
// same way — keep this single source of truth so the two fusion branches can't drift.
function lexicalScoreFromRow(row: EmailSearchDbRow): number {
  return bounded(Number(row.search_score || 0) / 100, -1, 1);
}

function candidateDateMs(candidate: EmailSearchCandidate): number {
  const ms = Date.parse(String(candidate.email_date_utc || candidate.email_date || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function candidateFamilyKey(candidate: EmailSearchCandidate): string | null {
  const from = String(candidate.from?.address || "").toLowerCase().trim();
  const subject = String(candidate.subject || "").toLowerCase().trim();
  if (!from || !subject) return null;
  return `${from}|${subject}`;
}

function candidateThreadKey(candidate: EmailSearchCandidate): string | null {
  const thread = String(candidate.thread_id || "").trim();
  return thread || null;
}

function candidatePenalized(candidate: EmailSearchCandidate): boolean {
  return candidate.metadata?.lane === "noise" || Boolean(candidate.metadata?.provider_removed);
}

// Fused-level mirror of applyRecencyDominance (email-search-ranking.ts): the
// per-pool clamp cannot see a recurring family (or reply thread) whose siblings arrive
// via different retrieval legs (newest lexical-only, older vector-only), and
// vector-similarity epsilon between near-identical recurring bodies would re-split an
// exact score tie before the date tiebreak fires. Clamping the fused score keeps
// families/threads newest-first regardless of which leg surfaced each sibling.
function applyRecencyDominanceToCandidates(candidates: EmailSearchCandidate[], keyOf: (candidate: EmailSearchCandidate) => string | null): EmailSearchCandidate[] {
  const groups = new Map<string, EmailSearchCandidate[]>();
  for (const candidate of candidates) {
    const key = keyOf(candidate);
    if (!key) continue;
    const members = groups.get(key);
    if (members) members.push(candidate);
    else groups.set(key, [candidate]);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const newest = members.reduce((best, candidate) => (
      candidateDateMs(candidate) > candidateDateMs(best) ? candidate : best
    ));
    if (candidatePenalized(newest) || newest.scores.combined < 0) continue;
    for (const candidate of members) {
      if (candidate === newest || candidate.scores.combined <= newest.scores.combined) continue;
      candidate.scores.combined = newest.scores.combined;
    }
  }
  return candidates;
}

function applyFamilyDominanceToCandidates(candidates: EmailSearchCandidate[]): EmailSearchCandidate[] {
  applyRecencyDominanceToCandidates(candidates, candidateFamilyKey);
  return applyRecencyDominanceToCandidates(candidates, candidateThreadKey);
}

function readFilterFromPlan(plan: EmailSearchRetrievalPlan | null | undefined): 0 | 1 | null {
  if (plan?.read_filter === "read") return 1;
  if (plan?.read_filter === "unread") return 0;
  return null;
}

function metadataFromRow(row: EmailSearchDbRow): EmailSearchCandidate["metadata"] {
  return {
    lane: row.snapshot_lane || row.triage_lane || "untriaged",
    category: row.snapshot_category || row.triage_category || "uncategorized",
    urgency: row.snapshot_urgency || row.triage_urgency || "normal",
    deadline_at: row.snapshot_deadline_at || row.triage_deadline_at || null,
    escalation_badge: row.snapshot_escalation_badge || row.triage_escalation_badge || null,
    bill_candidate: hasJsonPayload(row.triage_bill_candidate_json),
    handled: Boolean(row.snapshot_handled_at || row.triage_handled_at),
    provider_removed: Boolean(row.snapshot_provider_removed_at),
  };
}

function candidateFromRow(row: EmailSearchDbRow): EmailSearchCandidateBase {
  return {
    uid: row.uid,
    subject: row.subject,
    body_snippet: row.body_snippet,
    body_excerpt: String(row.body_text || "").slice(0, 1200),
    email_date: row.email_date,
    email_date_utc: row.email_date_utc || null,
    read: !!row.read,
    thread_id: row.thread_id || null,
    from: {
      name: row.from_name,
      address: row.from_address,
    },
    account: {
      id: row.account_id,
      label: row.account_label,
      email: row.account_email,
      color: row.account_color,
      icon: row.account_icon,
    },
    metadata: metadataFromRow(row),
  };
}

// Fusion is coverage-aware: the vector coefficient is scaled by the fraction of the
// corpus that is actually embedded. At coverage 1.0 this is exactly the prior formula
// (so the vector signal is not flattened on a fully-embedded corpus). The scaling is
// continuous and linear, so a near-complete inbox (a few in-flight embeds) is
// down-weighted only negligibly, while genuinely partial coverage (dev freeze, prod
// backfill/outage lag) shrinks the vector term toward lexical so a fresh strong-lexical
// email is no longer structurally displaced by a stale embedded one. Lexical
// coefficients are deliberately untouched.
export function mergeCandidates({ lexicalRows, vectorMatches, vectorRows, limit, coverageRatio = 1 }: MergeCandidatesOptions): EmailSearchCandidate[] {
  const coverageFactor = bounded(coverageRatio, 0, 1);
  const effectiveVectorWeight = VECTOR_FUSION_WEIGHT * coverageFactor;
  const byUid = new Map<string, EmailSearchCandidate>();
  const vectorScoreByUid = new Map(vectorMatches.map((match) => [String(match.uid), bounded(match.similarity)]));

  for (const row of lexicalRows) {
    const lexicalScore = lexicalScoreFromRow(row);
    byUid.set(row.uid, {
      ...candidateFromRow(row),
      // lexical_fallback only appears when true, so primary-pass provenance keeps
      // its exact two-key shape.
      provenance: { lexical: true, vector: false, ...(row.lexical_fallback ? { lexical_fallback: true } : {}) },
      scores: {
        lexical: lexicalScore,
        vector: 0,
        combined: lexicalScore,
      },
    });
  }

  for (const row of vectorRows) {
    const existing = byUid.get(row.uid);
    const vectorScore = vectorScoreByUid.get(row.uid) || 0;
    if (existing) {
      existing.provenance.vector = true;
      existing.scores.vector = vectorScore;
      existing.scores.combined = bounded((existing.scores.lexical * LEXICAL_FUSION_WEIGHT) + (vectorScore * effectiveVectorWeight), -1, 1);
      continue;
    }
    // Vector-only rows are pre-scored through scoreEmailSearchRow (via rankEmailSearchRows
    // in the retrieval layer), so their search_score carries the same quality/recency
    // penalties as lexical rows — noise lane, provider_removed, dismissed, stale recency.
    // Fuse that quality component with the vector term so a high-similarity noise/removed
    // email can no longer surface as a top vector-only candidate unpenalized. provenance
    // stays vector-only (it did not match FTS); only the ranking score changes.
    const lexicalScore = lexicalScoreFromRow(row);
    byUid.set(row.uid, {
      ...candidateFromRow(row),
      provenance: { lexical: false, vector: true },
      scores: {
        lexical: lexicalScore,
        vector: vectorScore,
        combined: bounded((lexicalScore * LEXICAL_FUSION_WEIGHT) + (vectorScore * effectiveVectorWeight), -1, 1),
      },
    });
  }

  return applyFamilyDominanceToCandidates([...byUid.values()])
    .sort((a, b) => {
      if (b.scores.combined !== a.scores.combined) return b.scores.combined - a.scores.combined;
      // Recency breaks fused-score ties (recurring twins often tie exactly) so the
      // newest copy wins; uid only stabilizes genuinely identical rows.
      const dateDiff = candidateDateMs(b) - candidateDateMs(a);
      if (dateDiff) return dateDiff;
      return String(a.uid).localeCompare(String(b.uid));
    })
    .slice(0, limit);
}

// Resolve the embedding coverage factor for fusion. Any failure or "nothing indexed"
// defaults to full trust (1) so the coverage-aware down-weighting only ever activates
// when coverage is positively measured low — the default path stays today's behavior.
async function resolveEmbeddingCoverage(userId: string, dbClient: Client): Promise<number> {
  try {
    const ratio = await getEmailSearchEmbeddingCoverageRatio(userId, { dbClient });
    return ratio == null ? 1 : bounded(ratio, 0, 1);
  } catch {
    return 1;
  }
}

export async function retrieveInboxAiSearch(userId: string, {
  q,
  limit = DEFAULT_LIMIT,
  offset = 0,
  dbClient = db,
  embeddingClient = createEmailSearchEmbeddingClient(),
  recordUsage = recordEmailSearchAiUsage,
  capability = null,
  coverageRatio = null,
  plan = null,
  now = Date.now(),
}: RetrievalOptions = {}): Promise<EmailSearchRetrievalEnvelope> {
  const maxResults = clampLimit(limit);
  const start = clampOffset(offset);
  const { textQuery: rawTextQuery, readFilter: explicitReadFilter } = parseEmailSearchQuery(q);
  const dateWindow = resolveEmailSearchDateWindow(q, plan?.date_window, { now });
  const effectivePlan = plan || dateWindow ? {
    ...(plan || {}),
    date_window: dateWindow,
  } : null;
  const planReadFilter = readFilterFromPlan(plan);
  const readFilter = explicitReadFilter == null ? planReadFilter : explicitReadFilter;
  const plannedLexicalQueries = (Array.isArray(plan?.lexical_queries) ? plan.lexical_queries : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const textQuery = plannedLexicalQueries[0] || plan?.semantic_query || rawTextQuery;
  const textQueries = plannedLexicalQueries.length ? plannedLexicalQueries : [textQuery];
  const vectorQuery = String(plan?.semantic_query || rawTextQuery || "");
  const capabilityValue = capability || await detectEmailSearchVectorCapability(dbClient);
  const resolvedCapability: EmailSearchVectorCapability = capabilityValue.mode === "native"
    ? { ...capabilityValue, mode: "native" }
    : { ...capabilityValue, mode: "fallback" };
  // Sizing is INDEPENDENT of offset so `total`/`has_more`/`capped` and the page
  // ordering stay stable across paged calls of the same query. Fetch sizes match the
  // pre-pagination defaults (a default offset-0 call returns the same top rows); only
  // the merged-pool cap is widened to MAX_RETRIEVAL_POOL so the model can page through
  // one ranked list instead of re-sampling the top.
  const lexicalFetchLimit = Math.min(Math.max(maxResults * 8, 100), 500);
  const vectorLimit = effectivePlan?.date_window?.after || effectivePlan?.date_window?.before
    ? 100
    : Math.max(maxResults * 2, 20);
  const candidatePoolLimit = MAX_RETRIEVAL_POOL;

  const lexicalPromise = loadEmailSearchLexicalRows(dbClient, userId, {
    textQueries,
    fallbackQuery: vectorQuery,
    readFilter,
    plan: effectivePlan,
    limit: maxResults,
    now,
  });
  const vectorPromise: Promise<{ status: string; matches: EmailSearchVectorMatch[]; error_class?: string }> = (async () => {
    if (!vectorQuery.trim()) return { status: "skipped", matches: [] };
    try {
      const [queryEmbedding] = await embeddingClient.embed([vectorQuery]);
      // Cost visibility (email/search area rule): every embedding API call reports
      // through email-search-cost-stats. Fire-and-forget — a recording failure must
      // never break search. Alfred is the planner now, so this is the only live
      // per-query model cost in the search path.
      recordUsage(userId, {
        dbClient,
        eventType: "query_embedding",
        model: EMAIL_SEARCH_EMBEDDING_MODEL,
        usage: { input_tokens: estimateTokensFromText(vectorQuery) },
        estimated: true,
      }).catch(() => {});
      const store = createEmailSearchEmbeddingStore(dbClient, resolvedCapability);
      const matches = await store.querySimilarEmbeddings(userId, queryEmbedding!, {
        limit: vectorLimit,
        readFilter,
        dateWindow: effectivePlan?.date_window,
      });
      return { status: "ok", matches };
    } catch (err) {
      const fields = errorFields(err);
      const unavailable = fields.status === 503 || fields.code === "email_search_embeddings_unavailable";
      return {
        status: unavailable ? "unavailable" : "error",
        matches: [],
        error_class: fields.code || fields.name || "email_search_vector_error",
      };
    }
  })();

  // Coverage depends only on userId/dbClient, so resolve it alongside lexical/vector
  // rather than as an extra serial round-trip on the hot path.
  const coveragePromise = coverageRatio != null
    ? Promise.resolve(bounded(coverageRatio, 0, 1))
    : resolveEmbeddingCoverage(userId, dbClient);
  const [lexicalRows, vector, resolvedCoverage] = await Promise.all([lexicalPromise, vectorPromise, coveragePromise]);
  const vectorRows = await loadEmailSearchRowsByUid(dbClient, userId, vector.matches.map((match) => String(match.uid)), { readFilter, plan: effectivePlan });
  // Pre-score the vector rows through the SAME ranking pass as the lexical rows so the
  // lexical/quality component (noise/provider_removed penalties, recency) is computed
  // uniformly for every candidate. mergeCandidates then fuses search_score with the
  // vector term for vector-only rows instead of treating them as quality-neutral. limit
  // is the row count so ranking only scores+attaches; the merged pool does the ordering.
  const scoredVectorRows = rankEmailSearchRows(vectorRows, {
    query: textQuery,
    limit: vectorRows.length,
    now,
    debug: true,
  });
  const candidatePool = mergeCandidates({
    lexicalRows,
    vectorMatches: vector.matches,
    vectorRows: scoredVectorRows,
    limit: candidatePoolLimit,
    coverageRatio: resolvedCoverage,
  });
  const filtered = filterEmailSearchCandidatesForEvidence(candidatePool, { q, plan: effectivePlan });
  // `total` is the retrievable count for this query within the rankable pool (stable
  // across pages because sizing is offset-independent). `candidates` is the requested page.
  const total = filtered.length;
  const candidates = filtered.slice(start, start + maxResults);
  // The result set exceeds what we ranked here (FTS keyword matches hit the fetch
  // ceiling, or the merged pool filled MAX_RETRIEVAL_POOL): `total` is then a lower
  // bound and the model should narrow rather than assume it has seen everything.
  const capped = lexicalRows.length >= lexicalFetchLimit || candidatePool.length >= MAX_RETRIEVAL_POOL;

  return {
    mode: vector.status === "ok" && vector.matches.length ? "hybrid" : "lexical",
    query: q,
    parsed_query: {
      text: textQuery,
      read_filter: readFilter,
      date_window: effectivePlan?.date_window || null,
      planned: !!plan,
    },
    lexical: {
      status: "ok",
      count: lexicalRows.length,
    },
    vector: {
      status: vector.status,
      count: vector.matches.length,
      error_class: vector.error_class,
    },
    total,
    offset: start,
    has_more: start + maxResults < total,
    capped,
    candidates,
  };
}
