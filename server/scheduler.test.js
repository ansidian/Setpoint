import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = { execute: vi.fn() };
const cronApi = vi.hoisted(() => ({ schedule: vi.fn() }));
const configApi = vi.hoisted(() => ({ loadUserConfig: vi.fn() }));
const emailFetchApi = vi.hoisted(() => ({ fetchAllEmails: vi.fn() }));
const snapshotApi = vi.hoisted(() => ({
  advanceSnapshotBoundary: vi.fn(async () => ({ snapshot: { id: 42, status: "active" } })),
}));
const gmailSyncApi = vi.hoisted(() => ({
  enqueueEmailTriageForEmails: vi.fn(),
  processNextGmailHistorySyncJob: vi.fn(),
  renewDueGmailWatches: vi.fn(),
}));
const triageWorkerApi = vi.hoisted(() => ({
  processNextEmailTriageJob: vi.fn(),
  recoverStaleRunningTriageJobs: vi.fn(),
}));
const embeddingWorkerApi = vi.hoisted(() => ({
  processEmailSearchEmbeddingBatchesForAllUsers: vi.fn(),
}));
const reminderSchedulerApi = vi.hoisted(() => ({
  processDueReminderBatch: vi.fn(),
}));

vi.mock("node-cron", () => ({ default: cronApi }));
vi.mock("./db/connection.js", () => ({ default: mockDb }));
vi.mock("./platform/config-service.js", () => configApi);
vi.mock("./email/email-fetch.js", () => emailFetchApi);
vi.mock("./snapshots/snapshot-service.js", () => snapshotApi);
vi.mock("./email/email-index.js", () => ({ indexEmails: vi.fn() }));
vi.mock("./email/gmail-sync.js", () => gmailSyncApi);
vi.mock("./triage/triage-worker.js", () => triageWorkerApi);
vi.mock("./email/search/email-search-embedding-worker.js", () => embeddingWorkerApi);
vi.mock("./reminders/reminder-scheduler.js", () => reminderSchedulerApi);

const {
  initScheduler,
  runEmailSearchEmbeddingWorker,
  runEmailTriageWorker,
  runReminderSchedulerWorker,
  startReminderSchedulerWorker,
} = await import("./scheduler.js");

beforeEach(() => {
  vi.clearAllMocks();
  cronApi.schedule.mockImplementation(() => ({ stop: vi.fn() }));
  triageWorkerApi.recoverStaleRunningTriageJobs.mockResolvedValue({ recovered: 0 });
});

describe("initScheduler concurrency (P2-28)", () => {
  it("does not double-register cron jobs when called concurrently", async () => {
    const created = [];
    cronApi.schedule.mockImplementation(() => {
      const job = { stop: vi.fn() };
      created.push(job);
      return job;
    });
    mockDb.execute.mockResolvedValue({
      rows: [{
        user_id: "u1",
        schedules_json: JSON.stringify([
          { enabled: true, time: "09:00", label: "Morning", tz: "America/Los_Angeles" },
        ]),
      }],
    });

    // Two concurrent init calls (startup + un-awaited settings-PUT re-init).
    const p1 = initScheduler();
    const p2 = initScheduler();
    await Promise.all([p1, p2]);

    // Exactly one schedule must end up live; any earlier-created job is stopped,
    // so there are no duplicate cron tasks firing the boundary multiple times.
    const liveJobs = created.filter((job) => job.stop.mock.calls.length === 0);
    expect(liveJobs).toHaveLength(1);
  });
});

describe("reminder scheduler worker", () => {
  it("runs through the shared scheduler module and logs aggregate reminder counts", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    reminderSchedulerApi.processDueReminderBatch.mockResolvedValueOnce({
      processed: 3,
      sent: 1,
      missed: 1,
      failed: 1,
    });

    await runReminderSchedulerWorker();

    expect(reminderSchedulerApi.processDueReminderBatch).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "[Reminder Scheduler] Processed 3 reminder(s): 1 sent, 1 missed, 1 failed",
    );
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("keeps reminder processing single-flight", async () => {
    let resolveBatch;
    const batch = new Promise((resolve) => {
      resolveBatch = resolve;
    });
    reminderSchedulerApi.processDueReminderBatch.mockReturnValueOnce(batch);

    const first = runReminderSchedulerWorker();
    const second = runReminderSchedulerWorker();

    expect(reminderSchedulerApi.processDueReminderBatch).toHaveBeenCalledTimes(1);
    resolveBatch({ processed: 0, sent: 0, missed: 0, failed: 0 });
    await Promise.all([first, second]);
  });

  it("schedules the reminder worker on a 10-second interval", async () => {
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    reminderSchedulerApi.processDueReminderBatch.mockResolvedValue({
      processed: 0,
      sent: 0,
      missed: 0,
      failed: 0,
    });

    startReminderSchedulerWorker();

    expect(cronApi.schedule).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("[Reminder Scheduler] Worker scheduled (10000ms interval)");
    await vi.advanceTimersByTimeAsync(1999);
    expect(reminderSchedulerApi.processDueReminderBatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reminderSchedulerApi.processDueReminderBatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reminderSchedulerApi.processDueReminderBatch).toHaveBeenCalledTimes(2);
    logSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe("initScheduler", () => {
  it("treats saved schedules as snapshot boundaries instead of batch generation", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{
        user_id: "user-1",
        schedules_json: JSON.stringify([
          { label: "Morning", time: "08:30", tz: "America/Los_Angeles", enabled: true },
        ]),
      }],
    });

    await initScheduler();

    expect(cronApi.schedule).toHaveBeenCalledWith(
      "30 8 * * *",
      expect.any(Function),
      { timezone: "America/Los_Angeles" },
    );

    mockDb.execute.mockResolvedValueOnce({
      rows: [{
        schedules_json: JSON.stringify([
          { label: "Morning", time: "08:30", tz: "America/Los_Angeles", enabled: true },
        ]),
      }],
    });
    await cronApi.schedule.mock.calls[0][1]();

    expect(snapshotApi.advanceSnapshotBoundary).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        timeZone: "America/Los_Angeles",
        scheduleLabel: "Morning",
      }),
    );
    expect(snapshotApi.advanceSnapshotBoundary).toHaveBeenCalledTimes(1);
  });
});

describe("email search embedding scheduler worker", () => {
  it("logs only aggregate embedding counts", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    embeddingWorkerApi.processEmailSearchEmbeddingBatchesForAllUsers.mockResolvedValueOnce({
      processed: true,
      users: [
        { user_id: "user-1", embedded: 2, selected: 3 },
      ],
    });

    await runEmailSearchEmbeddingWorker();

    expect(embeddingWorkerApi.processEmailSearchEmbeddingBatchesForAllUsers).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[Email Search Embeddings] Embedded 2 indexed email(s)");
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain("user-1");
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("email triage scheduler worker", () => {
  it("stops the batch loop cleanly when triage mode is paused", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    triageWorkerApi.processNextEmailTriageJob.mockResolvedValueOnce({
      processed: false,
      paused: true,
    });

    await runEmailTriageWorker();

    expect(triageWorkerApi.recoverStaleRunningTriageJobs).toHaveBeenCalledTimes(1);
    expect(triageWorkerApi.processNextEmailTriageJob).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
