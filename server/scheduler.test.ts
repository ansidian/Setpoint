import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSchedulerRuntime } from "./scheduler.ts";

type HistoryResult = { processed: boolean };
type TriageResult = { processed?: boolean; paused?: boolean; scheduled_for?: string };
type ReminderResult = { processed: number; sent: number; missed: number; failed: number };

function createHarness() {
  const scheduled: Array<{
    expression: string;
    callback: () => unknown;
    options: unknown;
    stopped: boolean;
  }> = [];
  const state = {
    historyClaims: 0,
    triageClaims: 0,
    recoveries: 0,
    reminderBatches: 0,
    embeddingRuns: 0,
    snapshotAdvances: [] as Array<{ userId: string; options: unknown }>,
  };
  let dbHandler: (statement: unknown) => Promise<{ rows: Array<Record<string, unknown>> }> = async () => ({ rows: [] });
  let historyHandler: () => Promise<HistoryResult> = async () => ({ processed: false });
  let triageHandler: () => Promise<TriageResult> = async () => ({ processed: false });
  let reminderHandler: () => Promise<ReminderResult> = async () => ({ processed: 0, sent: 0, missed: 0, failed: 0 });
  let embeddingHandler = async () => ({ processed: false, users: [] as Array<{ user_id: string; embedded: number; selected: number }> });
  let snapshotHandler = async () => ({ snapshot: { id: 42, status: "active" } });

  const runtime = createSchedulerRuntime({
    cronSchedule: ((expression: string, callback: () => unknown, options: unknown) => {
      const job = { expression, callback, options, stopped: false };
      scheduled.push(job);
      return { stop: () => { job.stopped = true; } };
    }) as never,
    dbClient: { execute: (statement: unknown) => dbHandler(statement) } as never,
    loadConfig: async () => ({ accounts: [], settings: {} }) as never,
    fetchEmails: async () => [],
    indexEmailRows: async () => undefined as never,
    enqueueTriage: async () => undefined as never,
    processHistoryJob: async () => {
      state.historyClaims += 1;
      return historyHandler();
    },
    renewWatches: async () => undefined as never,
    processTriageJob: async () => {
      state.triageClaims += 1;
      return triageHandler() as never;
    },
    recoverTriageJobs: async () => {
      state.recoveries += 1;
      return { recovered: 0 } as never;
    },
    createTriageContext: () => ({}) as never,
    pruneTriageJobs: async () => 0,
    processEmbeddings: (async () => {
      state.embeddingRuns += 1;
      return embeddingHandler();
    }) as never,
    processReminders: async () => {
      state.reminderBatches += 1;
      return reminderHandler();
    },
    advanceSnapshot: async (userId, options) => {
      state.snapshotAdvances.push({ userId, options });
      return snapshotHandler() as never;
    },
  });

  return {
    runtime,
    scheduled,
    state,
    setDbHandler: (handler: typeof dbHandler) => { dbHandler = handler; },
    setHistoryHandler: (handler: typeof historyHandler) => { historyHandler = handler; },
    setTriageHandler: (handler: typeof triageHandler) => { triageHandler = handler; },
    setReminderHandler: (handler: typeof reminderHandler) => { reminderHandler = handler; },
    setEmbeddingHandler: (handler: typeof embeddingHandler) => { embeddingHandler = handler; },
    setSnapshotHandler: (handler: typeof snapshotHandler) => { snapshotHandler = handler; },
  };
}

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.map(String).join(" ")); });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args.map(String).join(" ")); });
  return {
    logs,
    errors,
    restore: () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

async function flushImmediates(count = 3) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("snapshot boundary composition", () => {
  it("coalesces concurrent initialization so only one cron job remains live", async () => {
    const harness = createHarness();
    harness.setDbHandler(async () => ({ rows: [{
      user_id: "u1",
      schedules_json: JSON.stringify([{ enabled: true, time: "09:00", label: "Morning", tz: "America/Los_Angeles" }]),
    }] }));

    await Promise.all([harness.runtime.initScheduler(), harness.runtime.initScheduler()]);

    expect(harness.scheduled.filter((job) => !job.stopped)).toHaveLength(1);
  });

  it("registers saved schedules and advances the matching user boundary", async () => {
    const harness = createHarness();
    harness.setDbHandler(async () => ({ rows: [{
      user_id: "user-1",
      schedules_json: JSON.stringify([{ label: "Morning", time: "08:30", tz: "America/Los_Angeles", enabled: true }]),
    }] }));

    await harness.runtime.initScheduler();
    expect(harness.scheduled.map(({ expression, options }) => ({ expression, options }))).toEqual([{
      expression: "30 8 * * *",
      options: { timezone: "America/Los_Angeles" },
    }]);

    await harness.scheduled[0]!.callback();
    expect(harness.state.snapshotAdvances).toEqual([{
      userId: "user-1",
      options: { timeZone: "America/Los_Angeles", scheduleLabel: "Morning" },
    }]);
  });

  it("isolates malformed rows and still registers valid users", async () => {
    const harness = createHarness();
    const consoleCapture = captureConsole();
    harness.setDbHandler(async () => ({ rows: [
      { user_id: "user-bad", schedules_json: "{not valid json" },
      {
        user_id: "user-good",
        schedules_json: JSON.stringify([{ label: "Morning", time: "08:30", tz: "America/Los_Angeles", enabled: true }]),
      },
    ] }));

    await harness.runtime.initScheduler();

    expect(harness.scheduled).toHaveLength(1);
    expect(consoleCapture.errors.join(" ")).toContain("user-bad");
    consoleCapture.restore();
  });

  it("distinguishes a missing settings table from other database failures", async () => {
    const missing = createHarness();
    const missingConsole = captureConsole();
    missing.setDbHandler(async () => { throw new Error("no such table: ea_settings"); });
    await missing.runtime.initScheduler();
    expect(missingConsole.logs).toContain("[EA Scheduler] Skipping — ea_settings not yet available");
    missingConsole.restore();

    const locked = createHarness();
    const lockedConsole = captureConsole();
    locked.setDbHandler(async () => { throw new Error("database is locked"); });
    await locked.runtime.initScheduler();
    expect(lockedConsole.logs).not.toContain("[EA Scheduler] Skipping — ea_settings not yet available");
    expect(lockedConsole.errors.join(" ")).toContain("database is locked");
    lockedConsole.restore();
  });
});

describe("Gmail history drain", () => {
  it("runs a follow-up claim when another push arrives during an active drain", async () => {
    const harness = createHarness();
    const consoleCapture = captureConsole();
    let resolveFirst: ((result: HistoryResult) => void) | undefined;
    harness.setHistoryHandler(() => harness.state.historyClaims === 1
      ? new Promise<HistoryResult>((resolve) => { resolveFirst = resolve; })
      : Promise.resolve({ processed: false }));

    harness.runtime.requestGmailHistorySyncDrain();
    await flushImmediates(1);
    expect(harness.state.historyClaims).toBe(1);

    harness.runtime.requestGmailHistorySyncDrain();
    await flushImmediates(1);
    resolveFirst?.({ processed: false });
    await flushImmediates();

    expect(harness.state.historyClaims).toBe(2);
    consoleCapture.restore();
  });
});

describe("reminder scheduler", () => {
  it("logs only aggregate reminder results and stays single-flight", async () => {
    const harness = createHarness();
    const consoleCapture = captureConsole();
    let resolveBatch: ((result: ReminderResult) => void) | undefined;
    harness.setReminderHandler(() => new Promise<ReminderResult>((resolve) => { resolveBatch = resolve; }));

    const first = harness.runtime.runReminderSchedulerWorker();
    const second = harness.runtime.runReminderSchedulerWorker();
    expect(harness.state.reminderBatches).toBe(1);

    resolveBatch?.({ processed: 3, sent: 1, missed: 1, failed: 1 });
    await Promise.all([first, second]);
    expect(consoleCapture.logs).toContain("[Reminder Scheduler] Processed 3 reminder(s): 1 sent, 1 missed, 1 failed");
    expect(consoleCapture.errors).toEqual([]);
    consoleCapture.restore();
  });

  it("runs first after two seconds and then every ten seconds", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const consoleCapture = captureConsole();

    harness.runtime.startReminderSchedulerWorker();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(harness.state.reminderBatches).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.state.reminderBatches).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.state.reminderBatches).toBe(2);
    consoleCapture.restore();
  });
});

