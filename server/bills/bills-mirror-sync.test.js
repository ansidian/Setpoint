import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockActual = {
  sendBill: vi.fn(),
  markBillPaid: vi.fn(),
  getMetadata: vi.fn(),
  getCalendarBillsRange: vi.fn(),
  testConnection: vi.fn(),
  createQuickTxn: vi.fn(),
};
const mockActualLocal = {
  describeLocalActualCache: vi.fn(),
  hydrateLocalActualCache: vi.fn(),
  readLocalActualMetadata: vi.fn(),
};
const mockDb = { execute: vi.fn(), batch: vi.fn() };
vi.mock("../actual/actual.js", () => mockActual);
vi.mock("../actual/actual-local-metadata.js", () => mockActualLocal);
vi.mock("../db/connection.js", () => ({ default: mockDb }));

beforeEach(() => {
  Object.values(mockActual).forEach((fn) => fn.mockReset());
  Object.values(mockActualLocal).forEach((fn) => fn.mockReset());
  mockActualLocal.readLocalActualMetadata.mockRejectedValue(new Error("lightweight metadata unavailable"));
  mockActual.getMetadata.mockResolvedValue({ accounts: [], payees: [], categories: [], schedules: [], recentTransactions: [] });
  mockDb.execute.mockReset();
  mockDb.batch.mockReset();
});

const {
  readBillsMirrorRange,
  readBillsMirrorCurrent,
  refreshBillsMirror,
  scheduleBillsMirrorRefresh,
  consumeDueBillsMirrorRefresh,
  isBillsMirrorMaintenanceDue,
  startBillsMirrorRefreshWorker,
  stopBillsMirrorRefreshWorker,
  __resetBillsMirrorRefreshTimersForTests,
} = await import("./bills-mirror-sync.js");

// scheduleBillsMirrorRefresh arms a real setTimeout; clear it after every test so an
// armed timer never leaks into a later test (previously only two cases reset inline).
afterEach(() => {
  __resetBillsMirrorRefreshTimersForTests();
});

function rowResult(rows = []) {
  return { rows };
}

