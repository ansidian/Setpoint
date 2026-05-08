import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_SEARCH_EMBEDDING_BODY_CHAR_LIMIT,
  EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
  EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
  EMAIL_SEARCH_EMBEDDING_MODEL,
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.js";
import {
  createEmailSearchEmbeddingClient,
} from "./email-search-embedding-client.js";
import {
  createEmailSearchEmbeddingStore,
  detectEmailSearchVectorCapability,
} from "./email-search-embedding-store.js";
import { seedIndexedEmail } from "./test-utils/email-index-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");

async function applyMigrations(db, files) {
  for (const file of files) {
    await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

async function createEmbeddingTestDb() {
  const db = createClient({ url: "file::memory:" });
  await applyMigrations(db, [
    "001_ea_tables.sql",
    "004_email_read_state_search_index.sql",
    "005_email_search_embeddings.sql",
  ]);
  return db;
}

describe("email search embedding documents", () => {
  it("builds one compact deterministic document from indexed email fields", () => {
    const document = buildEmailSearchEmbeddingDocument({
      uid: "gmail-work-msg-1",
      user_id: "user-1",
      account_id: "gmail-work",
      from_name: "  Ada   Lovelace ",
      from_address: " ada@example.com ",
      subject: " Tuition\nreceipt ready ",
      body_snippet: " Payment   confirmation ",
      body_text: `${"x".repeat(EMAIL_SEARCH_EMBEDDING_BODY_CHAR_LIMIT)}tail`,
      read: 0,
    });

    expect(document).toMatchObject({
      uid: "gmail-work-msg-1",
      user_id: "user-1",
      account_id: "gmail-work",
      document_version: EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
      model: EMAIL_SEARCH_EMBEDDING_MODEL,
      dimensions: EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
      sender: "Ada Lovelace <ada@example.com>",
      subject: "Tuition receipt ready",
      snippet: "Payment confirmation",
    });
    expect(document.body_excerpt).toHaveLength(EMAIL_SEARCH_EMBEDDING_BODY_CHAR_LIMIT);
    expect(document.body_excerpt.endsWith("tail")).toBe(false);
    expect(document.text).toContain("Sender: Ada Lovelace <ada@example.com>");
    expect(document.text).toContain("Subject: Tuition receipt ready");
    expect(document.text).toContain("Snippet: Payment confirmation");
  });

  it("hashes searchable content without reacting to read-state changes", () => {
    const baseRow = {
      uid: "gmail-work-msg-1",
      user_id: "user-1",
      account_id: "gmail-work",
      from_name: "Bursar",
      from_address: "billing@school.edu",
      subject: "Tuition receipt",
      body_snippet: "Paid",
      body_text: "Receipt body",
      read: 0,
    };
    const baseHash = computeEmailSearchEmbeddingSourceHash(
      buildEmailSearchEmbeddingDocument(baseRow),
    );

    expect(computeEmailSearchEmbeddingSourceHash(
      buildEmailSearchEmbeddingDocument({ ...baseRow, read: 1 }),
    )).toBe(baseHash);
    expect(computeEmailSearchEmbeddingSourceHash(
      buildEmailSearchEmbeddingDocument({ ...baseRow, subject: "Tuition deadline" }),
    )).not.toBe(baseHash);
  });
});

describe("email search embedding client", () => {
  it("calls OpenAI embeddings with the fixed inbox-search model", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { index: 0, embedding: [0.1, 0.2, 0.3] },
          { index: 1, embedding: [0.4, 0.5, 0.6] },
        ],
      }),
    }));
    const client = createEmailSearchEmbeddingClient({
      apiKey: "test-openai-key",
      fetchImpl,
    });

    await expect(client.embed(["first", "second"])).resolves.toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-openai-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      model: EMAIL_SEARCH_EMBEDDING_MODEL,
      input: ["first", "second"],
      dimensions: EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
      encoding_format: "float",
    });
  });

  it("reports missing key and provider failures clearly", async () => {
    await expect(createEmailSearchEmbeddingClient({ apiKey: "" }).embed(["doc"]))
      .rejects.toMatchObject({
        status: 503,
        code: "email_search_embeddings_unavailable",
        message: "OPENAI_API_KEY not set for email search embeddings",
      });

    const client = createEmailSearchEmbeddingClient({
      apiKey: "test-openai-key",
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: "rate limited" } }),
      }),
    });

    await expect(client.embed(["doc"])).rejects.toMatchObject({
      status: 502,
      code: "email_search_embeddings_provider_error",
      message: "OpenAI embeddings request failed: rate limited",
    });
  });
});