describe("embedding scheduler", () => {
  it("emits aggregate counts without user identifiers", async () => {
    const harness = createHarness();
    const consoleCapture = captureConsole();
    harness.setEmbeddingHandler(async () => ({
      processed: true,
      users: [{ user_id: "user-1", embedded: 2, selected: 3 }],
    }));

    await harness.runtime.runEmailSearchEmbeddingWorker();

    expect(harness.state.embeddingRuns).toBe(1);
    expect(consoleCapture.logs).toContain("[Email Search Embeddings] Embedded 2 indexed email(s)");
    expect(consoleCapture.logs.join(" ")).not.toContain("user-1");
    consoleCapture.restore();
  });
});

describe("email triage scheduling", () => {
  it("runs at the requested deadline, never before it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const harness = createHarness();

    harness.runtime.requestEmailTriageDrainAt("2026-07-14T12:00:30.000Z");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(harness.state.triageClaims).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.state.triageClaims).toBe(1);
  });

  it("keeps only the earliest requested deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const harness = createHarness();

    harness.runtime.requestEmailTriageDrainAt("2026-07-14T12:00:30.000Z");
    harness.runtime.requestEmailTriageDrainAt("2026-07-14T12:00:45.000Z");
    harness.runtime.requestEmailTriageDrainAt("2026-07-14T12:00:10.000Z");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.state.triageClaims).toBe(1);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(harness.state.triageClaims).toBe(1);
  });

  it("runs a follow-up check when a deadline fires during an active drain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const harness = createHarness();
    let resolveFirst: ((result: TriageResult) => void) | undefined;
    harness.setTriageHandler(() => harness.state.triageClaims === 1
      ? new Promise<TriageResult>((resolve) => { resolveFirst = resolve; })
      : Promise.resolve({ processed: false }));

    const active = harness.runtime.runEmailTriageWorker();
    harness.runtime.requestEmailTriageDrainAt("2026-07-14T12:00:00.000Z");
    await vi.advanceTimersByTimeAsync(0);
    resolveFirst?.({ processed: false });
    await active;
    await vi.runAllTimersAsync();

    expect(harness.state.triageClaims).toBe(2);
  });

  it("re-arms from a deferred job and skips recovery on the immediate follow-up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const harness = createHarness();
    harness.setTriageHandler(async () => harness.state.triageClaims === 1
      ? { processed: true, scheduled_for: "2026-07-14T12:00:30.000Z" }
      : { processed: false });

    await harness.runtime.runEmailTriageWorker();
    expect(harness.state.triageClaims).toBe(2);
    expect(harness.state.recoveries).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(harness.state.triageClaims).toBe(3);
  });

  it("stops cleanly when triage mode is paused", async () => {
    const harness = createHarness();
    harness.setTriageHandler(async () => ({ processed: false, paused: true }));

    await harness.runtime.runEmailTriageWorker();

    expect(harness.state).toMatchObject({ triageClaims: 1, recoveries: 1 });
  });

  it("self-reschedules after a full batch without repeating stale recovery", async () => {
    const harness = createHarness();
    const consoleCapture = captureConsole();
    harness.setTriageHandler(async () => ({ processed: harness.state.triageClaims <= 10 }));

    await harness.runtime.runEmailTriageWorker();
    expect(harness.state.triageClaims).toBe(10);
    await flushImmediates(5);

    expect(harness.state.triageClaims).toBe(11);
    expect(harness.state.recoveries).toBe(1);
    consoleCapture.restore();
  });
});

