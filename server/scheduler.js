import cron from "node-cron";
import db from "./db/connection.js";
import { loadUserConfig } from "./platform/config-service.js";
import { fetchAllEmails } from "./email/email-fetch.js";
import { indexEmails } from "./email/email-index.js";
import { advanceSnapshotBoundary } from "./snapshots/snapshot-service.js";
import {
  enqueueEmailTriageForEmails,
  processNextGmailHistorySyncJob,
  renewDueGmailWatches,
} from "./email/gmail-sync.js";
import {
  processNextEmailTriageJob,
  recoverStaleRunningTriageJobs,
  createTriageBatchContext,
  pruneCompletedTriageJobs,
} from "./triage/triage-worker.js";
import { processEmailSearchEmbeddingBatchesForAllUsers } from "./email/search/email-search-embedding-worker.js";
import { processDueReminderBatch } from "./reminders/reminder-scheduler.js";

const activeJobs = [];
// Background indexer state lives outside activeJobs so initScheduler's re-runs
// (triggered on account changes) don't tear down the passive email sweep.
let indexerJob = null;
let sweepInFlight = false;
let gmailWatchRenewalJob = null;
let gmailHistorySyncJob = null;
let gmailHistorySyncInFlight = false;
let emailTriageJob = null;
let emailTriageInFlight = false;
let emailSearchEmbeddingJob = null;
let emailSearchEmbeddingInFlight = false;
let triageJobPruneJob = null;
let reminderSchedulerTimer = null;
// Tracked as a PROMISE (not a boolean) so the shutdown handler can await an
// in-flight reminder batch and let the last tick drain before exit. null when
// idle; non-null acts as the single-flight guard.
let reminderSchedulerInFlight = null;
// 2h lookback gives the 10-minute cadence generous overlap — nothing falls
// through the cracks if one sweep runs long or a briefing pauses the pipeline.
const INDEXER_LOOKBACK_HOURS = 2;
const INDEXER_CRON = "*/10 * * * *";
const GMAIL_WATCH_RENEWAL_CRON = "17 3 * * *";
const GMAIL_HISTORY_SYNC_CRON = "* * * * *";
// Every 30s (6-field) so triage fires near the 30s arrival-grace deadline rather
// than waiting up to a full minute for the next tick. runEmailTriageWorker's
// in-flight guard makes overlapping ticks no-ops, so a run longer than 30s just
// skips the next tick.
const EMAIL_TRIAGE_CRON = "*/30 * * * * *";
const EMAIL_SEARCH_EMBEDDING_CRON = "*/5 * * * *";
// P3-8: daily off-peak sweep of long-completed triage jobs (durable history lives
// in ea_email_triage). Far below the stale-window / claim cadence, so it never
// competes with the per-minute workers.
const TRIAGE_JOB_PRUNE_CRON = "23 4 * * *";
const REMINDER_SCHEDULER_INTERVAL_MS = 10_000;
const EMAIL_SEARCH_EMBEDDINGS_DISABLED = process.env.EA_EMAIL_SEARCH_EMBEDDINGS_DISABLED === "1";
const EMAIL_TRIAGE_BATCH_SIZE = 10;
// P2-4: cap consecutive self-reschedules so a deep queue drains promptly within a
// minute without ever spinning forever; the cron tick resumes the drain anyway.
const EMAIL_TRIAGE_MAX_SELF_RESCHEDULES = 50;
let emailTriageSelfRescheduleCount = 0;

function isMissingTableError(err) {
  // libsql surfaces a missing table as "no such table: ..." in the message;
  // mirror the repo pattern used in migrate-encryption.js / snapshot-service.js.
  return /no such table/i.test(String(err?.message || ""));
}

