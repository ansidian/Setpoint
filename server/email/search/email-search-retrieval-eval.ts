import { searchEmails } from "../email-service.ts";
import { createEmailIndexTestDb, seedIndexedEmail } from "../test-utils/email-index-db.ts";
import {
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.ts";
import { createEmailSearchEmbeddingStore } from "./email-search-embedding-store.ts";
import { retrieveInboxAiSearch } from "./email-search-retrieval.ts";
import type { EmailSearchEmbeddingVectors } from "./email-search-embedding-client.ts";
import type { EmailSearchEmbeddingSourceRow } from "./email-search-embeddings.ts";
import type { Value } from "@libsql/client";

interface RetrievalEvalCase {
  id: string;
  query: string;
  expected_uids: string[];
  must_not_top: string[];
  top_n: number;
  inbox_path: boolean;
}

interface NormalizedRetrievalEvalFixture {
  version: unknown;
  cases: RetrievalEvalCase[];
}

interface EvalRetrievalEnvelope {
  candidates?: Array<{ uid: unknown }>;
}

type EvalRetriever = (userId: string, options: { q: string; limit: number }) => Promise<EvalRetrievalEnvelope>;

interface EvalOptions {
  retrieve: EvalRetriever;
  retrieveInbox?: EvalRetriever;
  userId?: string;
}

interface ScoredUids {
  passed: boolean;
  expectedHit: boolean;
  mustNotTopClear: boolean;
  topNUids: string[];
  expectedRank: number | null;
}

interface EvalResult {
  id: string;
  query: string;
  passed: boolean;
  expected_hit: boolean;
  must_not_top_clear: boolean;
  top_uids: string[];
  expected_rank: number | null;
  problems: string[];
  inbox_passed?: boolean;
  inbox_hit?: boolean;
  inbox_must_not_top_clear?: boolean;
  inbox_top_uids?: string[];
  inbox_expected_rank?: number | null;
  inbox_problems?: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function normalizeRetrievalEvalFixture(fixture: unknown = {}): NormalizedRetrievalEvalFixture {
  const fixtureRecord = asRecord(fixture);
  const cases = Array.isArray(fixture) ? fixture : Array.isArray(fixtureRecord.cases) ? fixtureRecord.cases : [];
  return {
    version: fixtureRecord.version || 1,
    cases: cases.map(asRecord).map((testCase) => ({
      id: String(testCase.id || testCase.query || ""),
      query: String(testCase.query || "").trim(),
      expected_uids: stringArray(testCase.expected_uids || testCase.expectedUids),
      must_not_top: stringArray(testCase.must_not_top || testCase.mustNotTop),
      top_n: Number.parseInt(String(testCase.top_n || testCase.topN || 3), 10) || 3,
      // audit F3: opt-in flag — cases lexically satisfiable without the vector
      // leg also run against the inbox searchEmails path (default false/absent
      // keeps embedding-dependent cases retrieval-only).
      inbox_path: testCase.inbox_path === true,
    })).filter((testCase) => testCase.id && testCase.query),
  };
}

// Shared hit/must-not-top/rank scoring for a single ranked-uid list, reused by
// both the retrieval path and the inbox path so the two can never silently
// diverge in what "pass" means.
function scoreRankedUids(rankedUids: string[], testCase: RetrievalEvalCase): ScoredUids {
  const topNUids = rankedUids.slice(0, testCase.top_n);
  const expectedHit = testCase.expected_uids.length === 0
    || testCase.expected_uids.some((uid) => topNUids.includes(uid));
  const mustNotTopClear = !testCase.must_not_top.includes(rankedUids[0]!);
  const expectedRanks = testCase.expected_uids
    .map((uid) => rankedUids.indexOf(uid))
    .filter((i) => i >= 0)
    .map((i) => i + 1);
  const expectedRank = expectedRanks.length ? Math.min(...expectedRanks) : null;
  return {
    passed: expectedHit && mustNotTopClear,
    expectedHit,
    mustNotTopClear,
    topNUids,
    expectedRank,
  };
}

function meanReciprocalRank(scoredResults: Array<{ expectedRank: number | null }>): number | null {
  return scoredResults.length
    ? scoredResults.reduce((sum, result) => sum + (result.expectedRank ? 1 / result.expectedRank : 0), 0)
      / scoredResults.length
    : null;
}

export async function evaluateRetrievalCases(fixture: unknown, {
  retrieve,
  retrieveInbox,
  userId = "eval-user",
}: EvalOptions): Promise<{ total: number; passed: number; failed: number; mrr: number | null; inbox_mrr?: number | null; results: EvalResult[] }> {
  const normalized = normalizeRetrievalEvalFixture(fixture);
  const results: EvalResult[] = [];
  const inboxScored: ScoredUids[] = [];

  for (const testCase of normalized.cases) {
    const retrieval = await retrieve(userId, {
      q: testCase.query,
      limit: Math.max(testCase.top_n, 10),
    });
    const rankedUids = (retrieval.candidates || []).map((candidate) => String(candidate.uid));
    const scored = scoreRankedUids(rankedUids, testCase);
    const problems: string[] = [];
    if (!scored.expectedHit) problems.push("expected_uid_not_in_top_n");
    if (!scored.mustNotTopClear) problems.push("must_not_top_ranked_too_high");

    const result: EvalResult = {
      id: testCase.id,
      query: testCase.query,
      passed: scored.passed,
      expected_hit: scored.expectedHit,
      must_not_top_clear: scored.mustNotTopClear,
      top_uids: scored.topNUids,
      // Rank-position metric (audit F3): the best (lowest 1-based) rank among the
      // expected UIDs anywhere in the full ranked list, not just within top_n — a
      // pass/fail gate alone can't distinguish "just missed the cutoff" from
      // "buried". null when none of the expected UIDs were retrieved at all.
      expected_rank: scored.expectedRank,
      problems,
    };

    if (testCase.inbox_path && retrieveInbox) {
      const inboxRetrieval = await retrieveInbox(userId, {
        q: testCase.query,
        limit: Math.max(testCase.top_n, 10),
      });
      const inboxRankedUids = (inboxRetrieval.candidates || []).map((candidate) => String(candidate.uid));
      const inboxScoredCase = scoreRankedUids(inboxRankedUids, testCase);
      const inboxProblems: string[] = [];
      if (!inboxScoredCase.expectedHit) inboxProblems.push("expected_uid_not_in_top_n");
      if (!inboxScoredCase.mustNotTopClear) inboxProblems.push("must_not_top_ranked_too_high");

      result.inbox_passed = inboxScoredCase.passed;
      result.inbox_hit = inboxScoredCase.expectedHit;
      result.inbox_must_not_top_clear = inboxScoredCase.mustNotTopClear;
      result.inbox_top_uids = inboxScoredCase.topNUids;
      result.inbox_expected_rank = inboxScoredCase.expectedRank;
      result.inbox_problems = inboxProblems;

      if (testCase.expected_uids.length > 0) inboxScored.push(inboxScoredCase);
    }

    results.push(result);
  }

  const passed = results.filter((result) => result.passed).length;
  const rankedForMrr = results.filter((_result, index) => normalized.cases[index]!.expected_uids.length > 0);
  const mrr = meanReciprocalRank(rankedForMrr.map((result) => ({ expectedRank: result.expected_rank })));
  const inboxMrr = inboxScored.length
    ? meanReciprocalRank(inboxScored.map((result) => ({ expectedRank: result.expectedRank })))
    : undefined;

  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    mrr,
    ...(inboxMrr !== undefined ? { inbox_mrr: inboxMrr } : {}),
    results,
  };
}

// Build a deterministic, self-contained retriever for a fixture that carries its
// own `corpus`. Seeds an in-memory index + embeddings, then returns a `retrieve`
// bound to a fake embedding client (per-case `query_embedding`). When every corpus
// row is embedded, coverage resolves to 1.0 (healthy corpus), so this exercises
// today's full-strength fusion — guarding against silent vector flattening.
export async function createSyntheticEvalRetriever(fixture: unknown, { userId = "eval-user" }: { userId?: string } = {}) {
  const fixtureRecord = asRecord(fixture);
  // Same migration subset as the retrieval test harness: core + embedding state.
  const db = await createEmailIndexTestDb({ extraMigrations: ["006_email_search_embedding_state.sql"] });
  const store = createEmailSearchEmbeddingStore(db, { mode: "fallback" });
  const corpus = Array.isArray(fixtureRecord.corpus) ? fixtureRecord.corpus.map(asRecord) : [];
  for (const entry of corpus) {
    const { triage, embedding, snapshot, ...email } = entry;
    const triageRow = asRecord(triage);
    const snapshotRow = asRecord(snapshot);
    const row = await seedIndexedEmail(db, {
      user_id: userId,
      body_snippet: email.body_text,
      ...email,
    } as Parameters<typeof seedIndexedEmail>[1]);
    let triageId = null;
    if (triage) {
      const result = await db.execute({
        sql: `INSERT INTO ea_email_triage
                (user_id, account_id, email_id, lane, category, urgency,
                 deadline_at, escalation_badge, bill_candidate_json, handled_at,
                 provider_state, updated_at, triage_status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), 'complete')`,
        args: [
          userId, row.account_id, row.uid, triageRow.lane ?? null, triageRow.category ?? null, triageRow.urgency ?? null,
          triageRow.deadline_at ?? null,
          triageRow.escalation_badge ?? null,
          triageRow.bill_candidate_json ?? null,
          triageRow.handled_at ?? null,
          triageRow.provider_state ?? "available",
          triageRow.updated_at ?? null,
        ] as unknown as Value[],
      });
      triageId = Number(result.lastInsertRowid);
    }
    // Snapshot overlay (audit F2): the retrieval SELECT's SNAPSHOT_JOIN reads
    // `ea_briefing_snapshot_items` joined through an `ea_briefing_snapshots` row with
    // status='active' (see RANKING_COLUMNS / SNAPSHOT_JOIN in email-search-retrieval.ts).
    // Only mirror the minimal rows the join needs — a real snapshot item requires a
    // triage_id FK, so a snapshot overlay implies a triage row even if the fixture
    // case didn't otherwise need one.
    if (snapshot) {
      if (triageId == null) {
        const triageResult = await db.execute({
          sql: `INSERT INTO ea_email_triage
                  (user_id, account_id, email_id, triage_status)
                VALUES (?, ?, ?, 'complete')`,
          args: [userId, row.account_id, row.uid],
        });
        triageId = Number(triageResult.lastInsertRowid);
      }
      const snapshotResult = await db.execute({
        sql: `INSERT INTO ea_briefing_snapshots
                (user_id, start_at, end_at, status)
              VALUES (?, ?, ?, 'active')`,
        args: [userId, row.email_date, row.email_date],
      });
      const snapshotId = Number(snapshotResult.lastInsertRowid);
      await db.execute({
        sql: `INSERT INTO ea_briefing_snapshot_items
                (snapshot_id, triage_id, user_id, account_id, email_id, lane_at_snapshot,
                 dismissed_from_today_at, provider_removed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          snapshotId, triageId, userId, row.account_id, row.uid,
          snapshotRow.lane_at_snapshot ?? "needs_attention",
          snapshotRow.dismissed_from_today_at ?? null,
          snapshotRow.provider_removed_at ?? null,
        ] as unknown as Value[],
      });
    }
    if (embedding) {
      const document = buildEmailSearchEmbeddingDocument(row as unknown as EmailSearchEmbeddingSourceRow);
      await store.upsertEmbedding({
        uid: row.uid,
        user_id: userId,
        account_id: row.account_id,
        document,
        source_hash: computeEmailSearchEmbeddingSourceHash(document),
        embedding: Array.isArray(embedding) ? embedding.map(Number) : [],
      });
    }
  }
  const cases = Array.isArray(fixtureRecord.cases) ? fixtureRecord.cases.map(asRecord) : [];
  const embeddingByQuery = new Map<string, number[]>(
    cases.map((testCase) => [String(testCase.query || ""), Array.isArray(testCase.query_embedding) ? testCase.query_embedding.map(Number) : [1, 0, 0, 0, 0, 0]]),
  );
  const retrieve: EvalRetriever = (_evalUserId, options) => retrieveInboxAiSearch(userId, {
    ...options,
    ...(typeof fixtureRecord.now === "string" || typeof fixtureRecord.now === "number" ? { now: fixtureRecord.now } : {}),
    dbClient: db,
    capability: { mode: "fallback" },
    embeddingClient: {
      embed: async (inputs) => {
        const [text] = inputs;
        return [embeddingByQuery.get(text || "") || [1, 0, 0, 0, 0, 0]] as EmailSearchEmbeddingVectors;
      },
    },
  });
  // Inbox path (audit F3): bound to the same seeded dbClient via the real
  // searchEmails service function (no vector leg — lexical FTS + ranking only).
  // Maps { results } to the { candidates } shape evaluateRetrievalCases expects.
  const retrieveInbox: EvalRetriever = async (_evalUserId, options) => {
    const { results } = await searchEmails(userId, { ...options, offset: 0, dbClient: db });
    return { candidates: results.map((r) => ({ uid: r.uid })) };
  };
  return { retrieve, retrieveInbox, cleanup: () => db.close?.() };
}
