import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { join } from "path";
import { seedIndexedEmail } from "../test-utils/email-index-db.js";
import {
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.js";
import { createEmailSearchEmbeddingStore } from "./email-search-embedding-store.js";
import { retrieveInboxAiSearch } from "./email-search-retrieval.js";

// Migration subset needed to seed an indexed-email + embeddings corpus in memory
// (mirrors the retrieval test harness).
const EVAL_MIGRATIONS = [
  "001_ea_tables.sql",
  "004_email_read_state_search_index.sql",
  "005_email_search_embeddings.sql",
  "006_email_search_embedding_state.sql",
  "013_email_index_normalized_date.sql",
];

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
    })).filter((testCase) => testCase.id && testCase.query),
  };
}

export async function evaluateRetrievalCases(fixture, {
  retrieve,
  userId = "eval-user",
} = {}) {
  const normalized = normalizeRetrievalEvalFixture(fixture);
  const results = [];

  for (const testCase of normalized.cases) {
    const retrieval = await retrieve(userId, {
      q: testCase.query,
      limit: Math.max(testCase.top_n, 10),
    });
    const rankedUids = (retrieval.candidates || []).map((candidate) => candidate.uid);
    const topNUids = rankedUids.slice(0, testCase.top_n);
    const expectedHit = testCase.expected_uids.length === 0
      || testCase.expected_uids.some((uid) => topNUids.includes(uid));
    const mustNotTopClear = !testCase.must_not_top.includes(rankedUids[0]);
    const problems = [];
    if (!expectedHit) problems.push("expected_uid_not_in_top_n");
    if (!mustNotTopClear) problems.push("must_not_top_ranked_too_high");
    results.push({
      id: testCase.id,
      query: testCase.query,
      passed: expectedHit && mustNotTopClear,
      expected_hit: expectedHit,
      must_not_top_clear: mustNotTopClear,
      top_uids: topNUids,
      problems,
    });
  }

  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

// Build a deterministic, self-contained retriever for a fixture that carries its
// own `corpus`. Seeds an in-memory index + embeddings, then returns a `retrieve`
// bound to a fake embedding client (per-case `query_embedding`). When every corpus
// row is embedded, coverage resolves to 1.0 (healthy corpus), so this exercises
// today's full-strength fusion — guarding against silent vector flattening.
export async function createSyntheticEvalRetriever(fixture, { migrationsDir, userId = "eval-user" } = {}) {
  const db = createClient({ url: "file::memory:" });
  for (const file of EVAL_MIGRATIONS) {
    await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
  }
  const store = createEmailSearchEmbeddingStore(db, { mode: "fallback" });
  for (const entry of fixture.corpus || []) {
    const { triage, embedding, ...email } = entry;
    const row = await seedIndexedEmail(db, {
      user_id: userId,
      body_snippet: email.body_text,
      ...email,
    });
    if (triage) {
      await db.execute({
        sql: `INSERT INTO ea_email_triage
                (user_id, account_id, email_id, lane, category, urgency, triage_status)
              VALUES (?, ?, ?, ?, ?, ?, 'complete')`,
        args: [userId, row.account_id, row.uid, triage.lane, triage.category, triage.urgency],
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
    (fixture.cases || []).map((testCase) => [testCase.query, testCase.query_embedding || [1, 0, 0, 0]]),
  );
  const retrieve = (_evalUserId, options) => retrieveInboxAiSearch(userId, {
    ...options,
    ...(fixture.now ? { now: fixture.now } : {}),
    dbClient: db,
    capability: { mode: "fallback" },
    embeddingClient: {
      embed: async ([text]) => [embeddingByQuery.get(text) || [1, 0, 0, 0]],
    },
  });
  return { retrieve, cleanup: () => db.close?.() };
}
