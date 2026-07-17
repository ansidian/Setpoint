import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEmailSearchEmbeddingDocument,
  computeEmailSearchEmbeddingSourceHash,
} from "./email-search-embeddings.ts";
import { createEmailSearchEmbeddingStore } from "./email-search-embedding-store.ts";
import { createEmailIndexTestDb, seedIndexedEmail } from "../test-utils/email-index-db.ts";
import {
  getEmailSearchEmbeddingCoverageRatio,
  getEmailSearchEmbeddingCoverageStatus,
  processEmailSearchEmbeddingBatchesForAllUsers,
  processEmailSearchEmbeddingBatch,
} from "./email-search-embedding-worker.ts";
import type { EmailSearchEmbeddingError, EmailSearchEmbeddingVectors } from "./email-search-embedding-client.ts";
import type { EmailSearchEmbeddingSourceRow } from "./email-search-embeddings.ts";

type WorkerTestDb = Awaited<ReturnType<typeof createWorkerTestDb>>;
type SeedIndexedEmailRow = Awaited<ReturnType<typeof seedIndexedEmail>>;

function createWorkerTestDb() {
  // Full set — the worker reads embedding state and writes AI usage.
  return createEmailIndexTestDb();
}

async function upsertFreshEmbedding(
  db: WorkerTestDb,
  row: EmailSearchEmbeddingSourceRow & { uid: string; user_id: string; account_id: string },
  embedding: number[] = [1, 0, 0],
): Promise<void> {
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

describe("email search embedding worker", () => {
  let db: WorkerTestDb | null = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("reports coverage as fresh embeddings over total indexed", async () => {
    db = await createWorkerTestDb();
    await seedIndexedEmail(db, { uid: "embedded", subject: "Embedded bill", email_date: "2026-05-03T12:00:00Z" });
    const bare = await seedIndexedEmail(db, { uid: "bare", subject: "Bare bill", email_date: "2026-05-02T12:00:00Z" });
    void bare;
    await upsertFreshEmbedding(db, { uid: "embedded", user_id: "user-1", account_id: "gmail-work" });

    const ratio = await getEmailSearchEmbeddingCoverageRatio("user-1", { dbClient: db });
    expect(ratio).toBeCloseTo(0.5, 6);
  });

  it("returns null coverage when nothing is indexed", async () => {
    db = await createWorkerTestDb();
    const ratio = await getEmailSearchEmbeddingCoverageRatio("nobody", { dbClient: db });
    expect(ratio).toBeNull();
  });

  it("embeds a bounded batch and resumes by skipping fresh rows", async () => {
    db = await createWorkerTestDb();
    await seedIndexedEmail(db, { uid: "first", subject: "First bill", email_date: "2026-05-03T12:00:00Z" });
    await seedIndexedEmail(db, { uid: "second", subject: "Second bill", email_date: "2026-05-02T12:00:00Z" });
    await seedIndexedEmail(db, { uid: "third", subject: "Third bill", email_date: "2026-05-01T12:00:00Z" });
    const embed = vi.fn(async (texts: string[]) => texts.map((_text, index) => [1, index, 0]) as EmailSearchEmbeddingVectors);

    const firstRun = await processEmailSearchEmbeddingBatch("user-1", {
      dbClient: db,
      embeddingClient: { embed },
      capability: { mode: "fallback" },
      limit: 2,
      batchSize: 2,
    });
    const secondRun = await processEmailSearchEmbeddingBatch("user-1", {
      dbClient: db,
      embeddingClient: { embed },
      capability: { mode: "fallback" },
      limit: 2,
      batchSize: 2,
    });

    expect(firstRun).toMatchObject({
      status: "active",
      selected: 2,
      embedded: 2,
      failed: 0,
      semantic_status: "local_fallback",
    });
    expect(secondRun).toMatchObject({
      status: "active",
      selected: 1,
      embedded: 1,
      failed: 0,
      semantic_status: "active",
    });
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls.map(([texts]) => texts.length)).toEqual([2, 1]);

    const stored = await db.execute(
      "SELECT uid FROM ea_email_search_embeddings ORDER BY uid",
    );
    expect(stored.rows.map((row) => row.uid)).toEqual(["first", "second", "third"]);
  });

  it("records corpus embedding usage for each provider batch without storing content", async () => {
    db = await createWorkerTestDb();
    await seedIndexedEmail(db, { uid: "first", subject: "First bill" });
    await seedIndexedEmail(db, { uid: "second", subject: "Second bill" });
    const embed = vi.fn(async (texts: string[]) => {
      const vectors = texts.map((_text, index) => [1, index, 0]) as EmailSearchEmbeddingVectors;
      Object.defineProperties(vectors, {
        model: { value: "text-embedding-3-small", enumerable: false },
        usage: { value: { prompt_tokens: 77, total_tokens: 77 }, enumerable: false },
      });
      return vectors;
    });

    await processEmailSearchEmbeddingBatch("user-1", {
      dbClient: db,
      embeddingClient: { embed },
      capability: { mode: "fallback" },
      limit: 2,
      batchSize: 2,
    });

    const usage = await db.execute({
      sql: `SELECT event_type, model, input_tokens, output_tokens, estimated,
                   estimated_cost_usd, metadata_json
            FROM ea_email_search_ai_usage`,
    });

    expect(usage.rows).toEqual([
      expect.objectContaining({
        event_type: "corpus_embedding",
        model: "text-embedding-3-small",
        input_tokens: 77,
        output_tokens: 0,
        estimated: 0,
      }),
    ]);
    expect(Number(usage.rows[0]!.estimated_cost_usd)).toBeGreaterThan(0);
    expect(JSON.stringify(usage.rows)).not.toContain("First bill");
    expect(JSON.parse(String(usage.rows[0]!.metadata_json))).toEqual({
      embedded: 2,
      batch_size: 2,
    });
  });

  it("prioritizes active/actionable and recent rows ahead of historical rows", async () => {
    db = await createWorkerTestDb();
    await seedIndexedEmail(db, {
      uid: "historical",
      subject: "Old receipt",
      email_date: "2026-01-01T12:00:00Z",
    });
    await seedIndexedEmail(db, {
      uid: "recent",
      subject: "Recent receipt",
      email_date: "2026-05-01T12:00:00Z",
    });
    await seedIndexedEmail(db, {
      uid: "active-action",
      subject: "Action needed",
      email_date: "2026-02-01T12:00:00Z",
    });
    await db.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, triage_status)
            VALUES (?, ?, ?, 'needs_attention', 'finance', 'high', 'complete')`,
      args: ["user-1", "gmail-work", "active-action"],
    });
    const snapshot = await db.execute({
      sql: `INSERT INTO ea_briefing_snapshots
              (user_id, start_at, end_at, timezone, status)
            VALUES (?, ?, ?, 'America/Los_Angeles', 'active')
            RETURNING id`,
      args: ["user-1", "2026-05-01T07:00:00.000Z", "2026-05-02T07:00:00.000Z"],
    });
    await db.execute({
      sql: `INSERT INTO ea_briefing_snapshot_items
              (snapshot_id, triage_id, user_id, account_id, email_id, lane_at_snapshot)
            VALUES (?, (SELECT id FROM ea_email_triage WHERE email_id = ?), ?, ?, ?, 'needs_attention')`,
      args: [snapshot.rows[0]!.id ?? null, "active-action", "user-1", "gmail-work", "active-action"],
    });
    const seenSubjects: Array<string | undefined> = [];
    const embed = vi.fn(async (texts: string[]) => {
      seenSubjects.push(...texts.map((text) => text.match(/Subject: ([^\n]+)/)?.[1]));
      return texts.map((_text, index) => [1, index, 0]) as EmailSearchEmbeddingVectors;
    });

    await processEmailSearchEmbeddingBatch("user-1", {
      dbClient: db,
      embeddingClient: { embed },
      capability: { mode: "fallback" },
      limit: 3,
      batchSize: 3,
    });

    expect(seenSubjects).toEqual([
      "Action needed",
      "Recent receipt",
      "Old receipt",
    ]);
  });

  it("re-embeds stale source-hash rows while leaving fresh rows alone", async () => {
    db = await createWorkerTestDb();
    const fresh = await seedIndexedEmail(db, { uid: "fresh", subject: "Already fresh" });
    const stale = await seedIndexedEmail(db, { uid: "stale", subject: "Original subject" });
    await upsertFreshEmbedding(db, fresh as unknown as EmailSearchEmbeddingSourceRow & SeedIndexedEmailRow, [1, 0, 0]);
    await upsertFreshEmbedding(db, stale as unknown as EmailSearchEmbeddingSourceRow & SeedIndexedEmailRow, [0, 1, 0]);
    await db.execute({
      sql: "UPDATE ea_email_index SET subject = ? WHERE uid = ?",
      args: ["Updated subject", stale.uid],
    });
    const embeddedSubjects: Array<string | undefined> = [];
    const embed = vi.fn(async (texts: string[]) => {
      embeddedSubjects.push(...texts.map((text) => text.match(/Subject: ([^\n]+)/)?.[1]));
      return texts.map(() => [0.5, 0.5, 0]) as EmailSearchEmbeddingVectors;
    });

    const result = await processEmailSearchEmbeddingBatch("user-1", {
      dbClient: db,
      embeddingClient: { embed },
      capability: { mode: "fallback" },
      limit: 10,
    });

    expect(result).toMatchObject({ selected: 1, embedded: 1, failed: 0 });
    expect(embeddedSubjects).toEqual(["Updated subject"]);
  });

  it("records provider failures in status without throwing or logging content", async () => {
    db = await createWorkerTestDb();
    await seedIndexedEmail(db, { uid: "needs-embedding", subject: "Sensitive subject" });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const embed = vi.fn(async () => {
      const err = new Error("OPENAI_API_KEY not set for email search embeddings") as EmailSearchEmbeddingError;
      err.code = "email_search_embeddings_unavailable";
      err.status = 503;
      throw err;
    });

    const result = await processEmailSearchEmbeddingBatch("user-1", {
      dbClient: db,
      embeddingClient: { embed },
      capability: { mode: "fallback" },
      limit: 5,
    });
    const status = await getEmailSearchEmbeddingCoverageStatus("user-1", { dbClient: db });

    expect(result).toMatchObject({
      status: "unavailable",
      selected: 1,
      embedded: 0,
      failed: 1,
      error_class: "email_search_embeddings_unavailable",
    });
    expect(status).toMatchObject({
      semantic_status: "unavailable",
      total_indexed: 1,
      fresh_embeddings: 0,
      stale_embeddings: 0,
      missing_embeddings: 1,
      last_error_class: "email_search_embeddings_unavailable",
    });
    expect(JSON.stringify(status)).not.toContain("Sensitive subject");
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("reports coverage counts without exposing email content", async () => {
    db = await createWorkerTestDb();
    const fresh = await seedIndexedEmail(db, { uid: "fresh", subject: "Fresh private subject" });
    const stale = await seedIndexedEmail(db, { uid: "stale", subject: "Stale private subject" });
    await seedIndexedEmail(db, { uid: "missing", subject: "Missing private subject" });
    await upsertFreshEmbedding(db, fresh as unknown as EmailSearchEmbeddingSourceRow & SeedIndexedEmailRow, [1, 0, 0]);
    await upsertFreshEmbedding(db, stale as unknown as EmailSearchEmbeddingSourceRow & SeedIndexedEmailRow, [0, 1, 0]);
    await db.execute({
      sql: "UPDATE ea_email_index SET body_text = ? WHERE uid = ?",
      args: ["Changed private body", stale.uid],
    });

    const status = await getEmailSearchEmbeddingCoverageStatus("user-1", { dbClient: db });

    expect(status).toMatchObject({
      semantic_status: "local_fallback",
      mode: "fallback",
      total_indexed: 3,
      fresh_embeddings: 1,
      stale_embeddings: 1,
      missing_embeddings: 1,
      coverage_ratio: 1 / 3,
    });
    expect(JSON.stringify(status)).not.toContain("private");
  });

  it("processes indexed users through bounded per-user batches", async () => {
    db = await createWorkerTestDb();
    await seedIndexedEmail(db, { uid: "user-1-message", user_id: "user-1", subject: "First user" });
    await seedIndexedEmail(db, { uid: "user-2-message", user_id: "user-2", subject: "Second user" });
    const embed = vi.fn(async (texts: string[]) => texts.map((_text, index) => [1, index, 0]) as EmailSearchEmbeddingVectors);

    const result = await processEmailSearchEmbeddingBatchesForAllUsers({
      dbClient: db,
      embeddingClient: { embed },
      capability: { mode: "fallback" },
      limit: 1,
    });

    expect(result).toEqual({
      processed: true,
      users: [
        expect.objectContaining({ user_id: "user-1", embedded: 1, selected: 1 }),
        expect.objectContaining({ user_id: "user-2", embedded: 1, selected: 1 }),
      ],
    });
  });

  it("does not run an unbounded full-body coverage scan on a steady-state cron run (P1-9)", async () => {
    db = await createWorkerTestDb();
    const fresh = await seedIndexedEmail(db, { uid: "fresh", subject: "Already embedded" });
    await upsertFreshEmbedding(db, fresh as unknown as EmailSearchEmbeddingSourceRow & SeedIndexedEmailRow);

    const executed: string[] = [];
    const realExecute = db.execute.bind(db);
    db.execute = (arg) => {
      executed.push(typeof arg === "string" ? arg : arg.sql);
      return realExecute(arg);
    };

    const result = await processEmailSearchEmbeddingBatch("user-1", {
      dbClient: db,
      embeddingClient: { embed: vi.fn() },
      capability: { mode: "fallback" },
    });

    expect(result).toMatchObject({ status: "active", embedded: 0 });

    // The bounded candidate query may fetch bodies (it is LIMIT-guarded); the bug
    // is the EXTRA unbounded full-table body scan the coverage status ran twice
    // per cron tick. After the fix, no body_text SELECT runs without a LIMIT.
    const unboundedBodyScans = executed.filter(
      (sql) => /body_text/.test(sql) && !/\blimit\b/i.test(sql),
    );
    expect(unboundedBodyScans).toEqual([]);
  });
});