describe("Bills mirror", () => {
  it("reads occurrence mirror rows with stable occurrence ids and sync health", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rowResult([
        {
          status: "current",
          actual_configured: 1,
          actual_budget_url: "https://actual.example.test",
          last_success_at: "2026-05-06T12:00:00.000Z",
          last_attempt_at: "2026-05-06T12:00:00.000Z",
          last_error: null,
          pending_refresh_at: null,
          refresh_started_at: null,
        },
      ]))
      .mockResolvedValueOnce(rowResult([
        {
          occurrence_id: "sched-1:2026-05-10",
          schedule_id: "sched-1",
          occurrence_date: "2026-05-10",
          name: "Mortgage",
          payee: "Mortgage Co",
          amount: 1500,
          type: "bill",
          paid: 0,
          open_action_disabled: 0,
        },
      ]));

    const out = await readBillsMirrorRange("u1", { start: "2026-05-01", end: "2026-05-31" });

    expect(out).toMatchObject({
      schedules: [
        {
          id: "sched-1:2026-05-10",
          scheduleId: "sched-1",
          next_date: "2026-05-10",
          paid: false,
          openActionDisabled: false,
        },
      ],
      recentTransactions: [],
      actualBudgetUrl: "https://actual.example.test",
      syncHealth: {
        state: "current",
        configured: true,
        lastSuccessAt: "2026-05-06T12:00:00.000Z",
      },
    });
  });

  it("returns empty mirror data with needs_sync health without reading Actual", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rowResult([]))
      .mockResolvedValueOnce(rowResult([]));

    const out = await readBillsMirrorRange("u1", { start: "2026-05-01", end: "2026-05-31" });

    expect(out.schedules).toEqual([]);
    expect(out.syncHealth).toMatchObject({ state: "needs_sync", configured: null });
    expect(mockActual.getCalendarBillsRange).not.toHaveBeenCalled();
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
  });

  it("readBillsMirrorCurrent returns 7-day bills but a broader allSchedules window", async () => {
    const now = new Date("2026-05-06T12:00:00.000Z");
    mockDb.execute
      .mockResolvedValueOnce(rowResult([
        {
          status: "current",
          actual_configured: 1,
          actual_budget_url: "https://actual.example.test",
          last_success_at: "2026-05-06T12:00:00.000Z",
          last_attempt_at: "2026-05-06T12:00:00.000Z",
          last_error: null,
          pending_refresh_at: null,
          refresh_started_at: null,
        },
      ]))
      .mockResolvedValueOnce(rowResult([
        {
          occurrence_id: "spectrum:2026-05-11",
          schedule_id: "spectrum",
          occurrence_date: "2026-05-11",
          name: "Spectrum",
          payee: "Spectrum",
          amount: 50,
          type: "bill",
          paid: 0,
          open_action_disabled: 0,
        },
        {
          occurrence_id: "water:2026-06-26",
          schedule_id: "water",
          occurrence_date: "2026-06-26",
          name: "Water Bill",
          payee: "SGV Water",
          amount: 50.67,
          type: "bill",
          paid: 0,
          open_action_disabled: 0,
        },
        {
          occurrence_id: "sce:2026-07-15",
          schedule_id: "sce",
          occurrence_date: "2026-07-15",
          name: "SCE",
          payee: "SCE",
          amount: 120,
          type: "bill",
          paid: 0,
          open_action_disabled: 0,
        },
      ]));

    const out = await readBillsMirrorCurrent("u1", { now });

    expect(out.bills.map((bill) => bill.scheduleId)).toEqual(["spectrum"]);
    expect(out.allSchedules.map((bill) => bill.scheduleId)).toEqual(["spectrum", "water", "sce"]);
    // The broader read window (lookback into April, lookahead into August) is the
    // behavioral contract. Match the occurrence query by its table marker instead of
    // pinning it to a positional call index.
    const occurrenceCall = mockDb.execute.mock.calls.find((call) =>
      /ea_bill_occurrence_mirror/i.test(call[0].sql),
    );
    expect(occurrenceCall).toBeTruthy();
    expect(occurrenceCall[0].args).toEqual(expect.arrayContaining([
      "u1",
      expect.stringMatching(/^2026-04-/),
      expect.stringMatching(/^2026-08-/),
    ]));
  });

  it("upserts schedule and occurrence mirror rows and prunes stale ones on successful refresh", async () => {
    const actualMetadata = {
      accounts: [{ id: "acct-1", name: "Checking" }],
      payees: [{ id: "payee-1", name: "Mortgage Co" }],
      payeeMap: { "payee-1": "Mortgage Co" },
      categories: [{ group_name: "Home", categories: [{ id: "cat-1", name: "Mortgage" }] }],
      schedules: [
        {
          id: "sched-1",
          name: "Mortgage",
          next_date: "2026-05-10",
          type: "bill",
          conditions: [
            { field: "payee", value: "payee-1" },
            { field: "amount", value: -150000 },
          ],
        },
      ],
      recentTransactions: [],
    };
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(actualMetadata);
    mockDb.batch.mockResolvedValueOnce([]);
    mockDb.execute.mockResolvedValueOnce(rowResult());

    const out = await refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledWith("u1", {
      refresh: false,
      localOnly: true,
    });
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
    expect(mockActual.getCalendarBillsRange).not.toHaveBeenCalled();
    // The refresh upserts fresh rows and prunes stale ones rather than deleting all and
    // re-inserting. Assert that behavior without pinning statement order or whitespace:
    // (1) the occurrence rows are written via an upsert (INSERT ... ON CONFLICT), and
    // (2) stale occurrences are removed by a NOT IN prune, not an unconditional delete.
    const batchSql = mockDb.batch.mock.calls[0][0].map((entry) => entry.sql);
    const occurrenceUpsert = batchSql.find((sql) =>
      /INSERT INTO ea_bill_occurrence_mirror/i.test(sql) && /ON CONFLICT/i.test(sql),
    );
    expect(occurrenceUpsert).toBeTruthy();
    const occurrencePrune = batchSql.find((sql) =>
      /DELETE FROM ea_bill_occurrence_mirror/i.test(sql) && /occurrence_id NOT IN/i.test(sql),
    );
    expect(occurrencePrune).toBeTruthy();
    expect(out.syncHealth).toMatchObject({ state: "current", configured: true });
    expect(out.allSchedules).toEqual([
      expect.objectContaining({
        id: "sched-1:2026-05-10",
        scheduleId: "sched-1",
        payee: "Mortgage Co",
        amount: 1500,
      }),
    ]);
  });

  it("retains cleared (paid) past occurrences instead of pruning them when a schedule advances", async () => {
    // A paid bill whose schedule has rolled forward is no longer in the fresh set,
    // so the orphan prune would normally delete its now-past occurrence. The bill
    // view should keep cleared history, so the occurrence prune must spare rows that
    // are paid and dated in the past, within the retention window.
    const actualMetadata = {
      accounts: [{ id: "acct-1", name: "Checking" }],
      payees: [{ id: "payee-1", name: "Mortgage Co" }],
      payeeMap: { "payee-1": "Mortgage Co" },
      categories: [],
      schedules: [
        {
          id: "sched-1",
          name: "Mortgage",
          next_date: "2026-06-10",
          type: "bill",
          conditions: [
            { field: "payee", value: "payee-1" },
            { field: "amount", value: -150000 },
          ],
        },
      ],
      recentTransactions: [],
    };
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(actualMetadata);
    mockDb.batch.mockResolvedValueOnce([]);
    mockDb.execute.mockResolvedValueOnce(rowResult());

    await refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    const occurrencePrune = mockDb.batch.mock.calls[0][0].find((entry) =>
      /DELETE FROM ea_bill_occurrence_mirror/i.test(entry.sql) && /occurrence_id NOT IN/i.test(entry.sql),
    );
    expect(occurrencePrune).toBeTruthy();
    // Orphans are still pruned, but cleared past occurrences within retention are spared.
    expect(occurrencePrune.sql).toMatch(/paid = 1/i);
    // Retention is bounded to the displayable 12-month window: today and today-12mo.
    expect(occurrencePrune.args).toEqual(expect.arrayContaining(["2026-05-06", "2025-05-06"]));
  });

  it("retains cleared past occurrences even when the fresh occurrence set is empty", async () => {
    // The budget has schedules but none are bill-like (all income), so the fresh
    // occurrence set is empty. The empty-set prune must still spare paid history
    // rather than unconditionally wiping every occurrence row for the user.
    const actualMetadata = {
      accounts: [{ id: "acct-1", name: "Checking" }],
      payees: [],
      categories: [],
      schedules: [
        { id: "paycheck", name: "Paycheck", next_date: "2026-05-15", type: "income", conditions: [] },
      ],
      recentTransactions: [],
    };
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(actualMetadata);
    mockDb.batch.mockResolvedValueOnce([]);
    mockDb.execute.mockResolvedValueOnce(rowResult());

    await refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    const occurrencePrune = mockDb.batch.mock.calls[0][0].find((entry) =>
      /DELETE FROM ea_bill_occurrence_mirror/i.test(entry.sql),
    );
    expect(occurrencePrune).toBeTruthy();
    // No unconditional wipe: paid history within retention is spared.
    expect(occurrencePrune.sql).toMatch(/paid = 1/i);
    expect(occurrencePrune.sql).not.toMatch(/occurrence_id NOT IN/i);
    expect(occurrencePrune.args).toEqual(["u1", "2026-05-06", "2025-05-06"]);
  });

  it("prefers the cached local Actual projection for mirror refreshes", async () => {
    const syncedMetadata = {
      accounts: [],
      payees: [{ id: "payee-water", name: "SGV Water" }],
      payeeMap: { "payee-water": "SGV Water" },
      categories: [],
      schedules: [
        {
          id: "water",
          name: "Water Bill",
          next_date: "2026-05-26",
          type: "bill",
          conditions: [
            { field: "payee", value: "payee-water" },
            { field: "amount", value: -5067 },
          ],
        },
      ],
      recentTransactions: [],
    };
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(syncedMetadata);
    mockDb.batch.mockResolvedValueOnce([]);

    const out = await refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledWith("u1", {
      refresh: false,
      localOnly: true,
    });
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
    expect(out.allSchedules).toEqual([
      expect.objectContaining({
        name: "Water Bill",
        next_date: "2026-05-26",
      }),
    ]);
  });

  it("can force a fresh local Actual projection before rebuilding the bills mirror", async () => {
    const staleMetadata = {
      accounts: [],
      payees: [{ id: "payee-power", name: "SCE" }],
      payeeMap: { "payee-power": "SCE" },
      categories: [],
      schedules: [
        {
          id: "power",
          name: "SCE",
          next_date: "2026-05-18",
          type: "bill",
          conditions: [
            { field: "payee", value: "payee-power" },
            { field: "amount", value: -15075 },
          ],
        },
      ],
      recentTransactions: [],
    };
    const freshMetadata = {
      ...staleMetadata,
      recentTransactions: [
        {
          payeeId: "payee-power",
          amount: 150.75,
          date: "2026-05-18",
        },
      ],
    };
    mockActualLocal.readLocalActualMetadata.mockImplementation((_userId, options = {}) => (
      Promise.resolve(options.refresh ? freshMetadata : staleMetadata)
    ));
    mockDb.batch.mockResolvedValueOnce([]);

    const out = await refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      refreshLocalActual: true,
      now: new Date("2026-05-18T20:00:00.000Z"),
    });

    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledTimes(1);
    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledWith("u1", {
      refresh: true,
    });
    expect(out.allSchedules).toEqual([
      expect.objectContaining({
        name: "SCE",
        paid: true,
        openActionDisabled: true,
      }),
    ]);
  });

  it("returns old mirror rows with degraded health when lightweight refresh fails without spawning the Actual worker", async () => {
    mockActualLocal.readLocalActualMetadata
      .mockRejectedValueOnce(new Error("Actual local file unavailable"))
      .mockRejectedValueOnce(new Error("Actual download timed out"));
    mockDb.execute
      .mockResolvedValueOnce(rowResult())
      .mockResolvedValueOnce(rowResult([
        {
          status: "degraded",
          actual_configured: 1,
          actual_budget_url: "https://actual.example.test",
          last_success_at: "2026-05-05T12:00:00.000Z",
          last_attempt_at: "2026-05-06T12:00:00.000Z",
          last_error: "Actual download timed out",
          pending_refresh_at: null,
          refresh_started_at: null,
        },
      ]))
      .mockResolvedValueOnce(rowResult([
        {
          occurrence_id: "sched-1:2026-05-10",
          schedule_id: "sched-1",
          occurrence_date: "2026-05-10",
          name: "Mortgage",
          payee: "Mortgage Co",
          amount: 1500,
          type: "bill",
          paid: 0,
          open_action_disabled: 0,
        },
      ]));

    const out = await refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockActual.getCalendarBillsRange).not.toHaveBeenCalled();
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenNthCalledWith(1, "u1", {
      refresh: false,
      localOnly: true,
    });
    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenNthCalledWith(2, "u1", { refresh: true });
    expect(mockDb.batch).not.toHaveBeenCalled();
    expect(mockDb.execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringMatching(/ea_bills_mirror_state/i),
    }));
    expect(out.billsSyncHealth).toMatchObject({
      state: "degraded",
      lastError: "Actual download timed out",
    });
    expect(out.allSchedules).toEqual([
      expect.objectContaining({
        id: "sched-1:2026-05-10",
        payee: "Mortgage Co",
      }),
    ]);
  });

  it("coalesces concurrent mirror refreshes for the same user", async () => {
    const actualMetadata = {
      accounts: [],
      payees: [{ id: "payee-1", name: "Mortgage Co" }],
      payeeMap: { "payee-1": "Mortgage Co" },
      categories: [],
      schedules: [
        {
          id: "sched-1",
          name: "Mortgage",
          next_date: "2026-05-10",
          type: "bill",
          conditions: [
            { field: "payee", value: "payee-1" },
            { field: "amount", value: -150000 },
          ],
        },
      ],
      recentTransactions: [],
    };
    let finishBatch;
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(actualMetadata);
    mockDb.batch.mockReturnValueOnce(new Promise((resolve) => {
      finishBatch = () => resolve([]);
    }));

    const first = refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });
    const second = refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });
    await Promise.resolve();

    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledTimes(1);
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
    finishBatch();

    const [firstOut, secondOut] = await Promise.all([first, second]);
    expect(firstOut.allSchedules).toEqual(secondOut.allSchedules);
    expect(mockDb.batch).toHaveBeenCalledTimes(1);
  });

  it("schedules and consumes server-owned delayed refreshes", async () => {
    // schedule reads existing pending_refresh_at (none) then upserts the new dueAt.
    mockDb.execute
      .mockResolvedValueOnce(rowResult([]))
      .mockResolvedValueOnce(rowResult());
    await scheduleBillsMirrorRefresh("u1", {
      delayMs: 60_000,
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockDb.execute).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(["2026-05-06T12:01:00.000Z"]),
    }));

    mockDb.execute.mockReset();
    // P3-39: consume is now a single conditional UPDATE; rowsAffected drives the claim.
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });
    const due = await consumeDueBillsMirrorRefresh("u1", {
      now: new Date("2026-05-06T12:01:01.000Z"),
    });

    expect(due).toBe(true);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(mockDb.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      sql: expect.stringMatching(/pending_refresh_at = NULL/i),
    }));
  });

  it("P3-39: claims a due refresh atomically so a second concurrent claim returns false", async () => {
    // The atomic claim is a single conditional UPDATE. The first writer clears
    // pending_refresh_at (rowsAffected: 1) and wins; the second sees nothing left to
    // clear (rowsAffected: 0) and must not dispatch a duplicate refresh.
    mockDb.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 });

    const now = new Date("2026-05-06T12:01:01.000Z");
    const [first, second] = await Promise.all([
      consumeDueBillsMirrorRefresh("u1", { now }),
      consumeDueBillsMirrorRefresh("u1", { now }),
    ]);

    expect([first, second].sort()).toEqual([false, true]);
    // No SELECT-then-UPDATE: each claim is exactly one conditional UPDATE.
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
    for (const call of mockDb.execute.mock.calls) {
      expect(call[0].sql).toMatch(/UPDATE ea_bills_mirror_state/i);
      expect(call[0].sql).toMatch(/pending_refresh_at IS NOT NULL/i);
    }
  });

  it("P3-37: arms to the earlier already-pending refresh instead of pushing it later", async () => {
    // A sooner refresh is already pending; scheduling a later one must keep the earlier
    // due time (the DB keeps it via earlier-wins) rather than re-arming to the new later one.
    mockDb.execute
      .mockResolvedValueOnce(rowResult([{ pending_refresh_at: "2026-05-06T12:00:30.000Z" }]))
      .mockResolvedValueOnce(rowResult());

    const out = await scheduleBillsMirrorRefresh("u1", {
      delayMs: 60_000,
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    // dueAt would be 12:01:00; the earlier pending 12:00:30 must win.
    expect(out.pendingRefreshAt).toBe("2026-05-06T12:00:30.000Z");
    __resetBillsMirrorRefreshTimersForTests();
  });

  it("P3-37: arms to the new due time when no earlier refresh is pending", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rowResult([]))
      .mockResolvedValueOnce(rowResult());

    const out = await scheduleBillsMirrorRefresh("u1", {
      delayMs: 60_000,
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(out.pendingRefreshAt).toBe("2026-05-06T12:01:00.000Z");
    __resetBillsMirrorRefreshTimersForTests();
  });

  it("P3-38: an empty Actual read does not wipe a non-empty bills mirror", async () => {
    // Lightweight read succeeds but returns no rows (transient empty). The prior mirror
    // already holds occurrence rows, so the destructive DELETE/replace must be skipped:
    // no batch runs, the state goes degraded, and the prior rows are returned.
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce({
      accounts: [],
      payees: [],
      categories: [],
      schedules: [],
      recentTransactions: [],
    });
    mockDb.execute
      // priorMirrorHasRows -> mirror already populated
      .mockResolvedValueOnce(rowResult([{ "1": 1 }]))
      // degraded state write (catch block)
      .mockResolvedValueOnce(rowResult())
      // readBillsMirrorRange: state row
      .mockResolvedValueOnce(rowResult([
        {
          status: "degraded",
          actual_configured: 1,
          actual_budget_url: "https://actual.example.test",
          last_success_at: "2026-05-05T12:00:00.000Z",
          last_attempt_at: "2026-05-06T12:00:00.000Z",
          last_error: null,
          pending_refresh_at: null,
          refresh_started_at: null,
        },
      ]))
      // readBillsMirrorRange: occurrence rows (the preserved prior mirror)
      .mockResolvedValueOnce(rowResult([
        {
          occurrence_id: "sched-1:2026-05-10",
          schedule_id: "sched-1",
          occurrence_date: "2026-05-10",
          name: "Mortgage",
          payee: "Mortgage Co",
          amount: 1500,
          type: "bill",
          paid: 0,
          open_action_disabled: 0,
        },
      ]));

    const out = await refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    // Destructive replace was skipped entirely.
    expect(mockDb.batch).not.toHaveBeenCalled();
    // A degraded state was written (catch-block INSERT with 'degraded' literal), not an
    // empty 'current'. No success-path UPDATE ... SET status = 'current' ran.
    const degradedWrite = mockDb.execute.mock.calls.find((call) =>
      /INSERT INTO ea_bills_mirror_state/i.test(call[0].sql) && /'degraded'/i.test(call[0].sql),
    );
    expect(degradedWrite).toBeTruthy();
    const currentWrite = mockDb.execute.mock.calls.find((call) =>
      /status = 'current'/i.test(call[0].sql),
    );
    expect(currentWrite).toBeFalsy();
    // Prior mirror rows survive and are returned.
    expect(out.allSchedules).toEqual([
      expect.objectContaining({ id: "sched-1:2026-05-10", payee: "Mortgage Co" }),
    ]);
    expect(out.billsSyncHealth).toMatchObject({ state: "degraded" });
  });

  it("P3-38: still wipes/replaces when an empty read meets an empty prior mirror", async () => {
    // No prior rows to protect: an empty read with an empty mirror is a legitimately
    // empty budget and the normal replace path must run (batch, 'current').
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce({
      accounts: [],
      payees: [],
      categories: [],
      schedules: [],
      recentTransactions: [],
    });
    mockDb.execute.mockResolvedValueOnce(rowResult([])); // priorMirrorHasRows -> empty
    mockDb.batch.mockResolvedValueOnce([]);

    const out = await refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockDb.batch).toHaveBeenCalledTimes(1);
    expect(out.billsSyncHealth).toMatchObject({ state: "current" });
    expect(out.allSchedules).toEqual([]);
  });

  it("flags maintenance due only for old successful configured mirrors", () => {
    const now = new Date("2026-05-06T18:01:00.000Z");

    expect(isBillsMirrorMaintenanceDue({
      state: "current",
      configured: true,
      lastSuccessAt: "2026-05-06T12:00:00.000Z",
      pendingRefreshAt: null,
      refreshStartedAt: null,
    }, { now })).toBe(true);

    expect(isBillsMirrorMaintenanceDue({
      state: "current",
      configured: true,
      lastSuccessAt: "2026-05-06T12:02:00.000Z",
    }, { now })).toBe(false);

    expect(isBillsMirrorMaintenanceDue({
      state: "needs_sync",
      configured: true,
      lastSuccessAt: "2026-05-06T11:00:00.000Z",
    }, { now })).toBe(false);
  });

  it("backs off degraded mirror maintenance after a recent failed attempt", () => {
    const now = new Date("2026-05-06T18:01:00.000Z");

    expect(isBillsMirrorMaintenanceDue({
      state: "degraded",
      configured: true,
      lastSuccessAt: "2026-05-06T12:00:00.000Z",
      lastAttemptAt: "2026-05-06T17:55:00.000Z",
    }, { now })).toBe(false);
  });

  describe("stopBillsMirrorRefreshWorker", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockDb.execute.mockResolvedValue(rowResult([]));
    });

    afterEach(() => {
      stopBillsMirrorRefreshWorker();
      vi.useRealTimers();
    });

    it("prevents the interval worker from ticking again after stop", async () => {
      startBillsMirrorRefreshWorker({ intervalMs: 1000 });
      // Startup check call.
      await vi.advanceTimersByTimeAsync(0);
      mockDb.execute.mockClear();

      stopBillsMirrorRefreshWorker();
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it("is safe to call twice", () => {
      startBillsMirrorRefreshWorker({ intervalMs: 1000 });
      stopBillsMirrorRefreshWorker();
      expect(() => stopBillsMirrorRefreshWorker()).not.toThrow();
    });

    it("allows a fresh start after stop", async () => {
      startBillsMirrorRefreshWorker({ intervalMs: 1000 });
      stopBillsMirrorRefreshWorker();

      const result = startBillsMirrorRefreshWorker({ intervalMs: 1000 });
      expect(result).toEqual({ started: true });
    });
  });
});
