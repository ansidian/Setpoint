import { describe, it, expect, vi, beforeEach } from "vitest";

const actualApiState = vi.hoisted(() => ({
  accounts: [],
  payees: [],
  categoryGroups: [],
  budgets: [],
  schedules: [],
  rules: [],
  transactions: [],
  reset() {
    this.accounts = [
      { id: "a1", name: "Checking", type: "checking", closed: false },
      { id: "a2", name: "Closed card", type: "credit", closed: true },
    ];
    this.payees = [
      { id: "p1", name: "Test Payee", transfer_acct: null },
      { id: "p2", name: "Visa Transfer", transfer_acct: "a2" },
    ];
    this.categoryGroups = [
      { name: "Bills", categories: [{ id: "c1", name: "Rent" }] },
      { name: "Internal", categories: [{ id: "internal", name: "Transfer" }] },
    ];
    this.budgets = [{ groupId: "sync-123" }];
    this.schedules = [];
    this.rules = [];
    this.transactions = [];
  },
}));
actualApiState.reset();

// vi.mock is hoisted — these factories run fresh after each vi.resetModules().
// The fake stores enough Actual state for tests to assert adapter outcomes
// without depending on Actual's query-builder call shape.
vi.mock("@actual-app/api", () => {
  function createQuery(table) {
    return {
      table,
      filter: vi.fn(function filter() {
        return this;
      }),
      select: vi.fn(function select(fields) {
        this.fields = fields;
        return this;
      }),
    };
  }

  const actualApi = {
    init: vi.fn().mockResolvedValue(undefined),
    downloadBudget: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    getAccounts: vi.fn().mockImplementation(async () => actualApiState.accounts),
    getPayees: vi.fn().mockImplementation(async () => actualApiState.payees),
    getCategoryGroups: vi.fn().mockImplementation(async () => actualApiState.categoryGroups),
    getBudgets: vi.fn().mockImplementation(async () => actualApiState.budgets),
    getRules: vi.fn().mockImplementation(async () => actualApiState.rules),
    addTransactions: vi.fn().mockImplementation(async (accountId, transactions) => {
      actualApiState.transactions.push(...transactions.map((txn) => ({ accountId, ...txn })));
    }),
    q: vi.fn(createQuery),
    runQuery: vi.fn().mockImplementation(async (query) => {
      if (query.table === "transactions") return { data: actualApiState.transactions };
      if (query.table === "schedules") return { data: actualApiState.schedules };
      return { data: [] };
    }),
    createPayee: vi.fn(async ({ name }) => {
      const id = `payee-${actualApiState.payees.length + 1}`;
      actualApiState.payees.push({ id, name, transfer_acct: null });
      return id;
    }),
    createSchedule: vi.fn(async ({ name, date }) => {
      const id = `schedule-${actualApiState.schedules.length + 1}`;
      actualApiState.schedules.push({ id, name, next_date: date, completed: false });
      return id;
    }),
    internal: {
      send: vi.fn().mockResolvedValue(undefined),
    },
    __state: actualApiState,
    __getTransactions: () => actualApiState.transactions,
    __resetState: () => actualApiState.reset(),
  };
  return { default: actualApi };
});

vi.mock("../db/connection.js", () => ({
  default: {
    execute: vi.fn().mockResolvedValue({
      rows: [{ actual_budget_url: "http://localhost", actual_budget_password_encrypted: null, actual_budget_sync_id: "sync-123" }],
    }),
  },
}));

vi.mock("./encryption.js", () => ({ decrypt: vi.fn((v) => v) }));

