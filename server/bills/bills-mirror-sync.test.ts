import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mockActual = {
  syncActualMetadata: vi.fn(),
};
const mockActualLocal = {
  readLocalActualMetadata: vi.fn(),
};

// test-architecture: allow-boundary-mock -- Actual Budget is the external provider boundary for mirror refresh and degraded-state behavior.
vi.mock("../actual/actual.ts", () => mockActual);
// test-architecture: allow-boundary-mock -- The local Actual cache is a filesystem/provider boundary whose returned metadata drives durable mirror outcomes.
vi.mock("../actual/actual-local-metadata.ts", () => mockActualLocal);

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../db/migrations");
let testDb: Client;

const {
  refreshBillsMirror: refreshBillsMirrorImpl,
  scheduleBillsMirrorRefresh: scheduleBillsMirrorRefreshImpl,
  consumeDueBillsMirrorRefresh: consumeDueBillsMirrorRefreshImpl,
  armPendingBillsMirrorRefreshes,
  startBillsMirrorRefreshWorker,
  stopBillsMirrorRefreshWorker,
} = await import("./bills-mirror-sync.ts");

function refreshBillsMirror(options: Parameters<typeof refreshBillsMirrorImpl>[1]) {
  return refreshBillsMirrorImpl("u1", { ...options, dbClient: testDb });
}

function scheduleBillsMirrorRefresh(options: Parameters<typeof scheduleBillsMirrorRefreshImpl>[1]) {
  return scheduleBillsMirrorRefreshImpl("u1", { ...options, dbClient: testDb });
}

function consumeDueBillsMirrorRefresh(options: Parameters<typeof consumeDueBillsMirrorRefreshImpl>[1]) {
  return consumeDueBillsMirrorRefreshImpl("u1", { ...options, dbClient: testDb });
}

const EMPTY_METADATA = {
  accounts: [],
  payees: [],
  payeeMap: {},
  categories: [],
  schedules: [],
  recentTransactions: [],
};

function billMetadata({
  scheduleId = "sched-1",
  nextDate = "2026-05-10",
  recentTransactions = [],
}: {
  scheduleId?: string;
  nextDate?: string;
  recentTransactions?: Array<Record<string, unknown>>;
} = {}) {
  return {
    accounts: [{ id: "acct-1", name: "Checking" }],
    payees: [{ id: "payee-1", name: "Mortgage Co" }],
    payeeMap: { "payee-1": "Mortgage Co" },
    categories: [],
    schedules: [{
      id: scheduleId,
      name: "Mortgage",
      next_date: nextDate,
      type: "bill",
      conditions: [
        { field: "payee", value: "payee-1" },
        { field: "amount", value: -150000 },
      ],
    }],
    recentTransactions,
  };
}

