import { describe, expect, it, vi } from "vitest";
import {
  __resetCurrentDashboardEventsForTests,
  subscribeCurrentDashboardEvents,
} from "../dashboard/current-events.ts";
import { createMigratedDb, queueEmail } from "./triage-worker.test-utils.ts";
import {
  processNextEmailTriageJob,
  recoverStaleRunningTriageJobs,
} from "./triage-worker.ts";
import type { Client } from "@libsql/client";

async function insertStaleRunningJob(dbClient: Client, { emailId, attempts, lockedAt }: {
  emailId: string;
  attempts: number;
  lockedAt: string;
}) {
  await dbClient.execute({
    sql: `INSERT INTO ea_triage_jobs
            (user_id, account_id, email_id, job_type, status, idempotency_key,
             attempts, locked_at)
          VALUES (?, 'gmail-work', ?, 'email_triage', 'running', ?, ?, ?)`,
    args: [
      "user-1",
      emailId,
      `email_triage:user-1:gmail-work:${emailId}`,
      attempts,
      lockedAt,
    ],
  });
}

describe("email triage worker stale-recovery attempt ceiling (P3-67)", () => {
  it("moves an over-ceiling stale job to terminal 'failed' and emits triage_failed instead of re-queueing", async () => {
    __resetCurrentDashboardEventsForTests();
    const dbClient = await createMigratedDb();
    // Two stale running jobs: one under the ceiling (re-queued), one at the
    // ceiling (terminal failed). Both locked well before the stale cutoff.
    await insertStaleRunningJob(dbClient, {
      emailId: "msg-retry",
      attempts: 2,
      lockedAt: "2026-05-03T11:40:00.000Z",
    });
    await insertStaleRunningJob(dbClient, {
      emailId: "msg-dead",
      attempts: 5,
      lockedAt: "2026-05-03T11:40:00.000Z",
    });

    const events: Record<string, unknown>[] = [];
    const unsubscribe = subscribeCurrentDashboardEvents("user-1", (event: Record<string, unknown>) =>
      events.push(event),
    );

    const result = await recoverStaleRunningTriageJobs({
      dbClient,
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    unsubscribe();

    expect(result).toEqual({ recovered: 1, failed: 1 });

    const jobs = await dbClient.execute({
      sql: `SELECT email_id, status, attempts, locked_at, completed_at, last_error
            FROM ea_triage_jobs
            ORDER BY email_id`,
      args: [],
    });
    expect(jobs.rows).toEqual([
      expect.objectContaining({
        email_id: "msg-dead",
        status: "failed",
        attempts: 5,
        locked_at: null,
        last_error: "Triage job exceeded 5 recovery attempts; marked failed",
      }),
      expect.objectContaining({
        email_id: "msg-retry",
        status: "queued",
        attempts: 2,
        locked_at: null,
        last_error: "Recovered stale running job",
      }),
    ]);
    // The terminal job must record a completion timestamp so it cannot be
    // re-claimed as a fresh queued job.
    const dead = jobs.rows.find((row) => row.email_id === "msg-dead");
    expect(dead!.completed_at).not.toBeNull();

    // A triage_failed event fires for the dead job only.
    expect(events).toHaveLength(1);
    expect(events[0]!).toMatchObject({
      source: "email_triage",
      reason: "triage_failed",
      details: {
        triggerType: "triage_failed",
        emailId: "msg-dead",
        reason: "max_recovery_attempts_exceeded",
        attempts: 5,
      },
    });
  });

  it("respects a custom maxAttempts ceiling", async () => {
    __resetCurrentDashboardEventsForTests();
    const dbClient = await createMigratedDb();
    await insertStaleRunningJob(dbClient, {
      emailId: "msg-low",
      attempts: 2,
      lockedAt: "2026-05-03T11:40:00.000Z",
    });

    const result = await recoverStaleRunningTriageJobs({
      dbClient,
      now: new Date("2026-05-03T12:00:00.000Z"),
      maxAttempts: 2,
    });

    expect(result).toEqual({ recovered: 0, failed: 1 });
    const job = await dbClient.execute({
      sql: "SELECT status FROM ea_triage_jobs WHERE email_id = ?",
      args: ["msg-low"],
    });
    expect(job.rows[0]!.status).toBe("failed");
  });
});

describe("email triage worker snooze join is account-scoped (P3-68)", () => {
  it("does not defer a different account's email that shares a uid with a snoozed one", async () => {
    __resetCurrentDashboardEventsForTests();
    const dbClient = await createMigratedDb();

    // Account A (gmail-work) owns the indexed email msg-1 and snoozes it.
    await queueEmail(dbClient, { uid: "msg-1" });
    await dbClient.execute({
      sql: `INSERT INTO ea_snoozed_emails (user_id, email_id, until_ts, status)
            VALUES (?, ?, ?, 'snoozed')`,
      args: ["user-1", "msg-1", Date.parse("2026-05-04T17:46:40.000Z")],
    });
    // Drain account A's job so account B's job is next.
    await dbClient.execute({
      sql: "UPDATE ea_triage_jobs SET status = 'complete' WHERE account_id = 'gmail-work'",
      args: [],
    });

    // Account B (icloud-home) has a triage row + queued job for the SAME uid
    // (icloud uids don't embed account.id, so cross-account collisions happen),
    // but account B never snoozed this email.
    await dbClient.execute({
      sql: `INSERT INTO ea_email_triage (user_id, account_id, email_id, provider_state)
            VALUES ('user-1', 'icloud-home', 'msg-1', 'available')`,
      args: [],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, idempotency_key)
            VALUES ('user-1', 'icloud-home', 'msg-1', 'email_triage',
                    'email_triage:user-1:icloud-home:msg-1')`,
      args: [],
    });

    const modelClient = {
      classify: vi.fn(async () => ({
        lane: "needs_attention",
        category: "uncategorized",
        urgency: "normal",
        summary: "Classified",
        action: "Review",
        confidence: 0.9,
      })),
    };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:38:00.000Z"),
    });

    // Account B's job must NOT be deferred as snoozed — it should run normally.
    expect(result.source).not.toBe("snoozed_pending");
    expect(result).toMatchObject({ processed: true, email_id: "msg-1" });
    expect(modelClient.classify).toHaveBeenCalled();

    const job = await dbClient.execute({
      sql: "SELECT status FROM ea_triage_jobs WHERE account_id = 'icloud-home' AND email_id = 'msg-1'",
      args: [],
    });
    expect(job.rows[0]!.status).toBe("complete");
  });

  it("still defers the snoozed email for the account that actually owns it", async () => {
    __resetCurrentDashboardEventsForTests();
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, { uid: "msg-1" });
    await dbClient.execute({
      sql: `INSERT INTO ea_snoozed_emails (user_id, email_id, until_ts, status)
            VALUES (?, ?, ?, 'snoozed')`,
      args: ["user-1", "msg-1", Date.parse("2026-05-04T17:46:40.000Z")],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:38:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      delayed: true,
      source: "snoozed_pending",
      scheduled_for: "2026-05-04T17:46:40.000Z",
    });
    expect(modelClient.classify).not.toHaveBeenCalled();
  });
});
