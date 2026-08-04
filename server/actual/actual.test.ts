import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ActualAccount,
  ActualCategoryGroup,
  ActualPayee,
  ActualSchedule,
  ActualScheduleCondition,
} from "../../shared/types/actual.ts";

interface MockSchedule extends ActualSchedule { rule?: string }
interface MockRule { id: string; conditions: ActualScheduleCondition[] }
interface MockTransaction { accountId?: string; id?: string; date?: string; amount?: number; payee?: string | null; payee_name?: string; schedule?: string | null; notes?: string; cleared?: boolean; category?: string }
interface ActualApiState {
  accounts: ActualAccount[];
  payees: ActualPayee[];
  categoryGroups: ActualCategoryGroup[];
  budgets: Array<{ groupId: string }>;
  schedules: MockSchedule[];
  rules: MockRule[];
  transactions: MockTransaction[];
  reset(): void;
}
interface MockQuery {
  table: string;
  fields?: string[];
  filter(value?: unknown): MockQuery;
  select(fields: string[]): MockQuery;
}
interface MockActualApi {
  init: ReturnType<typeof vi.fn>;
  loadBudget: ReturnType<typeof vi.fn>;
  downloadBudget: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  sync: ReturnType<typeof vi.fn>;
  getAccounts: ReturnType<typeof vi.fn>;
  getPayees: ReturnType<typeof vi.fn>;
  getCategoryGroups: ReturnType<typeof vi.fn>;
  getBudgets: ReturnType<typeof vi.fn>;
  getRules: ReturnType<typeof vi.fn>;
  addTransactions: ReturnType<typeof vi.fn>;
  createSchedule: ReturnType<typeof vi.fn>;
  internal: { send: ReturnType<typeof vi.fn> };
  __state: ActualApiState;
  __getTransactions(): MockTransaction[];
}

async function importActualApiMock(): Promise<MockActualApi> {
  return (await import("@actual-app/api")).default as unknown as MockActualApi;
}

function holdFirstCall(mock: ReturnType<typeof vi.fn>) {
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  mock.mockImplementationOnce(() => new Promise<void>((resolve) => {
    release = resolve;
    markStarted();
  }));
  return { started, release: () => release() };
}