describe("graceful scheduler stop", () => {
  it("is idempotent and waits for admitted Gmail, triage, reminder, and snapshot work", async () => {
    const harness = createHarness();
    const consoleCapture = captureConsole();
    let resolveHistory: ((result: HistoryResult) => void) | undefined;
    let resolveTriage: ((result: TriageResult) => void) | undefined;
    let resolveReminder: ((result: ReminderResult) => void) | undefined;
    let resolveSnapshot: (() => void) | undefined;
    harness.setHistoryHandler(() => new Promise<HistoryResult>((resolve) => { resolveHistory = resolve; }));
    harness.setTriageHandler(() => new Promise<TriageResult>((resolve) => { resolveTriage = resolve; }));
    harness.setReminderHandler(() => new Promise<ReminderResult>((resolve) => { resolveReminder = resolve; }));
    harness.setSnapshotHandler(() => new Promise<never>((resolve) => {
      resolveSnapshot = () => resolve(undefined as never);
    }));
    harness.setDbHandler(async () => ({ rows: [{
      user_id: "user-1",
      schedules_json: JSON.stringify([{ label: "Morning", time: "08:30", tz: "America/Los_Angeles", enabled: true }]),
    }] }));

    await harness.runtime.initScheduler();
    const snapshotJob = harness.scheduled[0]!;
    const snapshotRun = snapshotJob.callback();
    harness.runtime.requestGmailHistorySyncDrain();
    await flushImmediates(1);
    const triageRun = harness.runtime.runEmailTriageWorker();
    const reminderRun = harness.runtime.runReminderSchedulerWorker();

    const stop = harness.runtime.stopScheduler();
    expect(harness.runtime.stopScheduler()).toBe(stop);
    let stopped = false;
    void stop.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    resolveHistory?.({ processed: false });
    resolveTriage?.({ processed: false });
    resolveReminder?.({ processed: 0, sent: 0, missed: 0, failed: 0 });
    resolveSnapshot?.();
    await Promise.all([stop, triageRun, reminderRun, Promise.resolve(snapshotRun)]);
    expect(stopped).toBe(true);
    consoleCapture.restore();
  });
});
