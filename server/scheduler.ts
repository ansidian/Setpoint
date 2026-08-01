import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import db from "./db/connection.ts";
import { loadUserConfig } from "./platform/config-service.ts";
import { fetchAllEmails } from "./email/email-fetch.ts";
import { indexEmails } from "./email/email-index.ts";
import {
  enqueueEmailTriageForEmails,
  processNextGmailHistorySyncJob,
  renewDueGmailWatches,
} from "./email/gmail-sync.ts";
import {
  processNextEmailTriageJob,
  recoverStaleRunningTriageJobs,
  createTriageBatchContext,
  pruneCompletedTriageJobs,
} from "./triage/triage-worker.ts";
import { processEmailSearchEmbeddingBatchesForAllUsers } from "./email/search/email-search-embedding-worker.ts";
import { processDueReminderBatch } from "./reminders/reminder-scheduler.ts";
import { createSnapshotBoundaryScheduler } from "./scheduler-snapshot-boundaries.ts";
import { createSchedulerWorkRegistry } from "./scheduler-work-registry.ts";
import {
  createEmailTriageDeadlineController,
  registerEmailTriageDrainRequester,
  requestEmailTriageDrainAt,
} from "./scheduler-email-triage-drain.ts";
import type { EmailTriageScheduledFor } from "./scheduler-email-triage-drain.ts";
export { requestEmailTriageDrainAt } from "./scheduler-email-triage-drain.ts";

interface EmailTriageJobResult {
  processed?: boolean;
  paused?: boolean;
  scheduled_for?: EmailTriageScheduledFor;
}

interface EmailTriageWorkerOptions {
  selfRescheduled?: boolean;
  deadlineWake?: boolean;
}

type TriageBatchContext = ReturnType<typeof createTriageBatchContext>;

const processNextEmailTriageJobAtBoundary = processNextEmailTriageJob as unknown as (
  options: { batch: TriageBatchContext },
) => Promise<EmailTriageJobResult>;
const schedulerWork = createSchedulerWorkRegistry();
const schedulerTimeouts = new Set<NodeJS.Timeout>();
const schedulerImmediates = new Set<NodeJS.Immediate>();
// Background indexer state lives outside activeJobs so initScheduler's re-runs
// (triggered on account changes) don't tear down the passive email sweep.
let indexerJob: ScheduledTask | null = null;
let gmailWatchRenewalJob: ScheduledTask | null = null;
let gmailHistorySyncJob: ScheduledTask | null = null;
let gmailHistorySyncRerun = false;
let emailTriageJob: ScheduledTask | null = null;
let emailTriageRunInFlight: Promise<void> | null = null;
let emailTriageDeadlineFollowupRequested = false;
let emailSearchEmbeddingJob: ScheduledTask | null = null;
let triageJobPruneJob: ScheduledTask | null = null;
let reminderSchedulerTimer: NodeJS.Timeout | null = null;
let schedulerStopping = false;
let stopSchedulerInFlight: Promise<void> | null = null;
const snapshotBoundaryScheduler = createSnapshotBoundaryScheduler({
  runWork: schedulerWork.run,
  isStopping: () => schedulerStopping,
});
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scheduleSchedulerTimeout(task: () => void, delayMs: number): NodeJS.Timeout | null {
  if (schedulerStopping) return null;
  const handle = setTimeout(() => {
    schedulerTimeouts.delete(handle);
    if (!schedulerStopping) task();
  }, delayMs);
  schedulerTimeouts.add(handle);
  return handle;
}

function scheduleSchedulerImmediate(task: () => void): NodeJS.Immediate | null {
  if (schedulerStopping) return null;
  const handle = setImmediate(() => {
    schedulerImmediates.delete(handle);
    if (!schedulerStopping) task();
  });
  schedulerImmediates.add(handle);
  return handle;
}

const emailTriageDeadlineController = createEmailTriageDeadlineController({
  scheduleTimeout: scheduleSchedulerTimeout,
  cancelTimeout: (handle) => {
    clearTimeout(handle);
    schedulerTimeouts.delete(handle);
  },
  onDeadline: () => {
    runEmailTriageWorker({ selfRescheduled: true, deadlineWake: true }).catch((err) =>
      console.error("[Email Triage] Deadline worker failed:", errorMessage(err)),
    );
  },
});
registerEmailTriageDrainRequester(emailTriageDeadlineController.request);