const actualApiState = vi.hoisted<ActualApiState>(() => ({
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

const actualLocalMock = vi.hoisted(() => ({
  actualDataDir: vi.fn(() => process.cwd()),
  findLocalBudgetDir: vi.fn().mockResolvedValue(null),
  hydrateLocalActualCache: vi.fn().mockResolvedValue({
    success: true,
    hydrated: true,
    budgetId: "Budget-Hydrated",
    budgetDir: "/var/ea-actual/Budget-Hydrated",
  }),
  pruneActualBudgetBackups: vi.fn().mockResolvedValue({ removed: 0, kept: 0 }),
  readLocalActualMetadata: vi.fn(),
}));

vi.mock("@actual-app/api", () => {
  function createQuery(table: string): MockQuery {
    return {
      table,
      filter: vi.fn(function filter(this: MockQuery) {
        return this;
      }),
      select: vi.fn(function select(this: MockQuery, fields: string[]) {
        this.fields = fields;
        return this;
      }),
    };
  }

  const actualApi = {
    init: vi.fn().mockResolvedValue(undefined),
    loadBudget: vi.fn().mockResolvedValue(undefined),
    downloadBudget: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    getAccounts: vi.fn().mockImplementation(async () => actualApiState.accounts),
    getPayees: vi.fn().mockImplementation(async () => actualApiState.payees),
    getCategoryGroups: vi.fn().mockImplementation(async () => actualApiState.categoryGroups),
    getBudgets: vi.fn().mockImplementation(async () => actualApiState.budgets),
    getRules: vi.fn().mockImplementation(async () => actualApiState.rules),
    addTransactions: vi.fn().mockImplementation(async (accountId: string, transactions: MockTransaction[]) => {
      actualApiState.transactions.push(...transactions.map((txn) => ({ accountId, ...txn })));
    }),
    q: vi.fn(createQuery),
    runQuery: vi.fn().mockImplementation(async (query: MockQuery) => {
      if (query.table === "transactions") return { data: actualApiState.transactions };
      if (query.table === "schedules") return { data: actualApiState.schedules };
      return { data: [] };
    }),
    createPayee: vi.fn(async ({ name }: { name: string }) => {
      const id = `payee-${actualApiState.payees.length + 1}`;
      actualApiState.payees.push({ id, name, transfer_acct: null });
      return id;
    }),
    createSchedule: vi.fn(async ({ name, date }: { name: string; date: string }) => {
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

// test-architecture: allow-boundary-mock -- The local Actual cache is the filesystem/download boundary; SDK adapter cases inject cache discovery and bounded hydration outcomes.
vi.mock("./actual-local-metadata.ts", () => actualLocalMock);

// test-architecture: allow-boundary-mock -- The shared database is the production configuration boundary; these SDK adapter cases supply one fixed owner connection while persistence is owned by migrated DB suites.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: vi.fn().mockResolvedValue({
      rows: [{ actual_budget_url: "http://localhost", actual_budget_password_encrypted: null, actual_budget_sync_id: "sync-123" }],
    }),
  },
}));

describe("actual-core mutex (withLock)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    actualApiState.reset();
    actualLocalMock.actualDataDir.mockReturnValue(process.cwd());
    actualLocalMock.findLocalBudgetDir.mockResolvedValue(null);
    actualLocalMock.pruneActualBudgetBackups.mockResolvedValue({ removed: 0, kept: 0 });
  });

  it("two concurrent calls execute sequentially (second starts after first finishes)", async () => {
    const { testConnection } = await import("./actual-core.ts");
    const actualApi = await importActualApiMock();

    const firstInit = holdFirstCall(actualApi.init);

    const p1 = testConnection("user1");
    const p2 = testConnection("user1");

    await firstInit.started;
    // test-architecture: allow-boundary-interaction -- SDK init is the outbound Actual session boundary; only one concurrent operation may enter it before release.
    expect(actualApi.init).toHaveBeenCalledTimes(1);
    firstInit.release();
    await Promise.all([p1, p2]);

    // test-architecture: allow-boundary-interaction -- SDK init is the outbound Actual session boundary; releasing the mutex must admit the queued operation exactly once.
    expect(actualApi.init).toHaveBeenCalledTimes(2);
  });

  it("a rejected call does not block the next caller", async () => {
    const { getMetadata } = await import("./actual.ts");
    const actualApi = await importActualApiMock();

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
    await expect(p2).resolves.toBeDefined();
  });
});