async function seedState({
  status = "current",
  pendingRefreshAt = null,
  lastError = null,
}: {
  status?: string;
  pendingRefreshAt?: string | null;
  lastError?: string | null;
} = {}) {
  await testDb.execute({
    sql: `INSERT INTO ea_bills_mirror_state
            (user_id, status, actual_configured, actual_budget_url, last_success_at,
             last_attempt_at, last_error, pending_refresh_at, updated_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    args: [
      "u1",
      status,
      "https://actual.example.test",
      "2026-05-05T12:00:00.000Z",
      "2026-05-05T12:00:00.000Z",
      lastError,
      pendingRefreshAt,
      "2026-05-05T12:00:00.000Z",
    ],
  });
}

async function seedOccurrence({
  occurrenceId,
  scheduleId = "stale",
  date,
  paid = false,
  name = "Old Bill",
}: {
  occurrenceId: string;
  scheduleId?: string;
  date: string;
  paid?: boolean;
  name?: string;
}) {
  await testDb.execute({
    sql: `INSERT INTO ea_bill_occurrence_mirror
            (user_id, occurrence_id, schedule_id, occurrence_date, name, payee,
             amount, type, paid, open_action_disabled, raw_json, updated_at)
          VALUES (?, ?, ?, ?, ?, 'Old Payee', 25, 'bill', ?, 0, '{}', ?)`,
    args: ["u1", occurrenceId, scheduleId, date, name, paid ? 1 : 0, "2026-05-05T12:00:00.000Z"],
  });
}

async function occurrenceRows() {
  const result = await testDb.execute({
    sql: `SELECT occurrence_id, schedule_id, occurrence_date, name, payee, amount,
                 paid, open_action_disabled
          FROM ea_bill_occurrence_mirror
          WHERE user_id = ? ORDER BY occurrence_date, occurrence_id`,
    args: ["u1"],
  });
  return result.rows;
}

async function stateRow() {
  const result = await testDb.execute({
    sql: "SELECT status, pending_refresh_at, last_error FROM ea_bills_mirror_state WHERE user_id = ?",
    args: ["u1"],
  });
  return result.rows[0] || null;
}

beforeEach(async () => {
  Object.values(mockActual).forEach((fn) => fn.mockReset());
  Object.values(mockActualLocal).forEach((fn) => fn.mockReset());
  mockActualLocal.readLocalActualMetadata.mockRejectedValue(new Error("local metadata unavailable"));
  mockActual.syncActualMetadata.mockRejectedValue(new Error("Actual sync unavailable"));

  testDb = createClient({ url: "file::memory:" });
  await testDb.executeMultiple(readFileSync(join(migrationsDir, "001_ea_tables.sql"), "utf8"));
  await testDb.executeMultiple(readFileSync(join(migrationsDir, "009_actual_metadata_mirror.sql"), "utf8"));
});

afterEach(async () => {
  await stopBillsMirrorRefreshWorker();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await testDb.close();
});

describe("Bills mirror", () => {
  it("durably replaces stale mirror rows with the refreshed schedule projection", async () => {
    await seedState();
    await seedOccurrence({ occurrenceId: "stale:2026-05-08", date: "2026-05-08" });
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(billMetadata());

    const out = await refreshBillsMirror({
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledWith("u1", { // test-architecture: allow-boundary-interaction -- Refresh must read the local Actual projection without a provider refresh before replacing mirror state.
      localOnly: true,
    });
    expect(mockActual.syncActualMetadata).not.toHaveBeenCalled(); // test-architecture: allow-boundary-interaction -- A successful local projection must not synchronize with the external Actual provider; persisted rows alone cannot prove no extra provider request occurred.
    expect(await occurrenceRows()).toEqual([
      expect.objectContaining({
        occurrence_id: "sched-1:2026-05-10",
        schedule_id: "sched-1",
        payee: "Mortgage Co",
        amount: 1500,
      }),
    ]);
    expect(await stateRow()).toMatchObject({ status: "current", last_error: null });
    expect(out.allSchedules).toEqual([
      expect.objectContaining({ id: "sched-1:2026-05-10", amount: 1500 }),
    ]);
  });

  it("retains only displayable paid history when a schedule advances", async () => {
    await seedState();
    await seedOccurrence({ occurrenceId: "paid-recent", date: "2026-05-01", paid: true });
    await seedOccurrence({ occurrenceId: "unpaid-recent", date: "2026-05-02" });
    await seedOccurrence({ occurrenceId: "paid-old", date: "2025-04-30", paid: true });
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(billMetadata({ nextDate: "2026-06-10" }));

    await refreshBillsMirror({
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect((await occurrenceRows()).map((row) => row.occurrence_id)).toEqual([
      "paid-recent",
      "sched-1:2026-06-10",
    ]);
  });

  it("retains recent paid history when the fresh occurrence set is empty", async () => {
    await seedState();
    await seedOccurrence({ occurrenceId: "paid-recent", date: "2026-05-01", paid: true });
    await seedOccurrence({ occurrenceId: "unpaid-recent", date: "2026-05-02" });
    await seedOccurrence({ occurrenceId: "paid-old", date: "2025-04-30", paid: true });
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce({
      ...EMPTY_METADATA,
      schedules: [{ id: "income", name: "Paycheck", next_date: "2026-05-15", type: "income", conditions: [] }],
    });

    await refreshBillsMirror({
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect((await occurrenceRows()).map((row) => row.occurrence_id)).toEqual(["paid-recent"]);
  });

  it("synchronizes through the SDK before rebuilding the mirror", async () => {
    const fresh = billMetadata({
      recentTransactions: [{ id: "paid-1", scheduleId: "sched-1", payeeId: "payee-1", amount: 1500, date: "2026-05-10" }],
    });
    mockActual.syncActualMetadata.mockResolvedValueOnce(fresh);

    const out = await refreshBillsMirror({
      actualBudgetUrl: "https://actual.example.test",
      refreshLocalActual: true,
      now: new Date("2026-05-10T20:00:00.000Z"),
    });

    expect(out.allSchedules).toEqual([
      expect.objectContaining({ paid: true, openActionDisabled: true }),
    ]);
    expect(await occurrenceRows()).toEqual([
      expect.objectContaining({ paid: 1, open_action_disabled: 1 }),
    ]);
  });

  it("preserves old rows and durably records degraded health when local Actual refresh fails", async () => {
    await seedState();
    await seedOccurrence({ occurrenceId: "sched-1:2026-05-10", scheduleId: "sched-1", date: "2026-05-10", name: "Mortgage" });
    mockActualLocal.readLocalActualMetadata.mockRejectedValueOnce(new Error("Actual local file unavailable"));
    mockActual.syncActualMetadata.mockRejectedValueOnce(new Error("Actual sync timed out"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const out = await refreshBillsMirror({
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(await occurrenceRows()).toHaveLength(1);
    expect(await stateRow()).toMatchObject({ status: "degraded", last_error: "Actual sync timed out" });
    expect(out.billsSyncHealth).toMatchObject({ state: "degraded", lastError: "Actual sync timed out" });
  });

  it("coalesces concurrent refreshes for one user", async () => {
    let release!: (value: ReturnType<typeof billMetadata>) => void;
    mockActualLocal.readLocalActualMetadata.mockReturnValueOnce(new Promise((resolve) => {
      release = resolve;
    }));

    const first = refreshBillsMirror({
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });
    const second = refreshBillsMirror({
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });
    await Promise.resolve();

    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledTimes(1); // test-architecture: allow-boundary-interaction -- Coalesced refresh callers must share one Actual projection read.
    release(billMetadata());
    const [firstOut, secondOut] = await Promise.all([first, second]);
    expect(firstOut).toEqual(secondOut);
    expect(await occurrenceRows()).toHaveLength(1);
  });

  it("publishes a verified write after an older refresh instead of reusing its stale snapshot", async () => {
    let release!: (value: ReturnType<typeof billMetadata>) => void;
    mockActualLocal.readLocalActualMetadata
      .mockReturnValueOnce(new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce(billMetadata({ nextDate: "2026-06-10" }));
    const options = { actualBudgetUrl: "https://actual.example.test", now: new Date("2026-05-06T12:00:00.000Z") };
    const older = refreshBillsMirror(options);
    await scheduleBillsMirrorRefresh({ delayMs: 60_000 });
    const publication = refreshBillsMirror({ ...options, afterVerifiedWrite: true });
    release(billMetadata());
    await older;
    const out = await publication;
    expect(out.allSchedules).toEqual([expect.objectContaining({ id: "sched-1:2026-06-10" })]);
    expect((await occurrenceRows()).map((row) => row.occurrence_id)).toEqual(["sched-1:2026-06-10"]);
    expect(await stateRow()).toMatchObject({ status: "current", pending_refresh_at: null });
    const projection = (await testDb.execute("SELECT schedules_json FROM ea_actual_metadata_mirror")).rows[0]!;
    expect(JSON.parse(String(projection.schedules_json))).toEqual([expect.objectContaining({ next_date: "2026-06-10" })]);
  });

  it("keeps a durable retry if verified-write publication fails after an older refresh cleared pending work", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let release!: (value: ReturnType<typeof billMetadata>) => void;
    mockActualLocal.readLocalActualMetadata
      .mockReturnValueOnce(new Promise((resolve) => { release = resolve; }))
      .mockRejectedValueOnce(new Error("Local budget unavailable after write"));
    const options = { actualBudgetUrl: "https://actual.example.test", now: new Date("2026-05-06T12:00:00.000Z") };
    const older = refreshBillsMirror(options);
    await scheduleBillsMirrorRefresh({ delayMs: 60_000 });
    const publication = refreshBillsMirror({ ...options, afterVerifiedWrite: true });
    release(billMetadata());
    await older;
    const out = await publication;
    expect(out.billsSyncHealth).toMatchObject({ state: "degraded", lastError: "Local budget unavailable after write" });
    expect(await stateRow()).toMatchObject({ status: "degraded", pending_refresh_at: expect.any(String) });
    expect((await occurrenceRows()).map((row) => row.occurrence_id)).toEqual(["sched-1:2026-05-10"]);
  });

  it("schedules and consumes a durable delayed refresh", async () => {
    const scheduled = await scheduleBillsMirrorRefresh({
      delayMs: 60_000,
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(scheduled).toEqual({ pendingRefreshAt: "2026-05-06T12:01:00.000Z" });
    expect(await stateRow()).toMatchObject({ status: "needs_sync", pending_refresh_at: "2026-05-06T12:01:00.000Z" });

    await expect(consumeDueBillsMirrorRefresh({
      now: new Date("2026-05-06T12:01:01.000Z"),
    })).resolves.toBe(true);
    expect((await stateRow())?.pending_refresh_at).toBeNull();
  });

  it("atomically admits only one concurrent due-refresh claim", async () => {
    await seedState({ pendingRefreshAt: "2026-05-06T12:01:00.000Z" });
    const now = new Date("2026-05-06T12:01:01.000Z");

    const results = await Promise.all([
      consumeDueBillsMirrorRefresh({ now }),
      consumeDueBillsMirrorRefresh({ now }),
    ]);

    expect(results.sort()).toEqual([false, true]);
    expect((await stateRow())?.pending_refresh_at).toBeNull();
  });

  it("keeps an earlier already-pending refresh when scheduling later work", async () => {
    await seedState({ pendingRefreshAt: "2026-05-06T12:00:30.000Z" });

    const out = await scheduleBillsMirrorRefresh({
      delayMs: 60_000,
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(out.pendingRefreshAt).toBe("2026-05-06T12:00:30.000Z");
    expect((await stateRow())?.pending_refresh_at).toBe("2026-05-06T12:00:30.000Z");
  });

  it("does not wipe a populated mirror after a transient empty Actual read", async () => {
    await seedState();
    await seedOccurrence({ occurrenceId: "sched-1:2026-05-10", scheduleId: "sched-1", date: "2026-05-10", name: "Mortgage" });
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(EMPTY_METADATA);

    const out = await refreshBillsMirror({
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(await occurrenceRows()).toHaveLength(1);
    expect(await stateRow()).toMatchObject({ status: "degraded" });
    expect(out.allSchedules).toEqual([expect.objectContaining({ id: "sched-1:2026-05-10" })]);
  });

  it("accepts an empty Actual read when the prior mirror is also empty", async () => {
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(EMPTY_METADATA);

    const out = await refreshBillsMirror({
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(await occurrenceRows()).toEqual([]);
    expect(await stateRow()).toMatchObject({ status: "current" });
    expect(out.allSchedules).toEqual([]);
  });

  it("stops the interval worker without consuming later durable work", async () => {
    vi.useFakeTimers();
    vi.stubEnv("EA_USER_ID", "u1");
    startBillsMirrorRefreshWorker({ dbClient: testDb, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    await stopBillsMirrorRefreshWorker();
    await scheduleBillsMirrorRefresh({
      delayMs: 0,
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    await vi.advanceTimersByTimeAsync(5000);

    expect((await stateRow())?.pending_refresh_at).toBe("2026-05-06T12:00:00.000Z");
  });

  it("refreshes direct Actual changes during idle maintenance and respects the five-minute cadence", async () => {
    vi.stubEnv("EA_USER_ID", "u1");
    await seedState();
    await testDb.execute("INSERT INTO ea_settings (user_id, actual_budget_url) VALUES ('u1', 'https://actual.example.test')");
    mockActual.syncActualMetadata.mockResolvedValueOnce(billMetadata());
    const now = new Date("2026-05-06T12:00:00.000Z");
    await armPendingBillsMirrorRefreshes({ dbClient: testDb, now });
    expect((await occurrenceRows()).map((row) => row.occurrence_id)).toEqual(["sched-1:2026-05-10"]);

    mockActual.syncActualMetadata.mockResolvedValueOnce(billMetadata({ nextDate: "2026-06-10" }));
    await armPendingBillsMirrorRefreshes({ dbClient: testDb, now: new Date(now.getTime() + 299_999) });
    expect((await occurrenceRows()).map((row) => row.occurrence_id)).toEqual(["sched-1:2026-05-10"]);
    await armPendingBillsMirrorRefreshes({ dbClient: testDb, now: new Date(now.getTime() + 300_000) });
    expect((await occurrenceRows()).map((row) => row.occurrence_id)).toEqual(["sched-1:2026-06-10"]);
  });

  it("retries failed idle maintenance after one minute while preserving the previous mirror", async () => {
    vi.stubEnv("EA_USER_ID", "u1");
    await seedState();
    await seedOccurrence({ occurrenceId: "old:2026-05-10", date: "2026-05-10" });
    await testDb.execute("INSERT INTO ea_settings (user_id, actual_budget_url) VALUES ('u1', 'https://actual.example.test')");
    const now = new Date("2026-05-06T12:00:00.000Z");
    await armPendingBillsMirrorRefreshes({ dbClient: testDb, now });
    expect(await stateRow()).toMatchObject({ status: "degraded" });
    mockActual.syncActualMetadata.mockResolvedValueOnce(billMetadata());
    await armPendingBillsMirrorRefreshes({ dbClient: testDb, now: new Date(now.getTime() + 59_999) });
    expect((await occurrenceRows()).map((row) => row.occurrence_id)).toEqual(["old:2026-05-10"]);
    await armPendingBillsMirrorRefreshes({ dbClient: testDb, now: new Date(now.getTime() + 60_000) });
    expect((await occurrenceRows()).map((row) => row.occurrence_id)).toEqual(["sched-1:2026-05-10"]);
    expect(await stateRow()).toMatchObject({ status: "current" });
  });

  it("allows a fresh worker start after stop", async () => {
    startBillsMirrorRefreshWorker({ dbClient: testDb, intervalMs: 1000 });
    await stopBillsMirrorRefreshWorker();

    expect(startBillsMirrorRefreshWorker({ dbClient: testDb, intervalMs: 1000 })).toEqual({ started: true });
  });

  it("drains a startup scan admitted before stop through its final mirror publication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T12:00:00.000Z"));
    vi.stubEnv("EA_USER_ID", "u1");
    await seedState();
    await testDb.execute("INSERT INTO ea_settings (user_id, actual_budget_url) VALUES ('u1', 'https://actual.example.test')");
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const execute = testDb.execute.bind(testDb);
    // The database boundary stalls before the startup scan can discover work.
    vi.spyOn(testDb, "execute").mockImplementationOnce(async (statement) => {
      await readGate;
      return execute(statement);
    });
    mockActual.syncActualMetadata.mockResolvedValueOnce(billMetadata());
    startBillsMirrorRefreshWorker({ dbClient: testDb });
    const stopped = stopBillsMirrorRefreshWorker();
    expect(startBillsMirrorRefreshWorker({ dbClient: testDb })).toEqual({ started: false });
    releaseRead();
    await stopped;
    expect(await stateRow()).toMatchObject({ status: "current", pending_refresh_at: null });
    expect((await occurrenceRows()).map((row) => row.occurrence_id)).toEqual(["sched-1:2026-05-10"]);
  });

  it("finishes a refresh already awaiting Actual before stop resolves", async () => {
    let releaseSync!: (value: ReturnType<typeof billMetadata>) => void;
    mockActual.syncActualMetadata.mockReturnValueOnce(new Promise((resolve) => { releaseSync = resolve; }));
    const refresh = refreshBillsMirror({
      actualBudgetUrl: "https://actual.example.test",
      refreshLocalActual: true,
      now: new Date("2026-05-06T12:00:00.000Z"),
    });
    const stopped = stopBillsMirrorRefreshWorker();
    releaseSync(billMetadata());
    await stopped;
    expect(await stateRow()).toMatchObject({ status: "current" });
    expect((await occurrenceRows()).map((row) => row.occurrence_id)).toEqual(["sched-1:2026-05-10"]);
    await refresh;
  });
});
