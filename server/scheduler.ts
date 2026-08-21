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
  getNextEmailTriageWakeAt,
  pruneCompletedTriageJobs,
} from "./triage/triage-worker.ts";
import { processEmailSearchEmbeddingBatchesForAllUsers } from "./email/search/email-search-embedding-worker.ts";
import { getNextReminderWakeAt, processDueReminderBatch } from "./reminders/reminder-scheduler.ts";
import { createSnapshotBoundaryScheduler } from "./scheduler-snapshot-boundaries.ts";
import { createSchedulerWorkRegistry } from "./scheduler-work-registry.ts";
import {
  createEmailTriageDeadlineController,
  registerEmailTriageDrainRequester,
} from "./scheduler-email-triage-drain.ts";
import type { EmailTriageScheduledFor } from "./scheduler-email-triage-drain.ts";
import {
  createReminderDeadlineController,
  registerReminderDrainRequester,
} from "./scheduler-reminder-drain.ts";

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

export interface SchedulerRuntimeDependencies {
  cronSchedule?: typeof cron.schedule;
  dbClient?: Pick<typeof db, "execute">;
  loadConfig?: typeof loadUserConfig;
  fetchEmails?: typeof fetchAllEmails;
  indexEmailRows?: typeof indexEmails;
  enqueueTriage?: typeof enqueueEmailTriageForEmails;
  processHistoryJob?: typeof processNextGmailHistorySyncJob;
  renewWatches?: typeof renewDueGmailWatches;
  processTriageJob?: typeof processNextEmailTriageJob;
  recoverTriageJobs?: typeof recoverStaleRunningTriageJobs;
  getNextTriageWakeAt?: typeof getNextEmailTriageWakeAt;
  createTriageContext?: typeof createTriageBatchContext;
  pruneTriageJobs?: typeof pruneCompletedTriageJobs;
  processEmbeddings?: typeof processEmailSearchEmbeddingBatchesForAllUsers;
  processReminders?: typeof processDueReminderBatch;
  getNextReminderWakeAt?: typeof getNextReminderWakeAt;
  advanceSnapshot?: Parameters<typeof createSnapshotBoundaryScheduler>[0]["advanceBoundary"];
}