describe("actual.ts metadata cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    actualApiState.reset();
  });

  it("maps Actual accounts, payees, categories, schedules, and recent transactions", async () => {
    const { getMetadata } = await import("./actual.ts");
    const actualApi = await importActualApiMock();
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

  it("getMetadata returns cached data on second call within TTL", async () => {
    const { getMetadata } = await import("./actual.ts");
    const actualApi = await importActualApiMock();

    const first = await getMetadata("user1");
    actualApi.__state.accounts = [{ id: "changed", name: "Changed", type: "checking", closed: false }];
    const second = await getMetadata("user1");

    expect(second).toEqual(first);
  });

  it("getMetadata re-fetches after TTL expires while reusing the loaded budget session", async () => {
    const { getMetadata } = await import("./actual.ts");
    const actualApi = await importActualApiMock();

    const baseTime = Date.now();
    const dateSpy = vi.spyOn(Date, "now");

    dateSpy.mockReturnValue(baseTime);
    await getMetadata("user1");
    actualApi.__state.accounts = [{ id: "changed", name: "Changed", type: "checking", closed: false }];

    dateSpy.mockReturnValue(baseTime + 6 * 60 * 1000);
    const refreshed = await getMetadata("user1");

    // test-architecture: allow-boundary-interaction -- SDK init is the outbound session boundary; a TTL data refresh must reuse the already loaded budget session.
    expect(actualApi.init).toHaveBeenCalledTimes(1);
    expect(refreshed.accounts).toEqual([{ id: "changed", name: "Changed", type: "checking" }]);

    dateSpy.mockRestore();
  });

  it("force refresh bypasses the metadata cache and reloads the budget session", async () => {
    const { getMetadata } = await import("./actual.ts");
    const actualApi = await importActualApiMock();

    await getMetadata("user1");
    actualApi.__state.accounts = [{ id: "changed", name: "Changed", type: "checking", closed: false }];
    const refreshed = await getMetadata("user1", { forceRefresh: true });

    // test-architecture: allow-boundary-interaction -- SDK shutdown is the outbound session boundary; force refresh must close the prior singleton session.
    expect(actualApi.shutdown).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- SDK init is the outbound session boundary; force refresh must establish one replacement session.
    expect(actualApi.init).toHaveBeenCalledTimes(2);
    expect(refreshed.accounts).toEqual([{ id: "changed", name: "Changed", type: "checking" }]);
  });

  it("prunes local backups only once across successive successful operations", async () => {
    actualLocalMock.actualDataDir.mockReturnValue("/var/ea-actual");
    actualLocalMock.findLocalBudgetDir.mockResolvedValue({
      budgetDir: "/var/ea-actual/Budget-Local",
      metadata: { id: "Budget-Local", groupId: "sync-123", cloudFileId: "file-1" },
    });
    const { getMetadata } = await import("./actual-core.ts");

    await getMetadata("user1");
    await getMetadata("user1", { forceRefresh: true });

    // test-architecture: allow-boundary-interaction -- Backup pruning is a filesystem boundary effect; the interval contract is that successive operations perform one sweep.
    expect(actualLocalMock.pruneActualBudgetBackups).toHaveBeenCalledTimes(1);
  });
});

