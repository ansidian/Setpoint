import { describe, it, expect, vi, beforeEach } from "vitest";

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
} = await import("./bills-mirror-sync.js");

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
    const occurrenceQuery = mockDb.execute.mock.calls[1][0];
    expect(occurrenceQuery.args).toEqual(expect.arrayContaining([
      "u1",
      expect.stringMatching(/^2026-04-/),
      expect.stringMatching(/^2026-08-/),
    ]));
  });

  it("full-replaces schedule and occurrence mirror rows on successful refresh", async () => {
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
    expect(mockDb.batch.mock.calls[0][0].map((entry) => entry.sql)).toEqual([
      expect.stringMatching(/INSERT INTO ea_bills_mirror_state/i),
      expect.stringMatching(/DELETE FROM ea_bill_occurrence_mirror/i),
      expect.stringMatching(/DELETE FROM ea_bill_schedule_mirror/i),
      expect.stringMatching(/INSERT INTO ea_actual_metadata_mirror/i),
      expect.stringMatching(/INSERT INTO ea_bill_schedule_mirror/i),
      expect.stringMatching(/INSERT INTO ea_bill_occurrence_mirror/i),
      expect.stringMatching(/UPDATE ea_bills_mirror_state/i),
    ]);
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
    mockDb.execute.mockResolvedValueOnce(rowResult());
    await scheduleBillsMirrorRefresh("u1", {
      delayMs: 60_000,
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockDb.execute).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(["2026-05-06T12:01:00.000Z"]),
    }));

    mockDb.execute.mockReset();
    mockDb.execute
      .mockResolvedValueOnce(rowResult([{ pending_refresh_at: "2026-05-06T12:01:00.000Z" }]))
      .mockResolvedValueOnce(rowResult());
    const due = await consumeDueBillsMirrorRefresh("u1", {
      now: new Date("2026-05-06T12:01:01.000Z"),
    });

    expect(due).toBe(true);
    expect(mockDb.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      sql: expect.stringMatching(/pending_refresh_at = NULL/i),
    }));
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
});