describe("actual.js mutex (withLock)", () => {
  beforeEach(() => {
    // Reset module registry so each test gets fresh lock + metadataCache state
    // Reset all mocks so call counts start from 0
    vi.resetModules();
    vi.clearAllMocks();
    actualApiState.reset();
  });

  it("two concurrent calls execute sequentially (second starts after first finishes)", async () => {
    // Use testConnection (no cache) so both calls always reach init
    const { testConnection } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    const order = [];
    let callCount = 0;
    actualApi.init.mockImplementation(async () => {
      const n = ++callCount;
      order.push(`init-${n}-start`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`init-${n}-end`);
    });

    // Launch two calls without awaiting the first — simulates concurrent access
    const p1 = testConnection("user1");
    const p2 = testConnection("user1");

    await Promise.all([p1, p2]);

    // Verify sequential: first call must complete before second starts
    expect(order.indexOf("init-1-end")).toBeLessThan(order.indexOf("init-2-start"));
  });

  it("a rejected call does not block the next caller", async () => {
    const { getMetadata } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    let callCount = 0;
    actualApi.init.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("connection failed");
      }
    });

    const p1 = getMetadata("user1");
    const p2 = getMetadata("user1");

    await expect(p1).rejects.toThrow("connection failed");
    // Second call gets a fresh init attempt (callCount===2, succeeds)
    await expect(p2).resolves.toBeDefined();
  });
});

describe("actual.js metadata cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    actualApiState.reset();
  });

  it("maps Actual accounts, payees, categories, schedules, and recent transactions", async () => {
    const { getMetadata } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;
    actualApi.__state.schedules = [
      { id: "s1", name: "Electricity", rule: "r1", next_date: "2026-05-10", completed: false },
      { id: "s2", name: "Paycheck", rule: "r2", next_date: "2026-05-15", completed: false },
      { id: "s3", name: "Completed transfer", rule: "r3", next_date: "2026-05-18", completed: true },
    ];
    actualApi.__state.rules = [
      { id: "r1", conditions: [{ field: "amount", value: -12234 }, { field: "payee", value: "p1" }] },
      { id: "r2", conditions: [{ field: "amount", value: 250000 }, { field: "payee", value: "p1" }] },
      { id: "r3", conditions: [{ field: "amount", value: 5000 }, { field: "payee", value: "p2" }] },
    ];
    actualApi.__state.transactions = [
      { id: "t1", date: "2026-05-11", amount: -12234, payee: "p1", schedule: "s1" },
      { id: "t2", date: "2026-05-12", amount: 0, payee: "p1", schedule: null },
      { id: "t3", date: "2026-05-13", amount: -1000, payee: null, schedule: null },
    ];

    const metadata = await getMetadata("user1");

    expect(metadata.accounts).toEqual([{ id: "a1", name: "Checking", type: "checking" }]);
    expect(metadata.payees).toEqual([{ id: "p1", name: "Test Payee" }]);
    expect(metadata.categories).toEqual([
      { group_name: "Bills", categories: [{ id: "c1", name: "Rent" }] },
    ]);
    expect(metadata.schedules).toEqual([
      expect.objectContaining({ id: "s1", type: "bill" }),
      expect.objectContaining({ id: "s2", type: "income" }),
    ]);
    expect(metadata.recentTransactions).toEqual([
      { payee: "Test Payee", payeeId: "p1", amount: 122.34, date: "2026-05-11", scheduleId: "s1" },
    ]);
  });

  it("getMetadata returns cached data on second call within TTL (init called once)", async () => {
    const { getMetadata } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    await getMetadata("user1");
    await getMetadata("user1");

    // init should only be called once — second call hit cache
    expect(actualApi.init).toHaveBeenCalledTimes(1);
  });

  it("getMetadata re-fetches after TTL expires (init called twice)", async () => {
    const { getMetadata } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    const baseTime = Date.now();
    const dateSpy = vi.spyOn(Date, "now");

    // First call at t=0
    dateSpy.mockReturnValue(baseTime);
    await getMetadata("user1");

    // Second call at t=6 minutes (past 5-min TTL)
    dateSpy.mockReturnValue(baseTime + 6 * 60 * 1000);
    await getMetadata("user1");

    expect(actualApi.init).toHaveBeenCalledTimes(2);

    dateSpy.mockRestore();
  });
});

