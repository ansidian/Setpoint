import { afterEach, describe, expect, it } from "vitest";
import {
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.js";
import {
  getEmailSearchCostStats,
  recordEmailSearchAiUsage,
} from "./email-search-cost-stats.js";
import { createEmailSearchEmbeddingStore } from "./email-search-embedding-store.js";
import { createEmailIndexTestDb, seedIndexedEmail } from "./test-utils/email-index-db.js";

describe("email search cost stats", () => {
  let db = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("reports semantic search coverage, corpus embedding cost, and Ask AI usage without storing content", async () => {
    db = await createEmailIndexTestDb();
    const row = await seedIndexedEmail(db, {
      uid: "embedded-1",
      user_id: "user-1",
      subject: "Tuition receipt",
      body_text: "A".repeat(400),
    });
    await seedIndexedEmail(db, {
      uid: "missing-1",
      user_id: "user-1",
      subject: "Scholarship deadline",
      body_text: "Needs an embedding",
    });
    const store = createEmailSearchEmbeddingStore(db, { mode: "fallback" });
    const document = buildEmailSearchEmbeddingDocument(row);
    await store.upsertEmbedding({
      uid: row.uid,
      user_id: row.user_id,
      account_id: row.account_id,
      document,
      source_hash: computeEmailSearchEmbeddingSourceHash(document),
      embedding: [1, 0, 0],
    });
    await recordEmailSearchAiUsage("user-1", {
      dbClient: db,
      eventType: "planner",
      model: "gpt-5.4-mini",
      usage: { input_tokens: 100, output_tokens: 40 },
    });
    await recordEmailSearchAiUsage("user-1", {
      dbClient: db,
      eventType: "query_embedding",
      model: "text-embedding-3-small",
      usage: { input_tokens: 20 },
      estimated: true,
    });
    await recordEmailSearchAiUsage("user-1", {
      dbClient: db,
      eventType: "answer",
      model: "gpt-5.4-mini",
      usage: {
        input_tokens: 900,
        input_tokens_details: { cached_tokens: 200 },
        output_tokens: 120,
      },
      metadata: { source_count: 2 },
    });
    await recordEmailSearchAiUsage("user-1", {
      dbClient: db,
      eventType: "corpus_embedding",
      model: "text-embedding-3-small",
      usage: { input_tokens: 300 },
    });

    const stats = await getEmailSearchCostStats("user-1", {
      dbClient: db,
      now: new Date("2026-05-08T12:00:00.000Z"),
    });

    expect(stats.coverage).toMatchObject({
      total_indexed: 2,
      fresh_embeddings: 1,
      missing_embeddings: 1,
    });
    expect(stats.corpusEmbeddings).toMatchObject({
      model: "text-embedding-3-small",
      embeddedDocuments: 1,
      estimatedInputTokens: expect.any(Number),
      estimatedCostUsd: expect.any(Number),
    });
    expect(stats.corpusEmbeddings.actualUsage).toMatchObject({
      calls: 1,
      inputTokens: 300,
      byEvent: {
        corpus_embedding: expect.objectContaining({ calls: 1 }),
      },
    });
    expect(stats.askAi.actualUsage).toMatchObject({
      calls: 3,
      inputTokens: 1020,
      cachedInputTokens: 200,
      outputTokens: 160,
      estimatedCalls: 1,
      byEvent: {
        answer: expect.objectContaining({ calls: 1 }),
        planner: expect.objectContaining({ calls: 1 }),
        query_embedding: expect.objectContaining({ calls: 1, estimatedCalls: 1 }),
      },
    });
    expect(stats.askAi.actualUsage.byEvent.corpus_embedding).toBeUndefined();
    expect(stats.askAi.perSuccessfulAskEstimate.estimatedCostUsd).toBeGreaterThan(0);

    const columns = await db.execute("PRAGMA table_info('ea_email_search_ai_usage')");
    expect(columns.rows.map((column) => column.name)).not.toContain("query_text");
  });

  it("prices dated OpenAI model ids and repairs zero-cost historical rollups", async () => {
    db = await createEmailIndexTestDb();

    await db.execute({
      sql: `INSERT INTO ea_email_search_ai_usage
              (user_id, event_type, model, input_tokens, cached_input_tokens,
               output_tokens, estimated, estimated_cost_usd, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "user-1",
        "answer",
        "gpt-5.4-mini-2026-03-17",
        1000,
        200,
        100,
        0,
        0,
        "{}",
        "2026-05-08T11:00:00.000Z",
      ],
    });
    await recordEmailSearchAiUsage("user-1", {
      dbClient: db,
      eventType: "planner",
      model: "gpt-5.4-mini-2026-03-17",
      usage: { input_tokens: 100, output_tokens: 40 },
      createdAt: new Date("2026-05-08T11:01:00.000Z"),
    });

    const stats = await getEmailSearchCostStats("user-1", {
      dbClient: db,
      now: new Date("2026-05-08T12:00:00.000Z"),
    });

    expect(stats.askAi.actualUsage.calls).toBe(2);
    expect(stats.askAi.actualUsage.estimatedCostUsd).toBeGreaterThan(0);
    expect(stats.askAi.actualUsage.byEvent.answer.estimatedCostUsd).toBe(0.001065);
    expect(stats.askAi.actualUsage.models).toEqual(["gpt-5.4-mini-2026-03-17"]);
  });
});
