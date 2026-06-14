import { describe, expect, it, vi } from "vitest";
import { createMigratedDb, queueEmail } from "./triage-worker.test-utils.js";
import { processNextEmailTriageJob, recoverStaleRunningTriageJobs } from "./triage-worker.js";

describe("email triage worker jobs", () => {
  it("does not process a job when another worker claims it first", async () => {
    const queuedJob = {
      id: 7,
      user_id: "user-1",
      account_id: "gmail-work",
      email_id: "msg-1",
      job_type: "email_triage",
      status: "queued",
    };
    const dbClient = {
      execute: vi.fn(async (query) => {
        const sql = typeof query === "string" ? query : query.sql;
        if (sql.includes("FROM ea_triage_jobs") && sql.includes("LIMIT 1")) {
          return { rows: [queuedJob] };
        }
        if (sql.includes("SELECT email_triage_mode")) {
          return { rows: [{ email_triage_mode: "real" }] };
        }
        if (sql.includes("UPDATE ea_triage_jobs") && sql.includes("status = 'running'")) {
          return { rows: [], rowsAffected: 0 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    await expect(processNextEmailTriageJob({ dbClient }))
      .resolves
      .toEqual({ processed: false });
    expect(dbClient.execute).toHaveBeenCalledTimes(4);
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
    expect(modelClient.classify).not.toHaveBeenCalled();

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
    expect(modelClient.classify).not.toHaveBeenCalled();

    const snapshots = await dbClient.execute({
      sql: "SELECT * FROM ea_briefing_snapshot_items WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(snapshots.rows).toHaveLength(0);
    });
});