export function initScheduler(): Promise<void> {
  return snapshotBoundaryScheduler.init();
}

// Passive email indexer: sweeps every account's inbox every 10 minutes and
// upserts recent messages into the FTS index so search finds mail that
// arrived between briefing runs. No email AI, no briefing — cheap enough to
// run continuously.
function sweepIndex(): Promise<void> {
  if (schedulerStopping) return Promise.resolve();
  return schedulerWork.run("email-index-sweep", async () => {
    try {
      const result = await db.execute(
        "SELECT DISTINCT user_id FROM ea_accounts",
      );
      for (const row of result.rows) {
        try {
          const userId = String(row.user_id ?? "");
          const { accounts } = await loadUserConfig(userId);
          const hasEmail = accounts.some(
            (a) => a.type === "gmail" || a.type === "icloud",
          );
          if (!hasEmail) continue;
          const emails = await fetchAllEmails(
            accounts,
            INDEXER_LOOKBACK_HOURS,
          );
          if (emails.length) {
            await indexEmails(userId, emails);
            await enqueueEmailTriageForEmails(userId, emails);
          }
        } catch (err) {
          console.error(
            `[EA Indexer] Sweep failed for user ${row.user_id}:`,
            errorMessage(err),
          );
        }
      }
    } catch (err) {
      console.error("[EA Indexer] Sweep iteration failed:", errorMessage(err));
    }
  }, { singleFlight: true });
}

function runGmailWatchRenewal(): Promise<void> {
  if (schedulerStopping) return Promise.resolve();
  return schedulerWork.run("gmail-watch-renewal", async () => {
    try {
      await renewDueGmailWatches();
    } catch (err) {
      console.error("[Gmail Watch] Renewal sweep failed:", errorMessage(err));
    }
  });
}

function runGmailHistorySyncWorker(): Promise<void> {
  if (schedulerStopping) return Promise.resolve();
  gmailHistorySyncRerun = true;
  return schedulerWork.run("gmail-history-sync", async () => {
    try {
      // P2-7: stale triage-job recovery is owned solely by runEmailTriageWorker
      // (both ran it every minute against the same table, racing on the same rows
      // for a 15-minute stale window). One owner is sufficient.
      let processed = 0;
      do {
        gmailHistorySyncRerun = false;
        for (let i = 0; i < 10; i++) {
          const result = await processNextGmailHistorySyncJob();
          if (!result.processed) break;
          processed++;
        }
      } while (gmailHistorySyncRerun && !schedulerStopping);
      if (processed) console.log(`[Gmail Sync] Processed ${processed} history sync job(s)`);
    } catch (err) {
      console.error("[Gmail Sync] Worker failed:", errorMessage(err));
    }
  }, { singleFlight: true });
}

// Wake the durable history-sync queue promptly after Gmail Pub/Sub persists a
// job. The per-minute cron remains the reliability fallback if this process
// exits before the scheduled turn runs. The worker's single-flight guard
// coalesces push bursts without making the webhook wait on Gmail API work.
export function requestGmailHistorySyncDrain(): void {
  scheduleSchedulerImmediate(() => {
    void runGmailHistorySyncWorker();
  });
}

