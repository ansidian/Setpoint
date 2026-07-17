import { afterEach, describe, expect, it } from "vitest";
import {
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.ts";
import {
  getEmailSearchCostStats,
  recordEmailSearchAiUsage,
} from "./email-search-cost-stats.ts";
import { createEmailSearchEmbeddingStore } from "./email-search-embedding-store.ts";
import { createEmailIndexTestDb, seedIndexedEmail } from "../test-utils/email-index-db.ts";
import type { EmailSearchEmbeddingSourceRow } from "./email-search-embeddings.ts";

describe("email search cost stats", () => {
  let db: Awaited<ReturnType<typeof createEmailIndexTestDb>> | null = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("reports querySearch usage and a per-query estimate, with no planner, without storing content", async () => {
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
    const document = buildEmailSearchEmbeddingDocument(row as unknown as EmailSearchEmbeddingSourceRow);
    await store.upsertEmbedding({
      uid: row.uid,
      user_id: row.user_id,
      account_id: row.account_id,
      document,
      source_hash: computeEmailSearchEmbeddingSourceHash(document),
      embedding: [1, 0, 0],
    });
    // A retired planner row may still exist in historical data; it must be ignored.
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

    // Honest shape: Alfred is the planner now, so there is no askAi block and the
    // live per-query model cost is the query embedding only.
    expect(stats.askAi).toBeUndefined();
    expect(stats.querySearch.actualUsage).toMatchObject({
      calls: 1,
      inputTokens: 20,
      estimatedCalls: 1,
      byEvent: {
        query_embedding: expect.objectContaining({ calls: 1, estimatedCalls: 1 }),
      },
    });
    expect(stats.querySearch.actualUsage.byEvent.planner).toBeUndefined();
    expect(stats.querySearch.perQueryEstimate.model).toBe("text-embedding-3-small");
    expect(stats.querySearch.perQueryEstimate).not.toHaveProperty("planner");
    expect(stats.querySearch.perQueryEstimate.estimatedCostUsd).toBeGreaterThan(0);
    expect(stats.pricing.models).not.toHaveProperty("gpt-5.4-mini");
    expect(stats.pricing.models).toHaveProperty("text-embedding-3-small");
    expect(stats.corpusEmbeddings).toBeTruthy();

    const columns = await db.execute("PRAGMA table_info('ea_email_search_ai_usage')");
    expect(columns.rows.map((column) => column.name)).not.toContain("query_text");
  });

  it("reprices zero-cost query_embedding rollups and ignores retired planner rows", async () => {
    db = await createEmailIndexTestDb();

    // A historical query_embedding row stored with zero cost must be repriced via
    // the embedding price (the only live priced model now).
    await db.execute({
      sql: `INSERT INTO ea_email_search_ai_usage
              (user_id, event_type, model, input_tokens, cached_input_tokens,
               output_tokens, estimated, estimated_cost_usd, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "user-1",
        "query_embedding",
        "text-embedding-3-small",
        100000,
        0,
        0,
        1,
        0,
        "{}",
        "2026-05-08T11:00:00.000Z",
      ],
    });
    // A retired planner row in the same window must not surface under querySearch.
    await db.execute({
      sql: `INSERT INTO ea_email_search_ai_usage
              (user_id, event_type, model, input_tokens, cached_input_tokens,
               output_tokens, estimated, estimated_cost_usd, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "user-1",
        "planner",
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

    const stats = await getEmailSearchCostStats("user-1", {
      dbClient: db,
      now: new Date("2026-05-08T12:00:00.000Z"),
    });

    expect(stats.querySearch.actualUsage.calls).toBe(1);
    expect(stats.querySearch.actualUsage.byEvent.planner).toBeUndefined();
    expect(stats.querySearch.actualUsage.estimatedCostUsd).toBeGreaterThan(0);
    expect(stats.querySearch.actualUsage.models).toEqual(["text-embedding-3-small"]);
  });
});
