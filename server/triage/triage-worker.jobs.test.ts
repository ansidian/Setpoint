import { describe, expect, it, vi } from "vitest";
import { createMigratedDb, queueEmail } from "./triage-worker.test-utils.ts";
import {
  processNextEmailTriageJob,
  recoverStaleRunningTriageJobs,
  createTriageBatchContext,
  pruneCompletedTriageJobs,
} from "./triage-worker.ts";
import { claimNextEmailTriageJob } from "./triage-job-store.ts";

describe("email triage worker jobs", () => {
  it("allows only one worker to claim a queued job", async () => {
    const dbClient = await createMigratedDb();
    try {
      await queueEmail(dbClient);
      const now = new Date("2026-05-03T12:00:00.000Z");

      const claims = await Promise.all([
        claimNextEmailTriageJob(dbClient, now),
        claimNextEmailTriageJob(dbClient, now),
      ]);

      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.find(Boolean)).toMatchObject({
        email_id: "msg-1",
        status: "queued",
      });
      const persisted = await dbClient.execute({
        sql: "SELECT status, attempts, locked_at FROM ea_triage_jobs WHERE email_id = ?",
        args: ["msg-1"],
      });
      expect(persisted.rows[0]).toMatchObject({
        status: "running",
        attempts: 1,
        locked_at: now.toISOString(),
      });
    } finally {
      await dbClient.close();
    }
  });

  it("recovers stale running email triage and Gmail history jobs without resetting attempts", async () => {
    const dbClient = await createMigratedDb();
    await dbClient.batch([
      {
        sql: `INSERT INTO ea_triage_jobs
                (user_id, account_id, email_id, job_type, status, idempotency_key,
                 attempts, locked_at)
              VALUES (?, ?, ?, 'email_triage', 'running', ?, 2, ?)`,
        args: [
          "user-1",
          "gmail-work",
          "msg-1",
          "email_triage:user-1:gmail-work:msg-1",
          "2026-05-03T11:40:00.000Z",
        ],
      },
      {
        sql: `INSERT INTO ea_triage_jobs
                (user_id, account_id, email_id, job_type, status, idempotency_key,
                 attempts, locked_at)
              VALUES (?, ?, NULL, 'gmail_history_sync', 'running', ?, 3, ?)`,
        args: [
          "user-1",
          "gmail-work",
          "gmail_history_sync:user-1:gmail-work:100",
          "2026-05-03T11:44:59.000Z",
        ],
      },
      {
        sql: `INSERT INTO ea_triage_jobs
                (user_id, account_id, email_id, job_type, status, idempotency_key,
                 attempts, locked_at)
              VALUES (?, ?, ?, 'email_triage', 'running', ?, 5, ?)`,
        args: [
          "user-1",
          "gmail-work",
          "fresh-msg",
          "email_triage:user-1:gmail-work:fresh-msg",
          "2026-05-03T11:50:01.000Z",
        ],
      },
      {
        sql: `INSERT INTO ea_triage_jobs
                (user_id, account_id, email_id, job_type, status, idempotency_key,
                 attempts, locked_at)
              VALUES (?, ?, ?, 'other_job', 'running', ?, 7, ?)`,
        args: [
          "user-1",
          "gmail-work",
          "other-msg",
          "other_job:user-1:gmail-work:other-msg",
          "2026-05-03T11:30:00.000Z",
        ],
      },
    ]);

    const result = await recoverStaleRunningTriageJobs({
      dbClient,
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    expect(result.recovered).toBe(2);
    const jobs = await dbClient.execute({
      sql: `SELECT job_type, email_id, status, attempts, locked_at, last_error
            FROM ea_triage_jobs
            ORDER BY id`,
      args: [],
    });
    expect(jobs.rows).toEqual([
      {
        job_type: "email_triage",
        email_id: "msg-1",
        status: "queued",
        attempts: 2,
        locked_at: null,
        last_error: "Recovered stale running job",
      },
      {
        job_type: "gmail_history_sync",
        email_id: null,
        status: "queued",
        attempts: 3,
        locked_at: null,
        last_error: "Recovered stale running job",
      },
      expect.objectContaining({
        job_type: "email_triage",
        email_id: "fresh-msg",
        status: "running",
        attempts: 5,
      }),
      expect.objectContaining({
        job_type: "other_job",
        email_id: "other-msg",
        status: "running",
        attempts: 7,
      }),
    ]);
    await dbClient.close();
    });

  it("createTriageBatchContext resolves each user's config once per batch (P1-7)", async () => {
    const dbClient = await createMigratedDb();
    const batch = createTriageBatchContext({ dbClient });

    // Repeated lookups for the same user return the SAME in-flight promise, so
    // the underlying ea_settings / ea_triage_rules read happens once per batch.
    expect(batch.getMode("user-1")).toBe(batch.getMode("user-1"));
    expect(batch.getClassifyReadArrivals("user-1")).toBe(batch.getClassifyReadArrivals("user-1"));
    expect(batch.getRules("user-1")).toBe(batch.getRules("user-1"));
    expect(batch.getInterests("user-1")).toBe(batch.getInterests("user-1"));
    expect(batch.getModelClient("user-1")).toBe(batch.getModelClient("user-1"));

    // Distinct users get distinct cache entries (per-user correctness).
    expect(batch.getRules("user-1")).not.toBe(batch.getRules("user-2"));

    await Promise.allSettled([
      batch.getMode("user-1"),
      batch.getClassifyReadArrivals("user-1"),
      batch.getRules("user-1"),
      batch.getInterests("user-1"),
      batch.getModelClient("user-1"),
      batch.getRules("user-2"),
    ]);
  });

  it("processes a queued job when driven through a batch context (P1-7)", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient);
    await dbClient.execute({
      sql: "UPDATE ea_settings SET email_triage_mode = 'no_model' WHERE user_id = ?",
      args: ["user-1"],
    });
    const batch = createTriageBatchContext({ dbClient });

    const result = await processNextEmailTriageJob({
      dbClient,
      batch,
      now: new Date("2026-05-03T12:12:00.000Z"),
    });

    expect(result.processed).toBe(true);
    const jobs = await dbClient.execute({
      sql: "SELECT status FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(jobs.rows[0]!.status).toBe("complete");
  });

  it("prunes only completed triage jobs older than the retention window (P3-8)", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-10T00:00:00.000Z");
    const oldCompletedAt = new Date("2026-05-01T00:00:00.000Z").toISOString(); // 9d > 7d
    const recentCompletedAt = new Date("2026-05-08T00:00:00.000Z").toISOString(); // 2d < 7d
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, completed_at, idempotency_key)
            VALUES
              ('user-1', 'gmail-work', 'old-msg', 'email_triage', 'complete', ?, 'k-old'),
              ('user-1', 'gmail-work', 'recent-msg', 'email_triage', 'complete', ?, 'k-recent'),
              ('user-1', 'gmail-work', 'queued-msg', 'email_triage', 'queued', NULL, 'k-queued')`,
      args: [oldCompletedAt, recentCompletedAt],
    });

    const pruned = await pruneCompletedTriageJobs({ dbClient, now });
    expect(pruned).toBe(1);

    const remaining = await dbClient.execute({
      sql: "SELECT email_id FROM ea_triage_jobs ORDER BY email_id",
      args: [],
    });
    expect(remaining.rows.map((row) => row.email_id)).toEqual(["queued-msg", "recent-msg"]);
  });

  it("leaves email triage jobs queued when mode is paused", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient);
    await dbClient.execute({
      sql: "UPDATE ea_settings SET email_triage_mode = 'paused' WHERE user_id = ?",
      args: ["user-1"],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:12:00.000Z"),
    });

    expect(result).toEqual({
      processed: false,
      paused: true,
      email_triage_mode: "paused",
      effective_email_triage_mode: "paused",
    });
    const jobs = await dbClient.execute({
      sql: "SELECT status, attempts, locked_at FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(jobs.rows[0]).toMatchObject({
      status: "queued",
      attempts: 0,
      locked_at: null,
    });
    });

  it("skips already-finalized triage rows instead of reprocessing them", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Already handled",
      body_snippet: "This row was previously triaged.",
    });
    await dbClient.execute({
      sql: `UPDATE ea_email_triage
            SET triage_status = 'complete',
                last_triaged_at = '2026-05-03T11:00:00.000Z',
                lane = 'fyi'
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:35:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      skipped: true,
    });
    const snapshots = await dbClient.execute({
      sql: "SELECT * FROM ea_briefing_snapshot_items WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(snapshots.rows).toHaveLength(0);
    });
});