export function runEmailTriageWorker({
  selfRescheduled = false,
  deadlineWake = false,
}: EmailTriageWorkerOptions = {}): Promise<void> {
  if (schedulerStopping) return Promise.resolve();
  if (emailTriageRunInFlight) {
    if (deadlineWake) emailTriageDeadlineFollowupRequested = true;
    return emailTriageRunInFlight;
  }

  const runPromise = schedulerWork.run("email-triage", async () => {
    let processed = 0;
    let workerFailed = false;
    try {
      // Stale-job recovery is the per-minute responsibility; an immediate
      // self-reschedule within the same drain skips it (it already ran this tick).
      if (!selfRescheduled) await recoverStaleRunningTriageJobs();
      // P1-7: one batch context resolves mode/rules/interests/model-client once per
      // user for the whole drain instead of re-reading them on every job.
      const batch = createTriageBatchContext();
      for (let i = 0; i < EMAIL_TRIAGE_BATCH_SIZE; i++) {
        const result = await processNextEmailTriageJobAtBoundary({ batch });
        if (result.scheduled_for) requestEmailTriageDrainAt(result.scheduled_for);
        if (result.paused) break;
        if (!result.processed) break;
        processed++;
      }
      if (processed) console.log(`[Email Triage] Processed ${processed} email triage job(s)`);
    } catch (err) {
      console.error("[Email Triage] Worker failed:", errorMessage(err));
      emailTriageSelfRescheduleCount = 0;
      workerFailed = true;
    }
    // P2-4: a full batch means the queue is still deep — re-arm immediately via
    // setImmediate instead of idling until the next cron minute. The in-flight
    // guard above prevents overlap; the self-reschedule cap bounds the chain.
    const deadlineFollowupRequested = emailTriageDeadlineFollowupRequested;
    emailTriageDeadlineFollowupRequested = false;
    if (!workerFailed && processed === EMAIL_TRIAGE_BATCH_SIZE
        && emailTriageSelfRescheduleCount < EMAIL_TRIAGE_MAX_SELF_RESCHEDULES) {
      emailTriageSelfRescheduleCount += 1;
      scheduleSchedulerImmediate(() => {
        runEmailTriageWorker({ selfRescheduled: true }).catch((err) =>
          console.error("[Email Triage] Self-rescheduled worker failed:", errorMessage(err)),
        );
      });
    } else if (deadlineFollowupRequested) {
      emailTriageSelfRescheduleCount = 0;
      scheduleSchedulerImmediate(() => {
        runEmailTriageWorker({ selfRescheduled: true }).catch((err) =>
          console.error("[Email Triage] Deadline follow-up worker failed:", errorMessage(err)),
        );
      });
    } else {
      emailTriageSelfRescheduleCount = 0;
    }
  }, { singleFlight: true });
  emailTriageRunInFlight = runPromise;
  void runPromise.then(
    () => {
      if (emailTriageRunInFlight === runPromise) emailTriageRunInFlight = null;
    },
    () => {
      if (emailTriageRunInFlight === runPromise) emailTriageRunInFlight = null;
    },
  );
  return runPromise;
}

export function runEmailSearchEmbeddingWorker(): Promise<void> {
  if (EMAIL_SEARCH_EMBEDDINGS_DISABLED || schedulerStopping) return Promise.resolve();
  return schedulerWork.run("email-search-embeddings", async () => {
    try {
      const result = await processEmailSearchEmbeddingBatchesForAllUsers();
      const embedded = result.users.reduce((sum, user) => sum + Number(user.embedded || 0), 0);
      if (embedded) console.log(`[Email Search Embeddings] Embedded ${embedded} indexed email(s)`);
    } catch (err) {
      console.error("[Email Search Embeddings] Worker failed:", errorMessage(err));
    }
  }, { singleFlight: true });
}

function runTriageJobPruneWorker(): Promise<void> {
  if (schedulerStopping) return Promise.resolve();
  return schedulerWork.run("triage-job-prune", async () => {
    try {
      const pruned = await pruneCompletedTriageJobs();
      if (pruned) console.log(`[Email Triage] Pruned ${pruned} completed triage job(s)`);
    } catch (err) {
      console.error("[Email Triage] Completed-job prune failed:", errorMessage(err));
    }
  });
}