describe("email search embedding store", () => {
  let db = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("distinguishes native vector support from local fallback", async () => {
    await expect(detectEmailSearchVectorCapability({
      execute: vi.fn(async () => ({ rows: [{ distance: 0 }] })),
    })).resolves.toEqual({ mode: "native", native: true });

    await expect(detectEmailSearchVectorCapability({
      execute: vi.fn(async () => {
        throw new Error("no such function: vector32");
      }),
    })).resolves.toEqual({
      mode: "fallback",
      native: false,
      reason: "no such function: vector32",
    });
  });

  it("lists rows needing embeddings without treating read changes as stale", async () => {
    db = await createEmbeddingTestDb();
    const freshRow = await seedIndexedEmail(db, {
      uid: "fresh",
      subject: "Tuition receipt",
      body_text: "Paid receipt",
      email_date: "2026-05-02T12:00:00Z",
      read: 0,
    });
    await seedIndexedEmail(db, {
      uid: "missing",
      subject: "Scholarship deadline",
      body_text: "Apply soon",
      email_date: "2026-05-01T12:00:00Z",
      read: 0,
    });
    const store = createEmailSearchEmbeddingStore(db, { mode: "fallback" });
    const document = buildEmailSearchEmbeddingDocument(freshRow);

    await store.upsertEmbedding({
      uid: freshRow.uid,
      user_id: freshRow.user_id,
      account_id: freshRow.account_id,
      document,
      source_hash: computeEmailSearchEmbeddingSourceHash(document),
      embedding: [1, 0, 0],
    });
    await db.execute({
      sql: "UPDATE ea_email_index SET read = 1 WHERE uid = ?",
      args: [freshRow.uid],
    });
    const originalHash = computeEmailSearchEmbeddingSourceHash(document);

    const stale = await store.listRowsNeedingEmbeddings("user-1", { limit: 10 });

    expect(stale.map((row) => row.uid)).toEqual(["missing"]);
    expect(stale[0]).toMatchObject({
      source_hash: expect.any(String),
      document: expect.objectContaining({
        subject: "Scholarship deadline",
      }),
    });

    await db.execute({
      sql: "UPDATE ea_email_index SET subject = ? WHERE uid = ?",
      args: ["Updated tuition receipt", freshRow.uid],
    });

    const staleAfterContentChange = await store.listRowsNeedingEmbeddings("user-1", { limit: 10 });

    expect(staleAfterContentChange.map((row) => row.uid)).toEqual(["missing", "fresh"]);
    const changedRow = staleAfterContentChange.find((row) => row.uid === "fresh");
    expect(changedRow).toMatchObject({
      document: expect.objectContaining({
        subject: "Updated tuition receipt",
      }),
    });
    expect(changedRow.source_hash).not.toBe(originalHash);
  });

  it("prioritizes missing embeddings before the scan window drops them", async () => {
    db = await createEmbeddingTestDb();
    const store = createEmailSearchEmbeddingStore(db, { mode: "fallback" });

    for (let index = 0; index < 3; index++) {
      const row = await seedIndexedEmail(db, {
        uid: `fresh-${index}`,
        subject: `Fresh ${index}`,
        body_text: "Already embedded",
        email_date: `2026-05-0${5 - index}T12:00:00Z`,
      });
      const document = buildEmailSearchEmbeddingDocument(row);
      await store.upsertEmbedding({
        uid: row.uid,
        user_id: row.user_id,
        account_id: row.account_id,
        document,
        source_hash: computeEmailSearchEmbeddingSourceHash(document),
        embedding: [1, 0, 0],
      });
    }

    await seedIndexedEmail(db, {
      uid: "missing-outside-date-window",
      subject: "Older missing embedding",
      body_text: "Needs vector",
      email_date: "2026-04-01T12:00:00Z",
    });

    const rows = await store.listRowsNeedingEmbeddings("user-1", {
      limit: 1,
      scanLimit: 3,
    });

    expect(rows.map((row) => row.uid)).toEqual(["missing-outside-date-window"]);
  });

  it("stores embeddings and can query them through the fallback interface", async () => {
    db = await createEmbeddingTestDb();
    const first = await seedIndexedEmail(db, {
      uid: "first",
      subject: "Tuition receipt",
      body_text: "Paid receipt",
    });
    const second = await seedIndexedEmail(db, {
      uid: "second",
      subject: "Travel reservation",
      body_text: "Flight itinerary",
    });
    const store = createEmailSearchEmbeddingStore(db, { mode: "fallback" });

    for (const [row, embedding] of [[first, [1, 0, 0]], [second, [0, 1, 0]]]) {
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

    const matches = await store.querySimilarEmbeddings("user-1", [0.9, 0.1, 0], { limit: 2 });

    expect(matches.map((match) => match.uid)).toEqual(["first", "second"]);
    expect(matches[0]).toMatchObject({
      similarity: expect.any(Number),
      distance: expect.any(Number),
      document: expect.objectContaining({ subject: "Tuition receipt" }),
    });
    expect(matches[0].similarity).toBeGreaterThan(matches[1].similarity);
  });
});
