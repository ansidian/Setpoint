import db from "../db/connection.ts";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.ts";
import type { TriageDb, TriageJob } from "./triage-types.ts";

// ea_triage_jobs queue persistence lifted from triage-worker.ts: claim, requeue,
// complete, defer, stale-recovery, and retention prune. Keeps the queue SQL and
// its atomic-claim / attempt-count invariants in one place; the worker imports
// these and re-exports the two scheduler-facing sweeps.

const STALE_RUNNING_JOB_TYPES = ["email_triage", "gmail_history_sync"];
const DEFAULT_STALE_RUNNING_JOB_MS = 15 * 60 * 1000;
// P3-67: a deterministically-failing job is recovered (re-queued) by every stale
// sweep, re-claimed, incremented, and re-run forever — burning model spend each
// pass. Cap recovery attempts; past the ceiling the job moves to a terminal
// 'failed' status instead of being re-queued.
const MAX_STALE_RECOVERY_ATTEMPTS = 5;

export function nowIso(now: Date): string {
  return now.toISOString();
}

const TRIAGE_BACKOFF_BASE_MS = 30_000;
const TRIAGE_BACKOFF_CAP_MS = 10 * 60_000;
export const MAX_TRIAGE_RETRY_ATTEMPTS = 5;

// Capped exponential backoff for re-queuing a triage job after a transient
// failure (provider 429/5xx or a mid-finalize error), so it isn't terminal
// (P2-31/32/37). P3-67's stale-recovery attempt cap lives in
// recoverStaleRunningTriageJobs below (auto-merged) — the two fixes are independent.
export function triageRetryBackoffIso(now: Date, attempts: unknown): string {
  const ms = Math.min(2 ** Number(attempts || 0) * TRIAGE_BACKOFF_BASE_MS, TRIAGE_BACKOFF_CAP_MS);
  return new Date(now.getTime() + ms).toISOString();
}

export async function recoverStaleRunningTriageJobs({
  dbClient = db as unknown as TriageDb,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_RUNNING_JOB_MS,
  maxAttempts = MAX_STALE_RECOVERY_ATTEMPTS,
}: { dbClient?: TriageDb; now?: Date; staleAfterMs?: number; maxAttempts?: number } = {}): Promise<{ recovered: number; failed: number }> {
  const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();
  const jobTypePlaceholders = STALE_RUNNING_JOB_TYPES.map(() => "?").join(", ");
  const staleStatusFilter = `status = 'running'
            AND job_type IN (${jobTypePlaceholders})
            AND locked_at IS NOT NULL
            AND locked_at <= ?`;

  // P3-67: identify stale running jobs that have already burned through the
  // attempt ceiling before re-queueing the rest. These are deterministically
  // failing — re-queueing them again would re-run the model and loop forever.
  // Capture them first so we can emit a triage_failed event per job.
  const overCeiling = await dbClient.execute({
    sql: `SELECT id, user_id, account_id, email_id, attempts
          FROM ea_triage_jobs
          WHERE ${staleStatusFilter}
            AND attempts >= ?`,
    args: [...STALE_RUNNING_JOB_TYPES, staleBefore, maxAttempts],
  });

  // Move the over-ceiling jobs to a terminal 'failed' status. The conditional
  // guard (still running + still stale + at/over the ceiling) keeps the claim
  // atomic against a concurrent sweep or claim.
  const failResult = await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'failed',
              locked_at = NULL,
              completed_at = datetime('now'),
              last_error = ?,
              updated_at = datetime('now')
          WHERE ${staleStatusFilter}
            AND attempts >= ?`,
    args: [
      `Triage job exceeded ${maxAttempts} recovery attempts; marked failed`,
      ...STALE_RUNNING_JOB_TYPES,
      staleBefore,
      maxAttempts,
    ],
  });

  for (const job of overCeiling.rows as TriageJob[]) {
    publishCurrentDashboardEvent(job.user_id, {
      source: "email_triage",
      reason: "triage_failed",
      state: "current",
      occurredAt: nowIso(now),
      details: {
        triggerType: "triage_failed",
        eventKey: `triage_failed:${job.account_id}:${job.email_id}:max_attempts`,
        emailId: job.email_id,
        reason: "max_recovery_attempts_exceeded",
        attempts: Number(job.attempts),
      },
    });
  }

  // Re-queue the remaining stale running jobs (still under the ceiling).
  const result = await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'queued',
              locked_at = NULL,
              last_error = ?,
              updated_at = datetime('now')
          WHERE ${staleStatusFilter}
            AND attempts < ?`,
    args: [
      "Recovered stale running job",
      ...STALE_RUNNING_JOB_TYPES,
      staleBefore,
      maxAttempts,
    ],
  });
  return {
    recovered: Number(result.rowsAffected || 0),
    failed: Number(failResult.rowsAffected || 0),
  };
}

const COMPLETED_TRIAGE_JOB_RETENTION_DAYS = 7;

// P3-8: completed jobs are marked 'complete' but never deleted, so ea_triage_jobs
// grows one durable row per email forever. Durable triage history lives in
// ea_email_triage, so completed job rows past the retention window are safe to
// sweep. Runs on a low-frequency cron, off the hot status='queued' claim path
// (completed rows already sit in a separate region of idx_triage_jobs_status).
export async function pruneCompletedTriageJobs({
  dbClient = db as unknown as TriageDb,
  retentionDays = COMPLETED_TRIAGE_JOB_RETENTION_DAYS,
  now = new Date(),
}: { dbClient?: TriageDb; retentionDays?: number; now?: Date } = {}): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await dbClient.execute({
    sql: `DELETE FROM ea_triage_jobs
          WHERE status = 'complete'
            AND completed_at IS NOT NULL
            AND completed_at < ?`,
    args: [cutoff],
  });
  return Number(result.rowsAffected || 0);
}

export async function claimNextEmailTriageJob(dbClient: TriageDb, now: Date): Promise<TriageJob | null> {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_triage_jobs
          WHERE job_type = 'email_triage'
            AND status = 'queued'
            AND (scheduled_for IS NULL OR scheduled_for <= ?)
          ORDER BY priority ASC, created_at ASC
          LIMIT 1`,
    args: [nowIso(now)],
  });
  const job = result.rows[0] as TriageJob | undefined;
  if (!job) return null;
  const claim = await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'running',
              attempts = attempts + 1,
              locked_at = ?,
              updated_at = datetime('now')
          WHERE id = ? AND status = 'queued'`,
    args: [nowIso(now), job.id],
  });
  if (Number(claim.rowsAffected || 0) === 0) return null;
  return job;
}

// P2-18: return a claimed job to the queue without consuming a retry attempt
// (claimNextEmailTriageJob incremented attempts; reset it to the pre-claim value).
export async function requeueClaimedJob(job: TriageJob, dbClient: TriageDb): Promise<void> {
  await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'queued',
              attempts = ?,
              locked_at = NULL,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [Number(job.attempts || 0), job.id],
  });
}

export async function completeJob(job: TriageJob, dbClient: TriageDb, now: Date, lastError = ""): Promise<void> {
  await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'complete',
              completed_at = ?,
              locked_at = NULL,
              scheduled_for = NULL,
              last_error = ?,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [nowIso(now), lastError, job.id],
  });
}

export async function deferJob(job: TriageJob, dbClient: TriageDb, scheduledFor: string, lastError = ""): Promise<void> {
  await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'queued',
              locked_at = NULL,
              scheduled_for = ?,
              completed_at = NULL,
              last_error = ?,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [scheduledFor, lastError, job.id],
  });
}