export function startBackgroundIndexer(): void {
  if (schedulerStopping) return;
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
  scheduleSchedulerTimeout(() => {
    sweepIndex().catch((err) =>
      console.error("[EA Indexer] Initial sweep failed:", errorMessage(err)),
    );
  }, 5000);

  if (gmailWatchRenewalJob) {
    gmailWatchRenewalJob.stop();
    gmailWatchRenewalJob = null;
  }
  gmailWatchRenewalJob = cron.schedule(GMAIL_WATCH_RENEWAL_CRON, runGmailWatchRenewal);
  console.log(`[Gmail Watch] Renewal scheduled (${GMAIL_WATCH_RENEWAL_CRON})`);
  scheduleSchedulerTimeout(() => {
    runGmailWatchRenewal().catch((err) =>
      console.error("[Gmail Watch] Initial renewal failed:", errorMessage(err)),
    );
  }, 8000);

  if (gmailHistorySyncJob) {
    gmailHistorySyncJob.stop();
    gmailHistorySyncJob = null;
  }
  gmailHistorySyncJob = cron.schedule(GMAIL_HISTORY_SYNC_CRON, runGmailHistorySyncWorker);
  console.log(`[Gmail Sync] History worker scheduled (${GMAIL_HISTORY_SYNC_CRON})`);
  scheduleSchedulerTimeout(() => {
    runGmailHistorySyncWorker().catch((err) =>
      console.error("[Gmail Sync] Initial worker failed:", errorMessage(err)),
    );
  }, 10000);

  if (emailTriageJob) {
    emailTriageJob.stop();
    emailTriageJob = null;
  }
  emailTriageJob = cron.schedule(EMAIL_TRIAGE_CRON, () => runEmailTriageWorker());
  console.log(`[Email Triage] Worker scheduled (${EMAIL_TRIAGE_CRON})`);
  scheduleSchedulerTimeout(() => {
    runEmailTriageWorker().catch((err) =>
      console.error("[Email Triage] Initial worker failed:", errorMessage(err)),
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
  scheduleSchedulerTimeout(() => {
    runEmailSearchEmbeddingWorker().catch((err) =>
      console.error("[Email Search Embeddings] Initial worker failed:", errorMessage(err)),
    );
  }, 15000);
}

async function runReminderSchedulerBatch(): Promise<void> {
  try {
    const result = await processDueReminderBatch();
    if (result.processed) {
      console.log(
        `[Reminder Scheduler] Processed ${result.processed} reminder(s): ${result.sent} sent, ${result.missed} missed, ${result.failed} failed`,
      );
    }
  } catch (err) {
    console.error("[Reminder Scheduler] Worker failed:", errorMessage(err));
  }
}

export function runReminderSchedulerWorker(): Promise<void> {
  if (schedulerStopping) return Promise.resolve();
  return schedulerWork.run(
    "reminder-batch",
    runReminderSchedulerBatch,
    { singleFlight: true },
  );
}

export function startReminderSchedulerWorker(): void {
  if (schedulerStopping) return;
  if (reminderSchedulerTimer) {
    clearInterval(reminderSchedulerTimer);
    reminderSchedulerTimer = null;
  }
  reminderSchedulerTimer = setInterval(runReminderSchedulerWorker, REMINDER_SCHEDULER_INTERVAL_MS);
  reminderSchedulerTimer.unref?.();
  console.log(`[Reminder Scheduler] Worker scheduled (${REMINDER_SCHEDULER_INTERVAL_MS}ms interval)`);
  scheduleSchedulerTimeout(() => {
    runReminderSchedulerWorker().catch((err) =>
      console.error("[Reminder Scheduler] Initial worker failed:", errorMessage(err)),
    );
  }, 2000);
}

// Graceful scheduler drain: close every admission source first, then await the
// scheduler-owned registry. The process-level 15-second force-exit in
// shutdown.ts remains the outer bound. Idempotent — safe to call twice.
export function stopScheduler(): Promise<void> {
  if (stopSchedulerInFlight) return stopSchedulerInFlight;
  schedulerStopping = true;
  gmailHistorySyncRerun = false;
  emailTriageSelfRescheduleCount = 0;
  emailTriageDeadlineFollowupRequested = false;
  emailTriageDeadlineController.stop();
  snapshotBoundaryScheduler.stop();
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

  for (const handle of schedulerTimeouts) {
    clearTimeout(handle);
  }
  schedulerTimeouts.clear();
  for (const handle of schedulerImmediates) {
    clearImmediate(handle);
  }
  schedulerImmediates.clear();

  stopSchedulerInFlight = schedulerWork.drain();
  return stopSchedulerInFlight;
}
