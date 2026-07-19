import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.ts";
import { createEmailSearchEmbeddingStore } from "./email-search-embedding-store.ts";
import { createEmailIndexTestDb, seedIndexedEmail } from "../test-utils/email-index-db.ts";
import { retrieveInboxAiSearch } from "./email-search-retrieval.ts";
import type { recordEmailSearchAiUsage } from "./email-search-cost-stats.ts";
import type { EmailSearchEmbeddingSourceRow } from "./email-search-embeddings.ts";
import type { EmailSearchRankingRow } from "./email-search-ranking.ts";

type RetrievalTestDb = Awaited<ReturnType<typeof createRetrievalTestDb>>;
type SeedIndexedEmailRow = Awaited<ReturnType<typeof seedIndexedEmail>>;

function createRetrievalTestDb() {
  // Embedding state powers the coverage/staleness reads; no AI-usage table.
  return createEmailIndexTestDb({ extraMigrations: ["006_email_search_embedding_state.sql"] });
}

async function upsertEmbedding(db: RetrievalTestDb, row: SeedIndexedEmailRow, embedding: number[]): Promise<void> {
  const store = createEmailSearchEmbeddingStore(db, { mode: "fallback" });
  const document = buildEmailSearchEmbeddingDocument(row as unknown as EmailSearchEmbeddingSourceRow);
  await store.upsertEmbedding({
    uid: row.uid,
    user_id: row.user_id,
    account_id: row.account_id,
    document,
    source_hash: computeEmailSearchEmbeddingSourceHash(document),
    embedding,
  });
}

