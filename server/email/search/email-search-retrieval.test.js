import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.js";
import { createEmailSearchEmbeddingStore } from "./email-search-embedding-store.js";
import { seedIndexedEmail } from "../test-utils/email-index-db.js";
import { mergeCandidates, retrieveInboxAiSearch } from "./email-search-retrieval.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../db/migrations");

async function applyMigrations(db, files) {
  for (const file of files) {
    await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

async function createRetrievalTestDb() {
  const db = createClient({ url: "file::memory:" });
  await applyMigrations(db, [
    "001_ea_tables.sql",
    "004_email_read_state_search_index.sql",
    "005_email_search_embeddings.sql",
    "006_email_search_embedding_state.sql",
    "013_email_index_normalized_date.sql",
  ]);
  return db;
}

async function upsertEmbedding(db, row, embedding) {
  const store = createEmailSearchEmbeddingStore(db, { mode: "fallback" });
  const document = buildEmailSearchEmbeddingDocument(row);
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
  let db = null;

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
    expect(withBill.metadata.bill_candidate).toBe(true);
    expect(withoutBill.metadata.bill_candidate).toBe(false);
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
    const recordUsage = vi.fn(async () => {});

    await retrieveInboxAiSearch("user-1", {
      q: "dentist appointment",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      recordUsage,
    });

    const call = recordUsage.mock.calls
      .map((c) => c[1])
      .find((a) => a.eventType === "query_embedding");
    expect(call).toBeTruthy();
    expect(call.model).toBe("text-embedding-3-small");
    expect(call.estimated).toBe(true);
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

  it("honors explicit read filters and rejects conflicting flags", async () => {
    db = await createRetrievalTestDb();
    const unread = await seedIndexedEmail(db, {
      uid: "unread-security",
      subject: "Google sign in alert",
      body_text: "Security alert",
      read: 0,
    });
    const read = await seedIndexedEmail(db, {
      uid: "read-security",
      subject: "Google security digest",
      body_text: "Security digest",
      read: 1,
    });
    await upsertEmbedding(db, unread, [1, 0, 0]);
    await upsertEmbedding(db, read, [1, 0, 0]);

    const result = await retrieveInboxAiSearch("user-1", {
      q: "is:unread google security",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      limit: 5,
    });

    expect(result.candidates.map((candidate) => candidate.uid)).toEqual(["unread-security"]);
    await expect(retrieveInboxAiSearch("user-1", {
      q: "is:read is:unread google",
      dbClient: db,
      embeddingClient: { embed: vi.fn() },
      capability: { mode: "fallback" },
    })).rejects.toMatchObject({
      status: 400,
      code: "invalid_email_search_flags",
    });
  });

  it("translates validated planner hints through server-owned filters", async () => {
    db = await createRetrievalTestDb();
    const wanted = await seedIndexedEmail(db, {
      uid: "wanted-amazon",
      from_address: "returns@amazon.com",
      subject: "Return QR code",
      body_text: "Drop off your return",
      read: 0,
    });
    const decoy = await seedIndexedEmail(db, {
      uid: "decoy-store",
      from_address: "returns@other-store.com",
      subject: "Return QR code",
      body_text: "Drop off your return",
      read: 1,
    });
    await upsertEmbedding(db, wanted, [1, 0, 0]);
    await upsertEmbedding(db, decoy, [1, 0, 0]);

    const result = await retrieveInboxAiSearch("user-1", {
      q: "where is my return qr code",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      plan: {
        semantic_query: "return qr code",
        lexical_queries: ["return qr"],
        sender_domains: ["amazon.com"],
        read_filter: "unread",
      },
      limit: 5,
    });

    expect(result.candidates.map((candidate) => candidate.uid)).toEqual(["wanted-amazon"]);
  });

  it("does not let planner-inferred sender or urgency hints exclude semantic matches", async () => {
    db = await createRetrievalTestDb();
    const chaseOffer = await seedIndexedEmail(db, {
      uid: "chase-prime-offer",
      from_name: "Chase Visa Card",
      from_address: "ChaseVisaCard@message.card.visa.com",
      subject: "Activate to get a $15 statement credit",
      body_text: "Prime Visa promotional offer. Spend 100 and get a statement credit.",
      read: 1,
    });
    const amazonOffer = await seedIndexedEmail(db, {
      uid: "amazon-prime-offer",
      from_name: "Amazon",
      from_address: "store-news@amazon.com",
      subject: "Prime promo",
      body_text: "Prime promo deal from Amazon.",
      read: 1,
    });
    await upsertEmbedding(db, chaseOffer, [1, 0, 0]);
    await upsertEmbedding(db, amazonOffer, [0.7, 0.3, 0]);

    const result = await retrieveInboxAiSearch("user-1", {
      q: "prime promo",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      plan: {
        semantic_query: "Prime promotional offers",
        lexical_queries: ["prime promo"],
        sender_domains: ["amazon.com"],
        urgency: ["low"],
      },
      limit: 5,
    });

    expect(result.candidates.map((candidate) => candidate.uid)).toContain("chase-prime-offer");
    const candidate = result.candidates.find((item) => item.uid === "chase-prime-offer");
    expect(candidate).toMatchObject({
      from: { address: "ChaseVisaCard@message.card.visa.com" },
      provenance: { vector: true },
    });
  });

  it("uses a rolling server-owned window for relative date queries", async () => {
    db = await createRetrievalTestDb();
    const sameEvening = await seedIndexedEmail(db, {
      uid: "same-evening-result",
      subject: "Deployment summary",
      body_text: "This changed late in the local evening.",
      email_date: "Fri, 15 May 2026 01:08:02 +0000",
    });
    await upsertEmbedding(db, sameEvening, [1, 0, 0]);

    const result = await retrieveInboxAiSearch("user-1", {
      q: "what changed in the last week",
      now: "2026-05-15T04:00:00.000Z",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      plan: {
        semantic_query: "changes in the last week",
        lexical_queries: ["changed"],
        date_window: {
          after: "2026-05-08T00:00:00.000Z",
          before: "2026-05-15T00:00:00.000Z",
        },
      },
      limit: 5,
    });

    expect(result.parsed_query.date_window).toEqual({
      after: "2026-05-08T04:00:00.000Z",
      before: "2026-05-15T04:00:00.000Z",
    });
    expect(result.candidates.map((candidate) => candidate.uid)).toEqual(["same-evening-result"]);
  });

  it("includes undated rows in a windowed query while excluding dated rows outside the window", async () => {
    db = await createRetrievalTestDb();
    // Undated: an unparseable header normalizes to "" (empty email_date_utc). The column
    // is NOT NULL DEFAULT '', so "" is the only undated state the index can hold. Before
    // the P3-51 fix this row was silently dropped from any date-windowed query.
    const undated = await seedIndexedEmail(db, {
      uid: "undated-amazon-return",
      subject: "Amazon return drop off label",
      body_text: "Your return label is attached but the header date is missing.",
      email_date: "not-a-real-date",
    });
    // Same subject phrase, but dated OUTSIDE the window -> must still be excluded. Sharing
    // the lexical phrase means the only thing separating the two rows is the window filter.
    const outOfWindow = await seedIndexedEmail(db, {
      uid: "dated-out-of-window",
      subject: "Amazon return drop off label",
      body_text: "Your return label from long before the window.",
      email_date: "2025-01-01T12:00:00Z",
    });
    await upsertEmbedding(db, undated, [1, 0, 0]);
    await upsertEmbedding(db, outOfWindow, [1, 0, 0]);

    const result = await retrieveInboxAiSearch("user-1", {
      q: "amazon return drop off label",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      plan: {
        semantic_query: "amazon return drop off label",
        lexical_queries: ["amazon return drop off label"],
        date_window: {
          after: "2026-05-08T00:00:00.000Z",
          before: "2026-05-15T00:00:00.000Z",
        },
      },
      limit: 5,
    });

    const uids = result.candidates.map((candidate) => candidate.uid);
    expect(uids).toContain("undated-amazon-return");
    expect(uids).not.toContain("dated-out-of-window");
  });

  it("honors planner date windows and drops weak body-only lexical evidence", async () => {
    db = await createRetrievalTestDb();
    const oldApplication = await seedIndexedEmail(db, {
      uid: "old-crowdstrike",
      subject: "CrowdStrike Job Application Confirmation",
      body_text: "We received your job application.",
      email_date: "2025-07-31T20:13:45.000Z",
    });
    const recentApplication = await seedIndexedEmail(db, {
      uid: "recent-stubhub",
      from_address: "no-reply@stubhub.com",
      subject: "Thank you for applying to StubHub",
      body_text: "Thank you for applying for the Software Engineer I job at StubHub.",
      email_date: "Thu, 14 May 2026 18:11:11 +0000",
    });
    const jobSearchNoise = await seedIndexedEmail(db, {
      uid: "recent-simplify-welcome",
      from_address: "noreply@simplify.jobs",
      subject: "Hey Andy - welcome to Simplify!",
      body_text: "I know the job search can be both exciting and challenging. Simplify can help you apply faster.",
      email_date: "Tue, 12 May 2026 02:37:12 +0000",
    });
    await upsertEmbedding(db, oldApplication, [1, 0, 0]);
    await upsertEmbedding(db, recentApplication, [0.9, 0.1, 0]);
    await upsertEmbedding(db, jobSearchNoise, [0.25, 0.97, 0]);

    const result = await retrieveInboxAiSearch("user-1", {
      q: "how many job applications have i applied to in the last week",
      now: "2026-05-15T04:00:00.000Z",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      plan: {
        semantic_query: "job application confirmations in the last week",
        lexical_queries: ["job application"],
        intents: ["count applications", "find application confirmations"],
        date_window: {
          after: "2026-05-08T00:00:00.000Z",
          before: "2026-05-15T00:00:00.000Z",
        },
      },
      limit: 5,
    });

    expect(result.candidates.map((candidate) => candidate.uid)).toEqual(["recent-stubhub"]);
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

    expect(result.candidates[0].uid).toBe("fresh-statement");
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

    expect(result.candidates[0].uid).toBe("stale-vector");
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

    expect(result.candidates[0].uid).toBe("legit-statement");
    expect(result.candidates[0].uid).not.toBe("removed-vector");
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

    expect(result.candidates[0].uid).toBe("legit-statement");
    expect(result.candidates[0].uid).not.toBe("noise-vector");
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
      capability: { mode: "fallback" },
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
    expect(pages[0].has_more).toBe(true);
    expect(pages[2].has_more).toBe(false);
    // Pages are disjoint and together cover the whole set.
    expect(seen.size).toBe(60);
  });
});

describe("lexical query passes and zero-result fallback", () => {
  let db = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  const opts = () => ({
    dbClient: db,
    embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
    capability: { mode: "fallback" },
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

describe("mergeCandidates coverage-aware fusion", () => {
  const lex = (uid, search_score, extra = {}) => ({
    uid,
    search_score,
    subject: uid,
    email_date: "2026-06-13T12:00:00Z",
    ...extra,
  });
  const vrow = (uid, extra = {}) => ({
    uid,
    subject: uid,
    email_date: "2026-01-01T12:00:00Z",
    ...extra,
  });

  it("partial coverage: a fresh strong-lexical unembedded email is not displaced by a stale strong-vector one", () => {
    const merged = mergeCandidates({
      lexicalRows: [lex("fresh", 34)],
      vectorMatches: [{ uid: "stale", similarity: 0.75 }],
      vectorRows: [vrow("stale")],
      limit: 10,
      coverageRatio: 0.42,
    });
    // fresh = 0.34 (lexical-only); stale = 0.75 * 0.55 * 0.42 ≈ 0.173 (vector-only)
    expect(merged.map((candidate) => candidate.uid)).toEqual(["fresh", "stale"]);
  });

  it("full coverage: a strong-semantic embedded match still ranks above a weak lexical one (vector not flattened)", () => {
    const merged = mergeCandidates({
      lexicalRows: [lex("weak", 30)],
      vectorMatches: [{ uid: "semantic", similarity: 0.9 }],
      vectorRows: [vrow("semantic")],
      limit: 10,
      coverageRatio: 1,
    });
    // semantic = 0.9 * 0.55 * 1 = 0.495 (vector-only); weak = 0.30 (lexical-only)
    expect(merged.map((candidate) => candidate.uid)).toEqual(["semantic", "weak"]);
  });

  it("at full coverage the hybrid fusion equals the pre-change 0.45/0.55 formula", () => {
    const [hybrid] = mergeCandidates({
      lexicalRows: [lex("h", 50)],
      vectorMatches: [{ uid: "h", similarity: 0.6 }],
      vectorRows: [vrow("h")],
      limit: 10,
      coverageRatio: 1,
    });
    // 0.5 * 0.45 + 0.6 * 0.55 = 0.555
    expect(hybrid.scores.combined).toBeCloseTo(0.555, 6);
  });

  it("fuses a vector-only row's lexical/quality score so a penalized row sinks below a clean one", () => {
    // Both are vector-only (no lexical provenance), but the pre-scored rows carry a
    // search_score: `clean` is benign (+20), `penalized` mirrors a provider-removed /
    // noise-lane row (-100). Despite a much higher embedding similarity, the penalty
    // must pull `penalized` below `clean` in the fused ranking.
    const merged = mergeCandidates({
      lexicalRows: [],
      vectorMatches: [
        { uid: "clean", similarity: 0.6 },
        { uid: "penalized", similarity: 0.95 },
      ],
      vectorRows: [vrow("clean", { search_score: 20 }), vrow("penalized", { search_score: -100 })],
      limit: 10,
      coverageRatio: 1,
    });
    // clean:     0.20 * 0.45 + 0.6  * 0.55 = 0.420
    // penalized: -1   * 0.45 + 0.95 * 0.55 = 0.0725  (search_score -100 clamps lexical to -1)
    expect(merged.map((candidate) => candidate.uid)).toEqual(["clean", "penalized"]);
    const penalized = merged.find((candidate) => candidate.uid === "penalized");
    expect(penalized.scores.lexical).toBe(-1);
    expect(penalized.scores.combined).toBeCloseTo(0.0725, 6);
  });
});

describe("candidate pool recency", () => {
  let db = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("keeps the newest match reachable when older high-frequency matches saturate the bm25 pool", async () => {
    db = await createRetrievalTestDb();
    // 110 old fillers whose tiny bodies repeat the term: they dominate unweighted BM25
    // and would fill the entire lexical fetch pool (fetchLimit = 100 at default limit).
    for (let i = 0; i < 110; i += 1) {
      await seedIndexedEmail(db, {
        uid: `filler-${String(i).padStart(3, "0")}`,
        subject: "Weekly digest",
        body_snippet: "payment payment payment payment payment",
        body_text: "payment payment payment payment payment",
        email_date: "2026-01-05T12:00:00Z",
      });
    }
    await seedIndexedEmail(db, {
      uid: "newest-subject-match",
      subject: "Payment due notice",
      body_snippet: "Your autopay draft is scheduled.",
      body_text: "Your autopay draft is scheduled.",
      email_date: "2026-04-30T12:00:00Z",
    });

    const result = await retrieveInboxAiSearch("user-1", {
      q: "payment",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      limit: 12,
      now: "2026-05-01T12:00:00Z",
    });

    expect(result.candidates.map((candidate) => candidate.uid)).toContain("newest-subject-match");
  });

  it("breaks combined-score ties by recency instead of uid order", () => {
    const row = (uid, date) => ({
      uid,
      subject: "statement",
      body_snippet: "statement",
      body_text: "",
      email_date: date,
      email_date_utc: date,
      read: 1,
      from_name: "Bank",
      from_address: "billing@bank.com",
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "work@example.com",
      account_color: "#123456",
      account_icon: "Mail",
      search_score: 50,
    });
    const merged = mergeCandidates({
      lexicalRows: [row("a-old", "2026-01-01T00:00:00.000Z"), row("b-new", "2026-03-01T00:00:00.000Z")],
      vectorMatches: [],
      vectorRows: [],
      limit: 5,
    });
    expect(merged.map((candidate) => candidate.uid)).toEqual(["b-new", "a-old"]);
  });
});

describe("date window inclusivity", () => {
  let db = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("includes emails sent ON the before date (bare-date bound covers the whole day)", async () => {
    db = await createRetrievalTestDb();
    await seedIndexedEmail(db, {
      uid: "sent-on-before-day",
      subject: "Your statement is ready",
      body_text: "Statement balance attached.",
      email_date: "2026-06-15T21:29:54Z",
    });

    const result = await retrieveInboxAiSearch("user-1", {
      q: "statement",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      plan: { date_window: { before: "2026-06-15" } },
      now: "2026-07-02T18:00:00Z",
    });

    expect(result.candidates.map((candidate) => candidate.uid)).toContain("sent-on-before-day");
  });
});

describe("family dominance across the fused hybrid pool", () => {
  let db = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("keeps a recurring family newest-first when the siblings arrive via different retrieval legs", async () => {
    db = await createRetrievalTestDb();
    // Newest sibling matches the query lexically (unique token in its body) but is not
    // embedded; the older sibling is vector-only (perfect similarity) and carries
    // non-expiring triage edges (bill_candidate, finance). The per-pool clamp sees two
    // 1-member families, so only a fused-level clamp can keep the family newest-first.
    await seedIndexedEmail(db, {
      uid: "stmt-new-lexical",
      from_address: "billing@bank.com",
      from_name: "Bank",
      subject: "Your statement is ready",
      body_snippet: "Your statement is ready. Payment due 0707.",
      body_text: "Your statement is ready. Payment due 0707.",
      email_date: "2026-06-15T12:00:00Z",
    });
    const older = await seedIndexedEmail(db, {
      uid: "stmt-old-vector",
      from_address: "billing@bank.com",
      from_name: "Bank",
      subject: "Your statement is ready",
      body_snippet: "Your statement is ready.",
      body_text: "Your statement is ready.",
      email_date: "2026-05-16T12:00:00Z",
    });
    await upsertEmbedding(db, older, [1, 0, 0]);
    await db.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, bill_candidate_json, triage_status)
            VALUES (?, ?, ?, 'fyi', 'finance', 'medium', '{"amount":42}', 'complete')`,
      args: ["user-1", "gmail-work", "stmt-old-vector"],
    });

    const result = await retrieveInboxAiSearch("user-1", {
      q: "statement 0707",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      limit: 5,
      now: "2026-07-02T12:00:00Z",
    });

    const uids = result.candidates.map((candidate) => candidate.uid);
    expect(uids.indexOf("stmt-new-lexical")).toBeGreaterThanOrEqual(0);
    expect(uids.indexOf("stmt-new-lexical")).toBeLessThan(uids.indexOf("stmt-old-vector"));
  });
});

describe("bm25 subject weighting", () => {
  let db = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("keeps an old subject match in the pool ahead of from-field decoys (gates the bm25 weights)", async () => {
    db = await createRetrievalTestDb();
    // 160 newer decoys match via short from_name + body — the strongest columns under
    // UNWEIGHTED bm25. The subject-matching target is older than the 50-newest date
    // slice, so only the subject-heavy bm25 weights can carry it into the 100-row pool.
    for (let i = 0; i < 160; i += 1) {
      await seedIndexedEmail(db, {
        uid: `decoy-${String(i).padStart(3, "0")}`,
        from_name: "Payment",
        from_address: `billing@decoy${i}.example.com`,
        subject: "Ledger update",
        body_snippet: "Ledger reconciliation attached for your records.",
        body_text: "Ledger reconciliation attached for your records.",
        email_date: `2026-03-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`,
      });
    }
    await seedIndexedEmail(db, {
      uid: "subject-weighted-target",
      from_name: "Accounting",
      from_address: "books@firm.example.com",
      subject: "Payment reconciliation summary",
      body_snippet: "Quarterly summary attached.",
      body_text: "Quarterly summary attached.",
      email_date: "2026-02-01T12:00:00Z",
    });

    const result = await retrieveInboxAiSearch("user-1", {
      q: "payment reconciliation",
      dbClient: db,
      embeddingClient: { embed: vi.fn(async () => [[1, 0, 0]]) },
      capability: { mode: "fallback" },
      limit: 12,
      now: "2026-05-01T12:00:00Z",
    });

    expect(result.candidates.map((candidate) => candidate.uid)).toContain("subject-weighted-target");
  });
});