// P3-56 per-row-isolation init body. Invoked by the P2-28 serialization wrapper
// initScheduler() below, which coalesces concurrent re-inits to avoid the
// clear-then-await-then-push window double-registering every cron job.
async function runInitScheduler() {
  // Clear any existing jobs (in case of re-init)
  for (const job of activeJobs) job.stop();
  activeJobs.length = 0;

  let result;
  try {
    result = await db.execute(
      "SELECT user_id, schedules_json FROM ea_settings WHERE schedules_json IS NOT NULL",
    );
  } catch (err) {
    if (isMissingTableError(err)) {
      // ea_settings table may not exist yet on first run before migration
      console.log("[EA Scheduler] Skipping — ea_settings not yet available");
      return;
    }
    // Any other read failure is a real error: surface it instead of silently
    // disabling every schedule behind a misleading "not yet available" log.
    console.error("[EA Scheduler] Failed to load schedules:", err.message);
    return;
  }

  for (const row of result.rows) {
    let schedules;
    try {
      schedules = JSON.parse(row.schedules_json || "[]");
      if (!Array.isArray(schedules)) {
        throw new Error("schedules_json is not an array");
      }
    } catch (err) {
      // One malformed row must not suppress every other user's schedules.
      console.error(
        `[EA Scheduler] Skipping unparseable schedules for user ${row.user_id}:`,
        err.message,
      );
      continue;
    }

    for (const schedule of schedules) {
      try {
        if (!schedule?.enabled) continue;

        const [hour, minute] = schedule.time.split(":");
        const cronExpr = `${parseInt(minute)} ${parseInt(hour)} * * *`;

        const job = cron.schedule(
          cronExpr,
          async () => {
            // Check if this schedule is skipped (re-read from DB for freshness)
            try {
              const fresh = await db.execute({
                sql: "SELECT schedules_json FROM ea_settings WHERE user_id = ?",
                args: [row.user_id],
              });
              const freshSchedules = JSON.parse(fresh.rows[0]?.schedules_json || "[]");
              const match = freshSchedules.find(s => s.time === schedule.time && s.label === schedule.label);
              if (match?.skipped_until && new Date(match.skipped_until) > new Date()) {
                console.log(
                  `[EA Scheduler] Skipping ${schedule.label} snapshot boundary — skipped until ${match.skipped_until}`,
                );
                return;
              }
            } catch (err) {
              console.error("[EA Scheduler] Error checking skip status:", err.message);
            }

            console.log(
              `[EA Scheduler] Advancing ${schedule.label} snapshot boundary for user ${row.user_id}`,
            );
            try {
              await advanceSnapshotBoundary(row.user_id, {
                timeZone: schedule.tz || "America/Los_Angeles",
                scheduleLabel: schedule.label,
              });
              console.log(
                `[EA Scheduler] ${schedule.label} snapshot boundary ready`,
              );
            } catch (err) {
              console.error(
                `[EA Scheduler] ${schedule.label} snapshot boundary failed:`,
                err.message,
              );
            }
          },
          { timezone: schedule.tz || "America/Los_Angeles" },
        );

        activeJobs.push(job);
        console.log(
          `[EA Scheduler] Scheduled ${schedule.label} snapshot boundary at ${schedule.time} ${schedule.tz || "America/Los_Angeles"} for user ${row.user_id}`,
        );
      } catch (err) {
        // A bad cron expression or registration failure on one entry must not
        // abort the remaining schedules for this or any other user.
        console.error(
          `[EA Scheduler] Failed to register schedule "${schedule?.label}" for user ${row.user_id}:`,
          err.message,
        );
      }
    }
  }

  if (activeJobs.length === 0) {
    console.log("[EA Scheduler] No enabled schedules found");
  }
}

let initSchedulerInFlight = null;
let initSchedulerRerun = false;

// Serialize concurrent init calls (startup + un-awaited settings-PUT re-inits).
// Coalescing into one in-flight run prevents the clear-then-await-then-push window
// from double-registering every cron job; the rerun flag guarantees a caller that
// arrived mid-run still gets a fresh re-init afterward (so no schedule change is missed).
export async function initScheduler() {
  if (initSchedulerInFlight) {
    initSchedulerRerun = true;
    return initSchedulerInFlight;
  }
  initSchedulerInFlight = (async () => {
    do {
      initSchedulerRerun = false;
      await runInitScheduler();
    } while (initSchedulerRerun);
  })().finally(() => { initSchedulerInFlight = null; });
  return initSchedulerInFlight;
}

