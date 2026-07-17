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
  createTriageBatchContext: vi.fn(() => ({})),
  pruneCompletedTriageJobs: vi.fn(),
}));
const embeddingWorkerApi = vi.hoisted(() => ({
  processEmailSearchEmbeddingBatchesForAllUsers: vi.fn(),
}));
const reminderSchedulerApi = vi.hoisted(() => ({
  processDueReminderBatch: vi.fn(),
}));

vi.mock("node-cron", () => ({ default: cronApi }));
vi.mock("./db/connection.ts", () => ({ default: mockDb }));
vi.mock("./platform/config-service.ts", () => configApi);
vi.mock("./email/email-fetch.ts", () => emailFetchApi);
vi.mock("./snapshots/snapshot-service.ts", () => snapshotApi);
vi.mock("./email/email-index.ts", () => ({ indexEmails: vi.fn() }));
vi.mock("./email/gmail-sync.ts", () => gmailSyncApi);
vi.mock("./triage/triage-worker.ts", () => triageWorkerApi);
vi.mock("./email/search/email-search-embedding-worker.ts", () => embeddingWorkerApi);
vi.mock("./reminders/reminder-scheduler.ts", () => reminderSchedulerApi);

const {
  initScheduler,
  requestEmailTriageDrainAt,
  requestGmailHistorySyncDrain,
  runEmailSearchEmbeddingWorker,
  runEmailTriageWorker,
  runReminderSchedulerWorker,
  startReminderSchedulerWorker,
  stopScheduler,
} = await import("./scheduler.ts");

beforeEach(() => {
  vi.clearAllMocks();
  cronApi.schedule.mockImplementation(() => ({ stop: vi.fn() }));
  triageWorkerApi.recoverStaleRunningTriageJobs.mockResolvedValue({ recovered: 0 });
});