describe("actual.js sendBill mutex", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    actualApiState.reset();
  });

  it("sendBill acquires the mutex (init not called concurrently with getMetadata)", async () => {
    const { getMetadata, sendBill } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    const order = [];
    let callCount = 0;
    actualApi.init.mockImplementation(async () => {
      const n = ++callCount;
      order.push(`init-${n}-start`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`init-${n}-end`);
    });

    const billData = {
      type: "expense",
      payee: "Test Payee",
      amount: 10,
      due_date: "2020-01-01", // past date triggers addTransactions path
      account_id: "a1",
    };

    const p1 = getMetadata("user1");
    const p2 = sendBill(billData, "user1");

    await Promise.all([p1, p2]);

    // Both inits sequential — mutex was acquired by each
    expect(order.indexOf("init-1-end")).toBeLessThan(order.indexOf("init-2-start"));
  });

  it("sends an explicit empty note for one-time bill pay transactions when notes are blank", async () => {
    const { sendBill } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    await sendBill({
      type: "expense",
      payee: "U.S. Bank",
      amount: 42.25,
      due_date: "2026-05-10",
      account_id: "a1",
      notes: "",
    }, "user1");

    const [txn] = actualApi.__getTransactions();
    expect(txn.notes).toBe("");
  });

  it("preserves user-entered notes for one-time bill pay transactions", async () => {
    const { sendBill } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    await sendBill({
      type: "expense",
      payee: "U.S. Bank",
      amount: 42.25,
      due_date: "2026-05-10",
      account_id: "a1",
      notes: "Autopay scheduled from checking",
    }, "user1");

    const [txn] = actualApi.__getTransactions();
    expect(txn.notes).toBe("Autopay scheduled from checking");
  });
});

describe("actual.js testConnection mutex", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    actualApiState.reset();
  });

  it("testConnection acquires the mutex (init not called concurrently with getMetadata)", async () => {
    const { getMetadata, testConnection } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    const order = [];
    let callCount = 0;
    actualApi.init.mockImplementation(async () => {
      const n = ++callCount;
      order.push(`init-${n}-start`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`init-${n}-end`);
    });

    const p1 = getMetadata("user1");
    const p2 = testConnection("user1");

    await Promise.all([p1, p2]);

    // Both inits sequential
    expect(order.indexOf("init-1-end")).toBeLessThan(order.indexOf("init-2-start"));
  });
});

describe("actual.js createQuickTxn", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    actualApiState.reset();
  });

  it("resolves account name case-insensitively and posts a negative-signed payment", async () => {
    const { createQuickTxn } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    const result = await createQuickTxn("user1", {
      accountName: "checking", // lowercase — mock has "Checking"
      amount: 12.34,
      payee: "Starbucks",
      type: "payment",
      date: "2026-04-16",
    });

    const [txn] = actualApi.__getTransactions();
    expect(actualApi.__getTransactions()).toHaveLength(1);
    expect(txn.accountId).toBe("a1");
    expect(txn.amount).toBe(-1234);
    expect(txn.payee_name).toBe("Starbucks");
    expect(txn.date).toBe("2026-04-16");
    expect(txn.cleared).toBe(false);
    expect(txn.category).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.account).toBe("Checking");
  });

  it("flips sign for type=deposit", async () => {
    const { createQuickTxn } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    await createQuickTxn("user1", {
      accountName: "Checking",
      amount: 50,
      payee: "Refund",
      type: "deposit",
      date: "2026-04-16",
    });

    const [txn] = actualApi.__getTransactions();
    expect(txn.amount).toBe(5000);
  });

  it("throws with status 404 for unknown account name", async () => {
    const { createQuickTxn } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    const err = await createQuickTxn("user1", {
      accountName: "Nonexistent",
      amount: 1,
      payee: "X",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
    expect(actualApi.__getTransactions()).toEqual([]);
  });

  it("resolves category name and attaches category id to transaction", async () => {
    const { createQuickTxn } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    await createQuickTxn("user1", {
      accountName: "Checking",
      amount: 100,
      payee: "Landlord",
      categoryName: "rent", // lowercase — mock has "Rent"
      date: "2026-04-16",
    });

    const [txn] = actualApi.__getTransactions();
    expect(txn.category).toBe("c1");
  });

  it("acquires the mutex (serializes against getMetadata)", async () => {
    const { getMetadata, createQuickTxn } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;

    const order = [];
    let callCount = 0;
    actualApi.init.mockImplementation(async () => {
      const n = ++callCount;
      order.push(`init-${n}-start`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`init-${n}-end`);
    });

    const p1 = getMetadata("user1");
    const p2 = createQuickTxn("user1", {
      accountName: "Checking",
      amount: 1,
      payee: "X",
      date: "2026-04-16",
    });

    await Promise.all([p1, p2]);

    expect(order.indexOf("init-1-end")).toBeLessThan(order.indexOf("init-2-start"));
  });
});