// Passive email indexer: sweeps every account's inbox every 10 minutes and
// upserts recent messages into the FTS index so search finds mail that
// arrived between briefing runs. No email AI, no briefing — cheap enough to
// run continuously.
async function sweepIndex() {
  if (sweepInFlight) return;
  sweepInFlight = true;
  try {
    const result = await db.execute(
      "SELECT DISTINCT user_id FROM ea_accounts",
    );
    for (const row of result.rows) {
      try {
        const { accounts } = await loadUserConfig(row.user_id);
        const hasEmail = accounts.some(
          (a) => a.type === "gmail" || a.type === "icloud",
        );
        if (!hasEmail) continue;
        const emails = await fetchAllEmails(
          accounts,
          INDEXER_LOOKBACK_HOURS,
        );
        if (emails.length) {
          await indexEmails(row.user_id, emails);
          await enqueueEmailTriageForEmails(row.user_id, emails);
        }
      } catch (err) {
        console.error(
          `[EA Indexer] Sweep failed for user ${row.user_id}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error("[EA Indexer] Sweep iteration failed:", err.message);
  } finally {
    sweepInFlight = false;
  }
}

async function runGmailWatchRenewal() {
  try {
    await renewDueGmailWatches();
  } catch (err) {
    console.error("[Gmail Watch] Renewal sweep failed:", err.message);
  }
}

async function runGmailHistorySyncWorker() {
  if (gmailHistorySyncInFlight) return;
  gmailHistorySyncInFlight = true;
  try {
    // P2-7: stale triage-job recovery is owned solely by runEmailTriageWorker
    // (both ran it every minute against the same table, racing on the same rows
    // for a 15-minute stale window). One owner is sufficient.
    let processed = 0;
    for (let i = 0; i < 10; i++) {
      const result = await processNextGmailHistorySyncJob();
      if (!result.processed) break;
      processed++;
    }
    if (processed) console.log(`[Gmail Sync] Processed ${processed} history sync job(s)`);
  } catch (err) {
    console.error("[Gmail Sync] Worker failed:", err.message);
  } finally {
    gmailHistorySyncInFlight = false;
  }
}

export async function runEmailTriageWorker({ selfRescheduled = false } = {}) {
  if (emailTriageInFlight) return;
  emailTriageInFlight = true;
  let processed = 0;
  try {
    // Stale-job recovery is the per-minute responsibility; an immediate
    // self-reschedule within the same drain skips it (it already ran this tick).
    if (!selfRescheduled) await recoverStaleRunningTriageJobs();
    // P1-7: one batch context resolves mode/rules/interests/model-client once per
    // user for the whole drain instead of re-reading them on every job.
    const batch = createTriageBatchContext();
    for (let i = 0; i < EMAIL_TRIAGE_BATCH_SIZE; i++) {
      const result = await processNextEmailTriageJob({ batch });
      if (result.paused) break;
      if (!result.processed) break;
      processed++;
    }
    if (processed) console.log(`[Email Triage] Processed ${processed} email triage job(s)`);
  } catch (err) {
    console.error("[Email Triage] Worker failed:", err.message);
    emailTriageSelfRescheduleCount = 0;
    return;
  } finally {
    emailTriageInFlight = false;
  }
  // P2-4: a full batch means the queue is still deep — re-arm immediately via
  // setImmediate instead of idling until the next cron minute. The in-flight
  // guard above prevents overlap; the self-reschedule cap bounds the chain.
  if (processed === EMAIL_TRIAGE_BATCH_SIZE
      && emailTriageSelfRescheduleCount < EMAIL_TRIAGE_MAX_SELF_RESCHEDULES) {
    emailTriageSelfRescheduleCount += 1;
    setImmediate(() => {
      runEmailTriageWorker({ selfRescheduled: true }).catch((err) =>
        console.error("[Email Triage] Self-rescheduled worker failed:", err.message),
      );
    });
  } else {
    emailTriageSelfRescheduleCount = 0;
  }
}

export async function runEmailSearchEmbeddingWorker() {
  if (EMAIL_SEARCH_EMBEDDINGS_DISABLED) return;
  if (emailSearchEmbeddingInFlight) return;
  emailSearchEmbeddingInFlight = true;
  try {
    const result = await processEmailSearchEmbeddingBatchesForAllUsers();
    const embedded = result.users.reduce((sum, user) => sum + Number(user.embedded || 0), 0);
    if (embedded) console.log(`[Email Search Embeddings] Embedded ${embedded} indexed email(s)`);
  } catch (err) {
    console.error("[Email Search Embeddings] Worker failed:", err.message);
  } finally {
    emailSearchEmbeddingInFlight = false;
  }
}

async function runTriageJobPruneWorker() {
  try {
    const pruned = await pruneCompletedTriageJobs();
    if (pruned) console.log(`[Email Triage] Pruned ${pruned} completed triage job(s)`);
  } catch (err) {
    console.error("[Email Triage] Completed-job prune failed:", err.message);
  }
}

export function startBackgroundIndexer() {
  if (indexerJob) {
    indexerJob.stop();
    indexerJob = null;
  }
  indexerJob = cron.schedule(INDEXER_CRON, sweepIndex);
  console.log(
    `[EA Indexer] Background indexer scheduled (${INDEXER_CRON}, ${INDEXER_LOOKBACK_HOURS}h lookback)`,
  );
  // Run once shortly after startup so a freshly booted server catches up
  // without waiting for the first cron tick.
  setTimeout(() => {
    sweepIndex().catch((err) =>
      console.error("[EA Indexer] Initial sweep failed:", err.message),
    );
  }, 5000);

  if (gmailWatchRenewalJob) {
    gmailWatchRenewalJob.stop();
    gmailWatchRenewalJob = null;
  }
  gmailWatchRenewalJob = cron.schedule(GMAIL_WATCH_RENEWAL_CRON, runGmailWatchRenewal);
  console.log(`[Gmail Watch] Renewal scheduled (${GMAIL_WATCH_RENEWAL_CRON})`);
  setTimeout(() => {
    runGmailWatchRenewal().catch((err) =>
      console.error("[Gmail Watch] Initial renewal failed:", err.message),
    );
  }, 8000);

  if (gmailHistorySyncJob) {
    gmailHistorySyncJob.stop();
    gmailHistorySyncJob = null;
  }
  gmailHistorySyncJob = cron.schedule(GMAIL_HISTORY_SYNC_CRON, runGmailHistorySyncWorker);
  console.log(`[Gmail Sync] History worker scheduled (${GMAIL_HISTORY_SYNC_CRON})`);
  setTimeout(() => {
    runGmailHistorySyncWorker().catch((err) =>
      console.error("[Gmail Sync] Initial worker failed:", err.message),
    );
  }, 10000);

  if (emailTriageJob) {
    emailTriageJob.stop();
    emailTriageJob = null;
  }
  emailTriageJob = cron.schedule(EMAIL_TRIAGE_CRON, runEmailTriageWorker);
  console.log(`[Email Triage] Worker scheduled (${EMAIL_TRIAGE_CRON})`);
  setTimeout(() => {
    runEmailTriageWorker().catch((err) =>
      console.error("[Email Triage] Initial worker failed:", err.message),
    );
  }, 12000);

  if (triageJobPruneJob) {
    triageJobPruneJob.stop();
    triageJobPruneJob = null;
  }
  triageJobPruneJob = cron.schedule(TRIAGE_JOB_PRUNE_CRON, runTriageJobPruneWorker);
  console.log(`[Email Triage] Completed-job prune scheduled (${TRIAGE_JOB_PRUNE_CRON})`);

  if (emailSearchEmbeddingJob) {
    emailSearchEmbeddingJob.stop();
    emailSearchEmbeddingJob = null;
  }
  if (EMAIL_SEARCH_EMBEDDINGS_DISABLED) {
    console.log("[Email Search Embeddings] Worker disabled by EA_EMAIL_SEARCH_EMBEDDINGS_DISABLED=1");
    return;
  }
  emailSearchEmbeddingJob = cron.schedule(EMAIL_SEARCH_EMBEDDING_CRON, runEmailSearchEmbeddingWorker);
  console.log(`[Email Search Embeddings] Worker scheduled (${EMAIL_SEARCH_EMBEDDING_CRON})`);
  setTimeout(() => {
    runEmailSearchEmbeddingWorker().catch((err) =>
      console.error("[Email Search Embeddings] Initial worker failed:", err.message),
    );
  }, 15000);
}

async function runReminderSchedulerBatch() {
  try {
    const result = await processDueReminderBatch();
    if (result.processed) {
      console.log(
        `[Reminder Scheduler] Processed ${result.processed} reminder(s): ${result.sent} sent, ${result.missed} missed, ${result.failed} failed`,
      );
    }
  } catch (err) {
    console.error("[Reminder Scheduler] Worker failed:", err.message);
  }
}

export function runReminderSchedulerWorker() {
  // Single-flight: while a batch is running, reminderSchedulerInFlight holds its
  // promise so concurrent ticks no-op and the shutdown handler can await it.
  if (reminderSchedulerInFlight) return reminderSchedulerInFlight;
  const run = runReminderSchedulerBatch().finally(() => {
    reminderSchedulerInFlight = null;
  });
  reminderSchedulerInFlight = run;
  return run;
}

export function startReminderSchedulerWorker() {
  if (reminderSchedulerTimer) {
    clearInterval(reminderSchedulerTimer);
    reminderSchedulerTimer = null;
  }
  reminderSchedulerTimer = setInterval(runReminderSchedulerWorker, REMINDER_SCHEDULER_INTERVAL_MS);
  reminderSchedulerTimer.unref?.();
  console.log(`[Reminder Scheduler] Worker scheduled (${REMINDER_SCHEDULER_INTERVAL_MS}ms interval)`);
  setTimeout(() => {
    runReminderSchedulerWorker().catch((err) =>
      console.error("[Reminder Scheduler] Initial worker failed:", err.message),
    );
  }, 2000);
}

// P3-58: graceful drain on shutdown. The reminder worker ran on an unref'd
// setInterval, so on SIGTERM/SIGINT the last tick could be lost mid-send with
// no chance to finish. This stops every cron job and the reminder interval so
// no new work starts, then awaits any in-flight reminder batch so the current
// send completes before the process exits. Idempotent — safe to call twice.
export async function stopScheduler() {
  for (const job of activeJobs) job.stop?.();
  activeJobs.length = 0;
  for (const job of [
    indexerJob,
    gmailWatchRenewalJob,
    gmailHistorySyncJob,
    emailTriageJob,
    emailSearchEmbeddingJob,
    triageJobPruneJob,
  ]) {
    job?.stop?.();
  }
  indexerJob = null;
  gmailWatchRenewalJob = null;
  gmailHistorySyncJob = null;
  emailTriageJob = null;
  emailSearchEmbeddingJob = null;
  triageJobPruneJob = null;

  if (reminderSchedulerTimer) {
    clearInterval(reminderSchedulerTimer);
    reminderSchedulerTimer = null;
  }

  // Await the tracked in-flight reminder promise so the last batch drains.
  if (reminderSchedulerInFlight) {
    try {
      await reminderSchedulerInFlight;
    } catch {
      // runReminderSchedulerBatch already logs failures; never block exit on it.
    }
  }
}