describe("actual.ts sendBill mutex", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    actualApiState.reset();
    actualLocalMock.actualDataDir.mockReturnValue(process.cwd());
    actualLocalMock.findLocalBudgetDir.mockResolvedValue(null);
    actualLocalMock.pruneActualBudgetBackups.mockResolvedValue({ removed: 0, kept: 0 });
  });

  it("loads a cached local Actual budget for bill pay writes instead of downloading cold", async () => {
    actualLocalMock.actualDataDir.mockReturnValue("/var/ea-actual");
    actualLocalMock.findLocalBudgetDir.mockResolvedValueOnce({
      budgetDir: "/var/ea-actual/Budget-Local",
      metadata: { id: "Budget-Local", groupId: "sync-123", cloudFileId: "file-1" },
    });
    const { sendBill } = await import("./actual-core.ts");
    const actualApi = await importActualApiMock();

    await sendBill({
      type: "expense",
      payee: "U.S. Bank",
      amount: 42.25,
      due_date: "2026-05-10",
      account_id: "a1",
    }, "user1");

    // test-architecture: allow-boundary-interaction -- SDK init is the outbound Actual boundary; server URL and local data directory are its compatibility contract.
    expect(actualApi.init).toHaveBeenCalledWith(expect.objectContaining({
      serverURL: "http://localhost",
      dataDir: "/var/ea-actual",
    }));
    // test-architecture: allow-boundary-interaction -- SDK loadBudget is the outbound Actual boundary; the discovered local budget ID must be selected.
    expect(actualApi.loadBudget).toHaveBeenCalledWith("Budget-Local");
    // test-architecture: allow-boundary-interaction -- SDK download is an outbound archive effect; a discovered local cache must never trigger it.
    expect(actualApi.downloadBudget).not.toHaveBeenCalled();
    expect(actualApi.__getTransactions()).toHaveLength(1);
    // test-architecture: allow-boundary-interaction -- Backup pruning is a filesystem boundary effect tied to the budget directory used by the successful operation.
    expect(actualLocalMock.pruneActualBudgetBackups).toHaveBeenCalledWith("/var/ea-actual/Budget-Local");
  });

  it("hydrates a missing development cache through the bounded downloader instead of the SDK archive path", async () => {
    actualLocalMock.actualDataDir.mockReturnValue("/var/ea-actual");
    const { sendBill } = await import("./actual-core.ts");
    const actualApi = await importActualApiMock();

    await sendBill({ type: "expense", payee: "U.S. Bank", amount: 42.25, due_date: "2026-05-10", account_id: "a1" }, "user1");

    // test-architecture: allow-boundary-interaction -- Bounded cache hydration is the filesystem/remote-download boundary; missing development caches must use the guarded downloader.
    expect(actualLocalMock.hydrateLocalActualCache).toHaveBeenCalledWith("user1", {
      dataDir: "/var/ea-actual",
      forceDownload: true,
    });
    // test-architecture: allow-boundary-interaction -- SDK loadBudget is the outbound Actual boundary; the bounded downloader's hydrated budget ID must be loaded.
    expect(actualApi.loadBudget).toHaveBeenCalledWith("Budget-Hydrated");
    // test-architecture: allow-boundary-interaction -- SDK download is an outbound archive effect; hydration must not fall through to the SDK downloader.
    expect(actualApi.downloadBudget).not.toHaveBeenCalled();
    // test-architecture: allow-boundary-interaction -- Backup pruning is a filesystem boundary effect tied to the hydrated budget directory.
    expect(actualLocalMock.pruneActualBudgetBackups).toHaveBeenCalledWith("/var/ea-actual/Budget-Hydrated");
  });

  it("refuses a production bill pay write when the local Actual cache is missing", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      actualLocalMock.findLocalBudgetDir.mockResolvedValueOnce(null);
      const { sendBill } = await import("./actual-core.ts");
      const actualApi = await importActualApiMock();

      await expect(sendBill({
        type: "expense",
        payee: "U.S. Bank",
        amount: 42.25,
        due_date: "2026-05-10",
        account_id: "a1",
      }, "user1")).rejects.toMatchObject({
        status: 503,
        code: "ACTUAL_LOCAL_BUDGET_REQUIRED",
      });

      // test-architecture: allow-boundary-interaction -- SDK download is an outbound archive effect; production must fail closed instead of cold-downloading a missing cache.
      expect(actualApi.downloadBudget).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("sendBill reuses the loaded budget after getMetadata", async () => {
    const { getMetadata, sendBill } = await import("./actual.ts");
    const actualApi = await importActualApiMock();

    const firstInit = holdFirstCall(actualApi.init);

    const billData = {
      type: "expense",
      payee: "Test Payee",
      amount: 10,
      due_date: "2020-01-01", // past date triggers addTransactions path
      account_id: "a1",
    };

    const p1 = getMetadata("user1");
    const p2 = sendBill(billData, "user1");

    await firstInit.started;
    firstInit.release();
    await Promise.all([p1, p2]);

    // test-architecture: allow-boundary-interaction -- SDK init is the outbound singleton-session boundary; metadata and the queued write must share one loaded session.
    expect(actualApi.init).toHaveBeenCalledTimes(1);
    expect(actualApi.__getTransactions()).toHaveLength(1);
  });

  it("does not reuse a same-named bill schedule for a transfer", async () => {
    actualApiState.schedules = [
      { id: "sched-bill", name: "Visa", rule: "rule-1", next_date: "2026-08-01", completed: false },
    ];
    actualApiState.rules = [
      { id: "rule-1", conditions: [{ op: "is", field: "amount", value: -50000 }] },
    ];
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", {
      timeZone: "America/Los_Angeles",
    });
    const { sendBill } = await import("./actual-core.ts");
    const actualApi = await importActualApiMock();

    await sendBill({
      type: "transfer",
      payee: "",
      schedule_name: "Visa",
      amount: 500,
      due_date: tomorrow,
      from_account_id: "a2",
      to_account_id: "a1",
    }, "user1");

    // test-architecture: allow-boundary-interaction -- createSchedule is an outbound financial-write boundary; a cross-type name collision must create the transfer schedule with the signed amount.
    expect(actualApi.createSchedule).toHaveBeenCalledWith({
      name: "Visa",
      date: tomorrow,
      amount: 50000,
    });
    // test-architecture: allow-boundary-interaction -- internal.send is the outbound Actual mutation boundary; a transfer must never clobber the same-named bill schedule.
    expect(actualApi.internal.send).not.toHaveBeenCalledWith(
      "schedule/update",
      expect.objectContaining({ schedule: expect.objectContaining({ id: "sched-bill" }) }),
    );
  });
});

