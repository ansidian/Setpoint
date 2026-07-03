import { searchEmails } from "../email-service.js";
import { createEmailIndexTestDb, seedIndexedEmail } from "../test-utils/email-index-db.js";
import {
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.js";
import { createEmailSearchEmbeddingStore } from "./email-search-embedding-store.js";
import { retrieveInboxAiSearch } from "./email-search-retrieval.js";

export function normalizeRetrievalEvalFixture(fixture = {}) {
  const cases = Array.isArray(fixture) ? fixture : fixture.cases || [];
  return {
    version: fixture.version || 1,
    cases: cases.map((testCase) => ({
      id: testCase.id || testCase.query,
      query: String(testCase.query || "").trim(),
      expected_uids: [...(testCase.expected_uids || testCase.expectedUids || [])],
      must_not_top: [...(testCase.must_not_top || testCase.mustNotTop || [])],
      top_n: Number.parseInt(testCase.top_n || testCase.topN || 3, 10) || 3,
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
function scoreRankedUids(rankedUids, testCase) {
  const topNUids = rankedUids.slice(0, testCase.top_n);
  const expectedHit = testCase.expected_uids.length === 0
    || testCase.expected_uids.some((uid) => topNUids.includes(uid));
  const mustNotTopClear = !testCase.must_not_top.includes(rankedUids[0]);
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

function meanReciprocalRank(scoredResults) {
  return scoredResults.length
    ? scoredResults.reduce((sum, result) => sum + (result.expectedRank ? 1 / result.expectedRank : 0), 0)
      / scoredResults.length
    : null;
}

export async function evaluateRetrievalCases(fixture, {
  retrieve,
  retrieveInbox,
  userId = "eval-user",
} = {}) {
  const normalized = normalizeRetrievalEvalFixture(fixture);
  const results = [];
  const inboxScored = [];

  for (const testCase of normalized.cases) {
    const retrieval = await retrieve(userId, {
      q: testCase.query,
      limit: Math.max(testCase.top_n, 10),
    });
    const rankedUids = (retrieval.candidates || []).map((candidate) => candidate.uid);
    const scored = scoreRankedUids(rankedUids, testCase);
    const problems = [];
    if (!scored.expectedHit) problems.push("expected_uid_not_in_top_n");
    if (!scored.mustNotTopClear) problems.push("must_not_top_ranked_too_high");

    const result = {
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
      const inboxRankedUids = (inboxRetrieval.candidates || []).map((candidate) => candidate.uid);
      const inboxScoredCase = scoreRankedUids(inboxRankedUids, testCase);
      const inboxProblems = [];
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
  const rankedForMrr = results.filter((result, index) => normalized.cases[index].expected_uids.length > 0);
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
export async function createSyntheticEvalRetriever(fixture, { userId = "eval-user" } = {}) {
  // Same migration subset as the retrieval test harness: core + embedding state.
  const db = await createEmailIndexTestDb({ extraMigrations: ["006_email_search_embedding_state.sql"] });
  const store = createEmailSearchEmbeddingStore(db, { mode: "fallback" });
  for (const entry of fixture.corpus || []) {
    const { triage, embedding, snapshot, ...email } = entry;
    const row = await seedIndexedEmail(db, {
      user_id: userId,
      body_snippet: email.body_text,
      ...email,
    });
    let triageId = null;
    if (triage) {
      const result = await db.execute({
        sql: `INSERT INTO ea_email_triage
                (user_id, account_id, email_id, lane, category, urgency,
                 deadline_at, escalation_badge, bill_candidate_json, handled_at,
                 provider_state, updated_at, triage_status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), 'complete')`,
        args: [
          userId, row.account_id, row.uid, triage.lane, triage.category, triage.urgency,
          triage.deadline_at ?? null,
          triage.escalation_badge ?? null,
          triage.bill_candidate_json ?? null,
          triage.handled_at ?? null,
          triage.provider_state ?? "available",
          triage.updated_at ?? null,
        ],
      });
      triageId = Number(result.lastInsertRowid);
    }
    // Snapshot overlay (audit F2): the retrieval SELECT's SNAPSHOT_JOIN reads
    // `ea_briefing_snapshot_items` joined through an `ea_briefing_snapshots` row with
    // status='active' (see RANKING_COLUMNS / SNAPSHOT_JOIN in email-search-retrieval.js).
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
          snapshot.lane_at_snapshot ?? "needs_attention",
          snapshot.dismissed_from_today_at ?? null,
          snapshot.provider_removed_at ?? null,
        ],
      });
    }
    if (embedding) {
      const document = buildEmailSearchEmbeddingDocument(row);
      await store.upsertEmbedding({
        uid: row.uid,
        user_id: userId,
        account_id: row.account_id,
        document,
        source_hash: computeEmailSearchEmbeddingSourceHash(document),
        embedding,
      });
    }
  }
  const embeddingByQuery = new Map(
    (fixture.cases || []).map((testCase) => [testCase.query, testCase.query_embedding || [1, 0, 0, 0, 0, 0]]),
  );
  const retrieve = (_evalUserId, options) => retrieveInboxAiSearch(userId, {
    ...options,
    ...(fixture.now ? { now: fixture.now } : {}),
    dbClient: db,
    capability: { mode: "fallback" },
    embeddingClient: {
      embed: async ([text]) => [embeddingByQuery.get(text) || [1, 0, 0, 0, 0, 0]],
    },
  });
  // Inbox path (audit F3): bound to the same seeded dbClient via the real
  // searchEmails service function (no vector leg — lexical FTS + ranking only).
  // Maps { results } to the { candidates } shape evaluateRetrievalCases expects.
  const retrieveInbox = async (_evalUserId, options) => {
    const { results } = await searchEmails(userId, { ...options, dbClient: db });
    return { candidates: results.map((r) => ({ uid: r.uid })) };
  };
  return { retrieve, retrieveInbox, cleanup: () => db.close?.() };
}