describe("retrieveInboxAiSearch", () => {
  let db: RetrievalTestDb | null = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("merges lexical and vector candidates with deduped provenance and metadata", async () => {
    db = await createRetrievalTestDb();
    const active = await seedIndexedEmail(db, {
      uid: "active-return",
      subject: "Amazon return drop off deadline",
      body_text: "Return request still needs drop off",
      email_date: "2026-05-01T12:00:00Z",
    });
    const semantic = await seedIndexedEmail(db, {
      uid: "semantic-return",
      subject: "UPS store QR code",
      body_text: "Bring this code to drop off your return",
      email_date: "2026-04-28T12:00:00Z",
    });
    await upsertEmbedding(db, active, [1, 0, 0]);
    await upsertEmbedding(db, semantic, [0.9, 0.1, 0]);
    await db.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, triage_status)
            VALUES (?, ?, ?, 'needs_attention', 'delivery', 'high', 'complete')`,
      args: ["user-1", "gmail-work", "active-return"],
    });

    const result = await retrieveInboxAiSearch("user-1", {
      q: "amazon return drop off",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      limit: 5,
    });

    expect(result.mode).toBe("hybrid");
    expect(result.vector.status).toBe("ok");
    expect(result.lexical.status).toBe("ok");
    expect(result.candidates.map((candidate) => candidate.uid)).toContain("active-return");
    expect(result.candidates.map((candidate) => candidate.uid)).toContain("semantic-return");
    const activeCandidate = result.candidates.find((candidate) => candidate.uid === "active-return");
    expect(activeCandidate).toMatchObject({
      provenance: {
        lexical: true,
        vector: true,
      },
      scores: {
        lexical: expect.any(Number),
        vector: expect.any(Number),
        combined: expect.any(Number),
      },
      metadata: {
        lane: "needs_attention",
        category: "delivery",
        urgency: "high",
      },
      account: {
        id: "gmail-work",
        label: "Work",
      },
    });
  });

  it("exposes bill_candidate in candidate metadata so the tool layer can surface it", async () => {
    db = await createRetrievalTestDb();
    await seedIndexedEmail(db, {
      uid: "bill-stmt",
      subject: "Your statement is ready",
      body_text: "Statement balance $238.80 minimum payment due",
      email_date: "2026-06-15T12:00:00Z",
    });
    await seedIndexedEmail(db, {
      uid: "plain-stmt",
      subject: "Your statement archive",
      body_text: "Statement archive notice",
      email_date: "2026-06-10T12:00:00Z",
    });
    await db.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, triage_status, bill_candidate_json)
            VALUES (?, ?, ?, 'fyi', 'finance', 'medium', 'complete', ?)`,
      args: ["user-1", "gmail-work", "bill-stmt", JSON.stringify({ amount: 238.8, due_date: "2026-07-07" })],
    });

    const result = await retrieveInboxAiSearch("user-1", {
      q: "statement",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      limit: 5,
    });

    const withBill = result.candidates.find((c) => c.uid === "bill-stmt");
    const withoutBill = result.candidates.find((c) => c.uid === "plain-stmt");
    expect(withBill!.metadata.bill_candidate).toBe(true);
    expect(withoutBill!.metadata.bill_candidate).toBe(false);
  });

  it("records a query_embedding usage event on vector search", async () => {
    db = await createRetrievalTestDb();
    const row = await seedIndexedEmail(db, {
      uid: "dentist-1",
      subject: "Dentist appointment reminder",
      body_text: "Your dentist appointment is on Friday",
      email_date: "2026-06-01T12:00:00Z",
    });
    await upsertEmbedding(db, row, [1, 0, 0]);
    const recordUsage = vi.fn(async (_userId: string, _options: Parameters<typeof recordEmailSearchAiUsage>[1]) => {});

    await retrieveInboxAiSearch("user-1", {
      q: "dentist appointment",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      recordUsage,
    });

    const call = recordUsage.mock.calls
      .map((c) => c[1])
      .find((a) => a?.eventType === "query_embedding");
    expect(call).toBeTruthy();
    expect(call!.model).toBe("text-embedding-3-small");
    expect(call!.estimated).toBe(true);
  });

  it("degrades to lexical-only retrieval when vector embedding fails", async () => {
    db = await createRetrievalTestDb();
    await seedIndexedEmail(db, {
      uid: "lexical-only",
      subject: "Credit card payment due",
      body_text: "Payment due May 10",
    });
    const embed = vi.fn(async () => {
      throw Object.assign(new Error("OPENAI_API_KEY not set for email search embeddings"), {
        code: "email_search_embeddings_unavailable",
        status: 503,
      });
    });

    const result = await retrieveInboxAiSearch("user-1", {
      q: "credit card payment due",
      dbClient: db,
      embeddingClient: { embed },
      capability: { mode: "fallback" },
      limit: 5,
    });

    expect(result.mode).toBe("lexical");
    expect(result.vector).toMatchObject({
      status: "unavailable",
      error_class: "email_search_embeddings_unavailable",
    });
    expect(result.candidates).toEqual([
      expect.objectContaining({
        uid: "lexical-only",
        provenance: { lexical: true, vector: false },
      }),
    ]);
  });

  it("down-weights vector under partial coverage so a fresh unembedded lexical match wins", async () => {
    db = await createRetrievalTestDb();
    // Fresh, body-only keyword match (modest lexical score), NO embedding.
    await seedIndexedEmail(db, {
      uid: "fresh-statement",
      subject: "Monthly update",
      body_text: "Your bank statement is enclosed for review.",
      email_date: "2026-06-13T12:00:00Z",
    });
    // Stale, no lexical match, but a strong embedding match. Coverage = 1/2 = 0.5.
    const stale = await seedIndexedEmail(db, {
      uid: "stale-vector",
      subject: "Weekly newsletter",
      body_text: "A general roundup unrelated to the query keywords.",
      email_date: "2026-01-01T12:00:00Z",
    });
    await upsertEmbedding(db, stale, [1, 0, 0]);

    const result = await retrieveInboxAiSearch("user-1", {
      q: "bank statement",
      now: "2026-06-14T00:00:00Z",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      limit: 5,
    });

    expect(result.candidates[0]!.uid).toBe("fresh-statement");
  });

  it("accepts an injected coverageRatio override (full trust keeps the strong vector match on top)", async () => {
    db = await createRetrievalTestDb();
    await seedIndexedEmail(db, {
      uid: "fresh-statement",
      subject: "Monthly update",
      body_text: "Your bank statement is enclosed for review.",
      email_date: "2026-06-13T12:00:00Z",
    });
    const stale = await seedIndexedEmail(db, {
      uid: "stale-vector",
      subject: "Weekly newsletter",
      body_text: "A general roundup unrelated to the query keywords.",
      email_date: "2026-01-01T12:00:00Z",
    });
    await upsertEmbedding(db, stale, [1, 0, 0]);

    const result = await retrieveInboxAiSearch("user-1", {
      q: "bank statement",
      now: "2026-06-14T00:00:00Z",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      coverageRatio: 1,
      limit: 5,
    });

    expect(result.candidates[0]!.uid).toBe("stale-vector");
  });

  it("does not surface a provider-removed email with high vector similarity above a legitimate match", async () => {
    db = await createRetrievalTestDb();
    // Legitimate, recent, body-only lexical match. No embedding -> lexical-only. Its
    // combined score is modest (recency-driven), deliberately below a raw vector-only 0.55.
    await seedIndexedEmail(db, {
      uid: "legit-statement",
      subject: "Monthly account update",
      body_text: "Your bank statement is enclosed for review.",
      email_date: "2026-06-13T12:00:00Z",
    });
    // Stale, no lexical overlap, but a perfect embedding match — and provider-removed.
    // Without uniform scoring this surfaces on top (vector-only 1.0 * 0.55 = 0.55).
    const removed = await seedIndexedEmail(db, {
      uid: "removed-vector",
      subject: "Weekly newsletter",
      body_text: "A general roundup unrelated to the query keywords.",
      email_date: "2026-05-20T12:00:00Z",
    });
    await upsertEmbedding(db, removed, [1, 0, 0]);
    await db.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, provider_state, triage_status)
            VALUES (?, ?, ?, 'fyi', 'uncategorized', 'normal', 'removed', 'complete')`,
      args: ["user-1", removed.account_id, "removed-vector"],
    });

    const result = await retrieveInboxAiSearch("user-1", {
      q: "bank statement",
      now: "2026-06-14T00:00:00Z",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      coverageRatio: 1,
      limit: 5,
    });

    expect(result.candidates[0]!.uid).toBe("legit-statement");
    expect(result.candidates[0]!.uid).not.toBe("removed-vector");
  });

  it("does not surface a noise-lane email with high vector similarity above a legitimate match", async () => {
    db = await createRetrievalTestDb();
    await seedIndexedEmail(db, {
      uid: "legit-statement",
      subject: "Monthly account update",
      body_text: "Your bank statement is enclosed for review.",
      email_date: "2026-06-13T12:00:00Z",
    });
    const noise = await seedIndexedEmail(db, {
      uid: "noise-vector",
      subject: "Weekly newsletter",
      body_text: "A general roundup unrelated to the query keywords.",
      email_date: "2026-04-01T12:00:00Z",
    });
    await upsertEmbedding(db, noise, [1, 0, 0]);
    await db.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, triage_status)
            VALUES (?, ?, ?, 'noise', 'promotions', 'low', 'complete')`,
      args: ["user-1", noise.account_id, "noise-vector"],
    });

    const result = await retrieveInboxAiSearch("user-1", {
      q: "bank statement",
      now: "2026-06-14T00:00:00Z",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      coverageRatio: 1,
      limit: 5,
    });

    expect(result.candidates[0]!.uid).toBe("legit-statement");
    expect(result.candidates[0]!.uid).not.toBe("noise-vector");
  });

  it("pages through a large result set with a stable, offset-independent total", async () => {
    db = await createRetrievalTestDb();
    // 60 matches — larger than the pre-fix offset-0 pool (50), so an offset-dependent
    // pool would understate `total` on page 1 and grow it on later pages.
    for (let i = 0; i < 60; i += 1) {
      await seedIndexedEmail(db, {
        uid: `stmt-${String(i).padStart(2, "0")}`,
        subject: `Bank statement ${i}`,
        body_text: "Your bank statement is ready.",
        email_date: `2026-06-14T${String(23 - (i % 24)).padStart(2, "0")}:00:00Z`,
      });
    }
    const opts = {
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" as const },
      coverageRatio: 1,
    };
    const pages = [];
    const seen = new Set();
    for (let offset = 0; offset < 60; offset += 20) {
      const page = await retrieveInboxAiSearch("user-1", { q: "bank statement", limit: 20, offset, ...opts });
      pages.push(page);
      page.candidates.forEach((c) => seen.add(c.uid));
    }

    // total is identical on every page (no offset dependence) and reflects the full set.
    expect(pages.map((p) => p.total)).toEqual([60, 60, 60]);
    expect(pages[0]!.has_more).toBe(true);
    expect(pages[2]!.has_more).toBe(false);
    // Pages are disjoint and together cover the whole set.
    expect(seen.size).toBe(60);
  });
});
describe("lexical query passes and zero-result fallback", () => {
  let db: RetrievalTestDb | null = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  const opts = () => ({
    dbClient: db!,
    embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
    capability: { mode: "fallback" as const },
    coverageRatio: 1,
    limit: 5,
  });

  it("runs lexical_queries beyond [0] against FTS so an alternate phrasing can retrieve (C2)", async () => {
    db = await createRetrievalTestDb();
    // Only the SECOND planned phrase matches this email; under first-query-only
    // retrieval it is invisible.
    await seedIndexedEmail(db, {
      uid: "second-phrase",
      subject: "Synchrony statement ready",
      body_text: "Your Synchrony statement is ready to view.",
      email_date: "2026-06-15T12:00:00Z",
    });

    const result = await retrieveInboxAiSearch("user-1", {
      q: "paypal mastercard statement",
      plan: {
        semantic_query: "paypal mastercard statement",
        lexical_queries: ["paypal cashback", "synchrony statement"],
      },
      ...opts(),
    });

    expect(result.candidates.map((c) => c.uid)).toContain("second-phrase");
  });

  it("recovers a natural-language query whose AND form matches nothing by stripping filler words (B1/C3)", async () => {
    db = await createRetrievalTestDb();
    // Prod repro: 'most recent paypal statement' returned 0 because unicode61 indexes
    // stopwords and every token is AND-required — 'most'/'recent' appear nowhere.
    await seedIndexedEmail(db, {
      uid: "anchor-stmt",
      subject: "Your PayPal statement is ready",
      body_text: "Statement balance $238.80 Minimum payment due $29.00",
      email_date: "2026-06-15T12:00:00Z",
    });

    const result = await retrieveInboxAiSearch("user-1", {
      q: "most recent paypal statement",
      ...opts(),
    });

    expect(result.candidates.map((c) => c.uid)).toContain("anchor-stmt");
  });

  it("falls through to OR-of-prefixed-tokens so one wrong token cannot zero the lexical leg (C3 ladder rung 2)", async () => {
    db = await createRetrievalTestDb();
    await seedIndexedEmail(db, {
      uid: "costco-stmt",
      subject: "Your Costco statement is ready",
      body_text: "Costco statement balance and rewards summary.",
      email_date: "2026-06-15T12:00:00Z",
    });

    // 'water' appears nowhere: the AND form and its stopword-stripped variant both
    // return zero; only the OR rung can rescue the two correct tokens.
    const result = await retrieveInboxAiSearch("user-1", {
      q: "costco water statement",
      ...opts(),
    });

    expect(result.candidates.map((c) => c.uid)).toContain("costco-stmt");
  });

  it("end-to-end anchor repro: 'synchrony statement' surfaces the statement family newest-first when the brand only lives in the sender domain", async () => {
    db = await createRetrievalTestDb();
    const family = {
      from_name: "PayPal",
      from_address: "ppv@mail.synchronybank.com",
      subject: "Your PayPal Cashback World Mastercard statement is ready.",
    };
    await seedIndexedEmail(db, {
      ...family,
      uid: "syn-old",
      body_text: "Statement balance $310.20 Minimum payment due $30.00",
      email_date: "2026-05-16T12:00:00Z",
    });
    await seedIndexedEmail(db, {
      ...family,
      uid: "syn-new",
      body_text: "Statement balance $238.80 Minimum payment due $29.00 Payment due date 07/07/2026",
      email_date: "2026-06-15T12:00:00Z",
    });

    // No token 'synchrony' exists anywhere — only the synchronybank domain label —
    // so the AND pass returns zero and only the OR rung plus the gate's prefix
    // matching can carry the family through.
    const result = await retrieveInboxAiSearch("user-1", {
      q: "synchrony statement",
      ...opts(),
    });

    const uids = result.candidates.map((c) => c.uid);
    expect(uids).toContain("syn-new");
    expect(uids).toContain("syn-old");
    expect(uids.indexOf("syn-new")).toBeLessThan(uids.indexOf("syn-old"));
  });
});