describe("actual-core testConnection mutex", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    actualApiState.reset();
  });

  it("testConnection acquires the mutex (init not called concurrently with getMetadata)", async () => {
    const { getMetadata, testConnection } = await import("./actual-core.ts");
    const actualApi = await importActualApiMock();

    const firstInit = holdFirstCall(actualApi.init);

    const p1 = getMetadata("user1");
    const p2 = testConnection("user1");

    await firstInit.started;
    // test-architecture: allow-boundary-interaction -- SDK init is the outbound Actual session boundary; the connection check cannot enter while metadata holds the mutex.
    expect(actualApi.init).toHaveBeenCalledTimes(1);
    firstInit.release();
    await Promise.all([p1, p2]);

    // test-architecture: allow-boundary-interaction -- SDK init is the outbound Actual session boundary; releasing metadata admits exactly the queued connection check.
    expect(actualApi.init).toHaveBeenCalledTimes(2);
  });
});
describe("actual.ts createQuickTxn", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    actualApiState.reset();
  });

  it("resolves account name case-insensitively and posts a negative-signed payment", async () => {
    const { createQuickTxn } = await import("./actual.ts");
    const actualApi = await importActualApiMock();

    const result = await createQuickTxn("user1", {
      accountName: "checking", // lowercase — mock has "Checking"
      amount: 12.34,
      payee: "Starbucks",
      type: "payment",
      date: "2026-04-16",
    });

    const [txn] = actualApi.__getTransactions();
    expect(actualApi.__getTransactions()).toHaveLength(1);
    expect(txn!.accountId).toBe("a1");
    expect(txn!.amount).toBe(-1234);
    expect(txn!.payee_name).toBe("Starbucks");
    expect(txn!.date).toBe("2026-04-16");
    expect(txn!.cleared).toBe(false);
    expect(txn!.category).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.account).toBe("Checking");
  });

  it("flips sign for type=deposit", async () => {
    const { createQuickTxn } = await import("./actual.ts");
    const actualApi = await importActualApiMock();

    await createQuickTxn("user1", {
      accountName: "Checking",
      amount: 50,
      payee: "Refund",
      type: "deposit",
      date: "2026-04-16",
    });

    const [txn] = actualApi.__getTransactions();
    expect(txn!.amount).toBe(5000);
  });

  it("throws with status 404 for unknown account name", async () => {
    const { createQuickTxn } = await import("./actual.ts");
    const actualApi = await importActualApiMock();

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
    const { createQuickTxn } = await import("./actual.ts");
    const actualApi = await importActualApiMock();

    await createQuickTxn("user1", {
      accountName: "Checking",
      amount: 100,
      payee: "Landlord",
      categoryName: "rent", // lowercase — mock has "Rent"
      date: "2026-04-16",
    });

    const [txn] = actualApi.__getTransactions();
    expect(txn!.category).toBe("c1");
  });

  it("reuses the loaded budget after getMetadata", async () => {
    const { getMetadata, createQuickTxn } = await import("./actual.ts");
    const actualApi = await importActualApiMock();

    const firstInit = holdFirstCall(actualApi.init);

    const p1 = getMetadata("user1");
    const p2 = createQuickTxn("user1", {
      accountName: "Checking",
      amount: 1,
      payee: "X",
      date: "2026-04-16",
    });

    await firstInit.started;
    firstInit.release();
    await Promise.all([p1, p2]);

    // test-architecture: allow-boundary-interaction -- SDK init is the outbound singleton-session boundary; metadata and quick transaction must share one loaded session.
    expect(actualApi.init).toHaveBeenCalledTimes(1);
    expect(actualApi.__getTransactions()).toHaveLength(1);
  });
});
