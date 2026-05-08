import cron from "node-cron";
import db from "../db/connection.js";
import { loadUserConfig } from "./config-service.js";
import { fetchAllEmails } from "./email-fetch.js";
import { indexEmails } from "./email-index.js";
import { advanceSnapshotBoundary } from "./snapshot-service.js";
import {
  enqueueEmailTriageForEmails,
  processNextGmailHistorySyncJob,
  renewDueGmailWatches,
} from "./gmail-sync.js";
import { processNextEmailTriageJob, recoverStaleRunningTriageJobs } from "./triage-worker.js";
import { processEmailSearchEmbeddingBatchesForAllUsers } from "./email-search-embedding-worker.js";

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
// 2h lookback gives the 10-minute cadence generous overlap — nothing falls
// through the cracks if one sweep runs long or a briefing pauses the pipeline.
const INDEXER_LOOKBACK_HOURS = 2;
const INDEXER_CRON = "*/10 * * * *";
const GMAIL_WATCH_RENEWAL_CRON = "17 3 * * *";
const GMAIL_HISTORY_SYNC_CRON = "* * * * *";
const EMAIL_TRIAGE_CRON = "* * * * *";
const EMAIL_SEARCH_EMBEDDING_CRON = "*/5 * * * *";
const EMAIL_SEARCH_EMBEDDINGS_DISABLED = process.env.EA_EMAIL_SEARCH_EMBEDDINGS_DISABLED === "1";

export async function initScheduler() {
  // Clear any existing jobs (in case of re-init)
  for (const job of activeJobs) job.stop();
  activeJobs.length = 0;

  try {
    const result = await db.execute(
      "SELECT user_id, schedules_json FROM ea_settings WHERE schedules_json IS NOT NULL",
    );

    for (const row of result.rows) {
      const schedules = JSON.parse(row.schedules_json || "[]");

      for (const schedule of schedules) {
        if (!schedule.enabled) continue;

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
      }
    }

    if (activeJobs.length === 0) {
      console.log("[EA Scheduler] No enabled schedules found");
    }
  } catch {
    // ea_settings table may not exist yet on first run before migration
    console.log("[EA Scheduler] Skipping — ea_settings not yet available");
  }
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
    await recoverStaleRunningTriageJobs();
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

export async function runEmailTriageWorker() {
  if (emailTriageInFlight) return;
  emailTriageInFlight = true;
  try {
    await recoverStaleRunningTriageJobs();
    let processed = 0;
    for (let i = 0; i < 10; i++) {
      const result = await processNextEmailTriageJob();
      if (result.paused) break;
      if (!result.processed) break;
      processed++;
    }
    if (processed) console.log(`[Email Triage] Processed ${processed} email triage job(s)`);
  } catch (err) {
    console.error("[Email Triage] Worker failed:", err.message);
  } finally {
    emailTriageInFlight = false;
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