export function createSchedulerRuntime(dependencies: SchedulerRuntimeDependencies = {}) {
  const runtime = {
    cronSchedule: cron.schedule,
    dbClient: db,
    loadConfig: loadUserConfig,
    fetchEmails: fetchAllEmails,
    indexEmailRows: indexEmails,
    enqueueTriage: enqueueEmailTriageForEmails,
    processHistoryJob: processNextGmailHistorySyncJob,
    renewWatches: renewDueGmailWatches,
    processTriageJob: processNextEmailTriageJob,
    recoverTriageJobs: recoverStaleRunningTriageJobs,
    getNextTriageWakeAt: getNextEmailTriageWakeAt,
    createTriageContext: createTriageBatchContext,
    pruneTriageJobs: pruneCompletedTriageJobs,
    processEmbeddings: processEmailSearchEmbeddingBatchesForAllUsers,
    processReminders: processDueReminderBatch,
    getNextReminderWakeAt,
    advanceSnapshot: undefined,
    ...dependencies,
  };

const processNextEmailTriageJobAtBoundary = runtime.processTriageJob as unknown as (
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
let reminderRunInFlight: Promise<void> | null = null;
let reminderDeadlineFollowupRequested = false;
let schedulerStopping = false;
let stopSchedulerInFlight: Promise<void> | null = null;
const snapshotBoundaryScheduler = createSnapshotBoundaryScheduler({
  runWork: schedulerWork.run,
  isStopping: () => schedulerStopping,
  dbClient: runtime.dbClient,
  scheduleCron: runtime.cronSchedule,
  ...(runtime.advanceSnapshot ? { advanceBoundary: runtime.advanceSnapshot } : {}),
});
// 2h lookback gives the 10-minute cadence generous overlap — nothing falls
// through the cracks if one sweep runs long or a briefing pauses the pipeline.
const INDEXER_LOOKBACK_HOURS = 2;
const INDEXER_CRON = "*/10 * * * *";
const GMAIL_WATCH_RENEWAL_CRON = "17 3 * * *";
const GMAIL_HISTORY_SYNC_CRON = "* * * * *";
// Arrival deadlines and persisted scheduled_for values own prompt admission.
// This sparse cron remains only as missed-signal and stale-claim recovery.
const EMAIL_TRIAGE_CRON = "*/5 * * * *";
const EMAIL_SEARCH_EMBEDDING_CRON = "*/5 * * * *";
const TRIAGE_JOB_PRUNE_CRON = "23 4 * * *";
const REMINDER_SCHEDULER_BACKSTOP_MS = 5 * 60_000;
const REMINDER_DUE_RECHECK_MS = 10_000;
const EMAIL_TRIAGE_DUE_RECHECK_MS = 30_000;
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

const reminderDeadlineController = createReminderDeadlineController({
  scheduleTimeout: scheduleSchedulerTimeout,
  cancelTimeout: (handle) => {
    clearTimeout(handle);
    schedulerTimeouts.delete(handle);
  },
  onDeadline: () => {
    runReminderSchedulerWorker({ deadlineWake: true }).catch((err) =>
      console.error("[Reminder Scheduler] Deadline worker failed:", errorMessage(err)),
    );
  },
});
registerReminderDrainRequester(reminderDeadlineController.request);

function initScheduler(): Promise<void> {
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
      const result = await runtime.dbClient.execute(
        "SELECT DISTINCT user_id FROM ea_accounts",
      );
      for (const row of result.rows) {
        try {
          const userId = String(row.user_id ?? "");
          const { accounts } = await runtime.loadConfig(userId);
          const hasEmail = accounts.some(
            (a) => a.type === "gmail" || a.type === "icloud",
          );
          if (!hasEmail) continue;
          const emails = await runtime.fetchEmails(
            accounts,
            INDEXER_LOOKBACK_HOURS,
          );
          if (emails.length) {
            await runtime.indexEmailRows(userId, emails);
            await runtime.enqueueTriage(userId, emails);
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
      await runtime.renewWatches();
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
          const result = await runtime.processHistoryJob();
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
function requestGmailHistorySyncDrain(): void {
  scheduleSchedulerImmediate(() => {
    void runGmailHistorySyncWorker();
  });
}

function runEmailTriageWorker({
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
    let paused = false;
    try {
      // Stale-job recovery belongs to startup and the sparse safety pass; an
      // event/deadline self-reschedule skips it because the last pass already ran it.
      if (!selfRescheduled) await runtime.recoverTriageJobs();
      // P1-7: one batch context resolves mode/rules/interests/model-client once per
      // user for the whole drain instead of re-reading them on every job.
      const batch = runtime.createTriageContext();
      for (let i = 0; i < EMAIL_TRIAGE_BATCH_SIZE; i++) {
        const result = await processNextEmailTriageJobAtBoundary({ batch });
        if (result.scheduled_for) emailTriageDeadlineController.request(result.scheduled_for);
        if (result.paused) {
          paused = true;
          break;
        }
        if (!result.processed) break;
        processed++;
      }
      if (processed) console.log(`[Email Triage] Processed ${processed} email triage job(s)`);
      if (!paused && processed < EMAIL_TRIAGE_BATCH_SIZE) {
        const nextWakeAt = await runtime.getNextTriageWakeAt();
        if (nextWakeAt !== null) {
          emailTriageDeadlineController.request(
            nextWakeAt <= Date.now()
              ? Date.now() + EMAIL_TRIAGE_DUE_RECHECK_MS
              : nextWakeAt,
          );
        }
      }
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

function runEmailSearchEmbeddingWorker(): Promise<void> {
  if (EMAIL_SEARCH_EMBEDDINGS_DISABLED || schedulerStopping) return Promise.resolve();
  return schedulerWork.run("email-search-embeddings", async () => {
    try {
      const result = await runtime.processEmbeddings();
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
      const pruned = await runtime.pruneTriageJobs();
      if (pruned) console.log(`[Email Triage] Pruned ${pruned} completed triage job(s)`);
    } catch (err) {
      console.error("[Email Triage] Completed-job prune failed:", errorMessage(err));
    }
  });
}

function startBackgroundIndexer(): void {
  if (schedulerStopping) return;
  if (indexerJob) {
    indexerJob.stop();
    indexerJob = null;
  }
  indexerJob = runtime.cronSchedule(INDEXER_CRON, sweepIndex);
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
  gmailWatchRenewalJob = runtime.cronSchedule(GMAIL_WATCH_RENEWAL_CRON, runGmailWatchRenewal);
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
  gmailHistorySyncJob = runtime.cronSchedule(GMAIL_HISTORY_SYNC_CRON, runGmailHistorySyncWorker);
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
  emailTriageJob = runtime.cronSchedule(EMAIL_TRIAGE_CRON, () => runEmailTriageWorker());
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
  triageJobPruneJob = runtime.cronSchedule(TRIAGE_JOB_PRUNE_CRON, runTriageJobPruneWorker);
  console.log(`[Email Triage] Completed-job prune scheduled (${TRIAGE_JOB_PRUNE_CRON})`);

  if (emailSearchEmbeddingJob) {
    emailSearchEmbeddingJob.stop();
    emailSearchEmbeddingJob = null;
  }
  if (EMAIL_SEARCH_EMBEDDINGS_DISABLED) {
    console.log("[Email Search Embeddings] Worker disabled by EA_EMAIL_SEARCH_EMBEDDINGS_DISABLED=1");
    return;
  }
  emailSearchEmbeddingJob = runtime.cronSchedule(EMAIL_SEARCH_EMBEDDING_CRON, runEmailSearchEmbeddingWorker);
  console.log(`[Email Search Embeddings] Worker scheduled (${EMAIL_SEARCH_EMBEDDING_CRON})`);
  scheduleSchedulerTimeout(() => {
    runEmailSearchEmbeddingWorker().catch((err) =>
      console.error("[Email Search Embeddings] Initial worker failed:", errorMessage(err)),
    );
  }, 15000);
}

async function runReminderSchedulerBatch(): Promise<void> {
  try {
    const result = await runtime.processReminders();
    if (result.processed) {
      console.log(
        `[Reminder Scheduler] Processed ${result.processed} reminder(s): ${result.sent} sent, ${result.missed} missed, ${result.failed} failed`,
      );
    }
    const nextWakeAt = await runtime.getNextReminderWakeAt();
    if (nextWakeAt !== null) {
      reminderDeadlineController.request(
        nextWakeAt <= Date.now()
          ? Date.now() + REMINDER_DUE_RECHECK_MS
          : nextWakeAt,
      );
    }
  } catch (err) {
    console.error("[Reminder Scheduler] Worker failed:", errorMessage(err));
  }
}

function runReminderSchedulerWorker({
  deadlineWake = false,
}: { deadlineWake?: boolean } = {}): Promise<void> {
  if (schedulerStopping) return Promise.resolve();
  if (reminderRunInFlight) {
    if (deadlineWake) reminderDeadlineFollowupRequested = true;
    return reminderRunInFlight;
  }
  const runPromise = schedulerWork.run(
    "reminder-batch",
    async () => {
      await runReminderSchedulerBatch();
      const followupRequested = reminderDeadlineFollowupRequested;
      reminderDeadlineFollowupRequested = false;
      if (followupRequested) {
        scheduleSchedulerImmediate(() => {
          runReminderSchedulerWorker().catch((err) =>
            console.error("[Reminder Scheduler] Deadline follow-up worker failed:", errorMessage(err)),
          );
        });
      }
    },
    { singleFlight: true },
  );
  reminderRunInFlight = runPromise;
  void runPromise.finally(() => {
    if (reminderRunInFlight === runPromise) reminderRunInFlight = null;
  });
  return runPromise;
}

function startReminderSchedulerWorker(): void {
  if (schedulerStopping) return;
  if (reminderSchedulerTimer) {
    clearInterval(reminderSchedulerTimer);
    reminderSchedulerTimer = null;
  }
  reminderSchedulerTimer = setInterval(runReminderSchedulerWorker, REMINDER_SCHEDULER_BACKSTOP_MS);
  reminderSchedulerTimer.unref?.();
  console.log(`[Reminder Scheduler] Worker scheduled (${REMINDER_SCHEDULER_BACKSTOP_MS}ms safety backstop)`);
  scheduleSchedulerTimeout(() => {
    runReminderSchedulerWorker().catch((err) =>
      console.error("[Reminder Scheduler] Initial worker failed:", errorMessage(err)),
    );
  }, 2000);
}

// Graceful scheduler drain: close every admission source first, then await the
// scheduler-owned registry. The process-level 15-second force-exit in
// shutdown.ts remains the outer bound. Idempotent — safe to call twice.
function stopScheduler(): Promise<void> {
  if (stopSchedulerInFlight) return stopSchedulerInFlight;
  schedulerStopping = true;
  gmailHistorySyncRerun = false;
  emailTriageSelfRescheduleCount = 0;
  emailTriageDeadlineFollowupRequested = false;
  emailTriageDeadlineController.stop();
  reminderDeadlineFollowupRequested = false;
  reminderDeadlineController.stop();
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

return {
  initScheduler,
  requestEmailTriageDrainAt: emailTriageDeadlineController.request,
  requestReminderDrainAt: reminderDeadlineController.request,
  requestGmailHistorySyncDrain,
  runEmailSearchEmbeddingWorker,
  runEmailTriageWorker,
  runReminderSchedulerWorker,
  startBackgroundIndexer,
  startReminderSchedulerWorker,
  stopScheduler,
};
}

const defaultSchedulerRuntime = createSchedulerRuntime();
export const initScheduler = defaultSchedulerRuntime.initScheduler;
export const requestGmailHistorySyncDrain = defaultSchedulerRuntime.requestGmailHistorySyncDrain;
export const startBackgroundIndexer = defaultSchedulerRuntime.startBackgroundIndexer;
export const startReminderSchedulerWorker = defaultSchedulerRuntime.startReminderSchedulerWorker;
export const stopScheduler = defaultSchedulerRuntime.stopScheduler;