describe("actual.js calendar bill mapping", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("maps open bill and transfer schedules to composite due-date instances", async () => {
    const { __testing__ } = await import("./actual.js");
    const payeeMap = { p1: "SCE", p2: "Visa transfer" };
    const schedules = [
      {
        id: "s1",
        name: "Electricity",
        next_date: "2026-05-10",
        type: "bill",
        conditions: [
          { field: "amount", value: -12234 },
          { field: "payee", value: "p1" },
        ],
      },
      {
        id: "s2",
        name: "Credit card",
        next_date: "2026-05-12",
        type: "transfer",
        conditions: [
          { field: "amount", value: 25000 },
          { field: "payee", value: "p2" },
        ],
      },
      {
        id: "s3",
        name: "Paycheck",
        next_date: "2026-05-15",
        type: "income",
        conditions: [{ field: "amount", value: 100000 }],
      },
      {
        id: "s4",
        name: "Old transfer",
        next_date: "2026-05-18",
        completed: true,
        type: "transfer",
        conditions: [
          { field: "amount", value: 5000 },
          { field: "payee", value: "p2" },
        ],
      },
    ];

    expect(__testing__.mapOpenBillInstances(schedules, payeeMap, { start: "2026-05-01", end: "2026-05-31" }))
      .toEqual([
        expect.objectContaining({ id: "s1:2026-05-10", scheduleId: "s1", payee: "SCE", paid: false, type: "bill" }),
        expect.objectContaining({ id: "s2:2026-05-12", scheduleId: "s2", payee: "Visa transfer", paid: false, type: "transfer" }),
      ]);
  });

  it("marks calendar bill instances paid when Actual has a matching schedule transaction", async () => {
    const { getCalendarBillsRange } = await import("./actual.js");
    const actualApi = (await import("@actual-app/api")).default;
    actualApi.__state.payees = [
      { id: "p1", name: "SCE", transfer_acct: null },
    ];
    actualApi.__state.schedules = [
      { id: "s1", name: "Electricity", rule: "r1", next_date: "2026-05-10", completed: false },
    ];
    actualApi.__state.rules = [
      { id: "r1", conditions: [{ field: "amount", value: -12234 }, { field: "payee", value: "p1" }] },
    ];
    actualApi.__state.transactions = [
      { id: "t1", date: "2026-05-10", amount: -12234, payee: "p1", schedule: "s1" },
    ];

    const out = await getCalendarBillsRange("user1", { start: "2026-05-01", end: "2026-05-31" });

    expect(out.schedules).toEqual([
      expect.objectContaining({
        id: "s1:2026-05-10",
        scheduleId: "s1",
        paid: true,
        openActionDisabled: true,
      }),
    ]);
  });
});