describe("initScheduler concurrency (P2-28)", () => {
  it("does not double-register cron jobs when called concurrently", async () => {
    const created: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
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

describe("Gmail history sync drain requests", () => {
  it("runs a follow-up drain when another push arrives during an active drain", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let resolveFirstClaim: ((result: { processed: boolean }) => void) | undefined;
    gmailSyncApi.processNextGmailHistorySyncJob
      .mockReturnValueOnce(new Promise<{ processed: boolean }>((resolve) => {
        resolveFirstClaim = resolve;
      }))
      .mockResolvedValueOnce({ processed: false });

    requestGmailHistorySyncDrain();
    await new Promise((resolve) => setImmediate(resolve));
    expect(gmailSyncApi.processNextGmailHistorySyncJob).toHaveBeenCalledTimes(1);

    requestGmailHistorySyncDrain();
    await new Promise((resolve) => setImmediate(resolve));
    resolveFirstClaim?.({ processed: false });
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(gmailSyncApi.processNextGmailHistorySyncJob).toHaveBeenCalledTimes(2);
    logSpy.mockRestore();
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
    let resolveBatch: ((result: { processed: number; sent: number; missed: number; failed: number }) => void) | undefined;
    const batch = new Promise<{ processed: number; sent: number; missed: number; failed: number }>((resolve) => {
      resolveBatch = resolve;
    });
    reminderSchedulerApi.processDueReminderBatch.mockReturnValueOnce(batch);

    const first = runReminderSchedulerWorker();
    const second = runReminderSchedulerWorker();

    expect(reminderSchedulerApi.processDueReminderBatch).toHaveBeenCalledTimes(1);
    resolveBatch?.({ processed: 0, sent: 0, missed: 0, failed: 0 });
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
    await cronApi.schedule.mock.calls[0]?.[1]?.();

    expect(snapshotApi.advanceSnapshotBoundary).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        timeZone: "America/Los_Angeles",
        scheduleLabel: "Morning",
      }),
    );
    expect(snapshotApi.advanceSnapshotBoundary).toHaveBeenCalledTimes(1);
  });

  it("registers other users' schedules even when one row has malformed JSON (P3-56)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        { user_id: "user-bad", schedules_json: "{not valid json" },
        {
          user_id: "user-good",
          schedules_json: JSON.stringify([
            { label: "Morning", time: "08:30", tz: "America/Los_Angeles", enabled: true },
          ]),
        },
      ],
    });

    await initScheduler();

    // The bad row is logged with its user_id and skipped; the good row still registers.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("user-bad"),
      expect.any(String),
    );
    expect(cronApi.schedule).toHaveBeenCalledTimes(1);
    expect(cronApi.schedule).toHaveBeenCalledWith(
      "30 8 * * *",
      expect.any(Function),
      { timezone: "America/Los_Angeles" },
    );
    errorSpy.mockRestore();
  });

  it("logs 'not yet available' only on a missing-table read error (P3-56)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDb.execute.mockRejectedValueOnce(new Error("no such table: ea_settings"));

    await initScheduler();

    expect(logSpy).toHaveBeenCalledWith("[EA Scheduler] Skipping — ea_settings not yet available");
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("does not mislabel a non-missing-table read error as 'not yet available' (P3-56)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDb.execute.mockRejectedValueOnce(new Error("database is locked"));

    await initScheduler();

    expect(logSpy).not.toHaveBeenCalledWith(
      "[EA Scheduler] Skipping — ea_settings not yet available",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[EA Scheduler] Failed to load schedules:",
      "database is locked",
    );
    logSpy.mockRestore();
    errorSpy.mockRestore();
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
  it("runs at the requested deadline and never before it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    triageWorkerApi.processNextEmailTriageJob.mockResolvedValue({ processed: false });

    requestEmailTriageDrainAt("2026-07-14T12:00:30.000Z");

    await vi.advanceTimersByTimeAsync(29_999);
    expect(triageWorkerApi.processNextEmailTriageJob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(triageWorkerApi.processNextEmailTriageJob).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("keeps the earliest requested deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    triageWorkerApi.processNextEmailTriageJob.mockResolvedValue({ processed: false });

    requestEmailTriageDrainAt("2026-07-14T12:00:30.000Z");
    requestEmailTriageDrainAt("2026-07-14T12:00:45.000Z");
    requestEmailTriageDrainAt("2026-07-14T12:00:10.000Z");

    await vi.advanceTimersByTimeAsync(9_999);
    expect(triageWorkerApi.processNextEmailTriageJob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(triageWorkerApi.processNextEmailTriageJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(triageWorkerApi.processNextEmailTriageJob).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("runs a follow-up due-job check when a deadline fires during an active drain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    let resolveFirstClaim: ((result: { processed: boolean }) => void) | undefined;
    triageWorkerApi.processNextEmailTriageJob
      .mockReturnValueOnce(new Promise<{ processed: boolean }>((resolve) => {
        resolveFirstClaim = resolve;
      }))
      .mockResolvedValueOnce({ processed: false });

    const activeDrain = runEmailTriageWorker();
    requestEmailTriageDrainAt("2026-07-14T12:00:00.000Z");
    await vi.advanceTimersByTimeAsync(0);
    resolveFirstClaim?.({ processed: false });
    await activeDrain;
    await vi.runAllTimersAsync();

    expect(triageWorkerApi.processNextEmailTriageJob).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("re-arms for a deadline returned by a deferred triage job", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    triageWorkerApi.processNextEmailTriageJob
      .mockResolvedValueOnce({
        processed: true,
        deferred: true,
        scheduled_for: "2026-07-14T12:00:30.000Z",
      })
      .mockResolvedValue({ processed: false });

    await runEmailTriageWorker();
    expect(triageWorkerApi.processNextEmailTriageJob).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(triageWorkerApi.processNextEmailTriageJob).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(triageWorkerApi.processNextEmailTriageJob).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

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

  it("self-reschedules to keep draining after a full batch (P2-4)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    let calls = 0;
    triageWorkerApi.processNextEmailTriageJob.mockImplementation(async () => {
      calls += 1;
      // First 10 calls fill the batch; afterwards the queue is empty.
      return { processed: calls <= 10 };
    });

    await runEmailTriageWorker();
    expect(calls).toBe(10); // full batch → an immediate re-arm is scheduled

    // Let the setImmediate-scheduled drain run to completion.
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(calls).toBe(11); // re-armed run processed one more, saw empty queue, stopped
    // Recovery runs once on the cron tick, NOT on the immediate self-reschedule.
    expect(triageWorkerApi.recoverStaleRunningTriageJobs).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("stopScheduler (graceful shutdown drain, P3-58)", () => {
  it("awaits active Gmail, triage, snapshot, and reminder work before resolving", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let resolveClaim: ((result: { processed: boolean }) => void) | undefined;
    let resolveBatch: ((result: { processed: number; sent: number; missed: number; failed: number }) => void) | undefined;
    let resolveSnapshot: ((result: { snapshot: { id: number; status: string } }) => void) | undefined;
    let resolveTriage: ((result: { processed: boolean }) => void) | undefined;
    let triageCalls = 0;
    gmailSyncApi.processNextGmailHistorySyncJob.mockReturnValueOnce(
      new Promise<{ processed: boolean }>((resolve) => {
        resolveClaim = resolve;
      }),
    );
    reminderSchedulerApi.processDueReminderBatch.mockReturnValueOnce(
      new Promise<{ processed: number; sent: number; missed: number; failed: number }>((resolve) => {
        resolveBatch = resolve;
      }),
    );
    triageWorkerApi.processNextEmailTriageJob.mockImplementation(() => {
      triageCalls += 1;
      if (triageCalls <= 10) return Promise.resolve({ processed: true });
      return new Promise<{ processed: boolean }>((resolve) => {
        resolveTriage = resolve;
      });
    });
    mockDb.execute.mockResolvedValueOnce({
      rows: [{
        user_id: "user-1",
        schedules_json: JSON.stringify([
          { label: "Morning", time: "08:30", tz: "America/Los_Angeles", enabled: true },
        ]),
      }],
    });
    await initScheduler();
    const snapshotCallback = cronApi.schedule.mock.calls.at(-1)?.[1];
    if (!snapshotCallback) throw new Error("expected snapshot scheduler callback");
    mockDb.execute.mockResolvedValueOnce({
      rows: [{
        schedules_json: JSON.stringify([
          { label: "Morning", time: "08:30", tz: "America/Los_Angeles", enabled: true },
        ]),
      }],
    });
    snapshotApi.advanceSnapshotBoundary.mockReturnValueOnce(
      new Promise<{ snapshot: { id: number; status: string } }>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const snapshotRun = snapshotCallback();

    requestGmailHistorySyncDrain();
    await new Promise((resolve) => setImmediate(resolve));
    await runEmailTriageWorker();
    await new Promise((resolve) => setImmediate(resolve));
    expect(triageCalls).toBe(11);
    const reminderRun = runReminderSchedulerWorker();
    requestEmailTriageDrainAt(new Date(Date.now() + 20));

    const stopPromise = stopScheduler();
    expect(stopScheduler()).toBe(stopPromise);
    let stopResolved = false;
    stopPromise.then(() => {
      stopResolved = true;
    });

    await Promise.resolve();
    expect(stopResolved).toBe(false);

    resolveClaim?.({ processed: false });
    resolveSnapshot?.({ snapshot: { id: 42, status: "active" } });
    resolveTriage?.({ processed: false });
    await Promise.resolve();
    expect(stopResolved).toBe(false);

    resolveBatch?.({ processed: 0, sent: 0, missed: 0, failed: 0 });
    await Promise.all([stopPromise, reminderRun, snapshotRun]);
    expect(stopResolved).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(triageCalls).toBe(11);
    logSpy.mockRestore();
  });
});
