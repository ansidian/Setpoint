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
import { retrieveInboxAiSearch } from "./email-search-retrieval.js";

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
});
