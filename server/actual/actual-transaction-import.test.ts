import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  loadBudget: vi.fn().mockResolvedValue(undefined),
  shutdown: vi.fn().mockResolvedValue(undefined),
  sync: vi.fn().mockResolvedValue(undefined),
  importTransactions: vi.fn(),
}));

vi.mock("@actual-app/api", () => ({ default: api }));
vi.mock("./actual-local-metadata.ts", () => ({
  actualDataDir: vi.fn(() => "/actual-data"),
  findLocalBudgetDir: vi.fn().mockResolvedValue({
    budgetDir: "/actual-data/Budget-1",
    metadata: { id: "Budget-1" },
  }),
  hydrateLocalActualCache: vi.fn(),
  pruneActualBudgetBackups: vi.fn().mockResolvedValue({ removed: 0, kept: 0 }),
}));
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: vi.fn().mockResolvedValue({
      rows: [{ actual_budget_url: "http://actual.test", actual_budget_sync_id: "sync-1", actual_budget_password_encrypted: null }],
    }),
  },
}));
vi.mock("../platform/encryption.ts", () => ({ decrypt: vi.fn((value) => value) }));

const groups = [
  {
    accountId: "account-1",
    transactions: [
      { itemId: "new", importedId: "amazon-111", date: "2026-04-16", amountCents: -1234, payee: "Amazon", notes: "Order 111" },
      { itemId: "existing", importedId: "paypal-existing", date: "2026-04-17", amountCents: -500, payee: "PayPal", notes: "Payment" },
    ],
  },
  {
    accountId: "account-2",
    transactions: [
      { itemId: "update", importedId: "amazon-update", date: "2026-04-18", amountCents: -999, payee: "Amazon", notes: "Order update" },
    ],
  },
];

function reconciliation(_accountId: string, transactions: Array<{ imported_id: string }>) {
  return Promise.resolve({
    added: [],
    updated: [],
    errors: [],
    updatedPreview: transactions.map((transaction) => ({
      transaction,
      ...(transaction.imported_id.includes("existing") ? { existing: transaction, ignored: true } : {}),
      ...(transaction.imported_id.includes("update") ? { existing: { ...transaction, amount: -1 } } : {}),
    })),
  });
}

describe("Actual grouped transaction import", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    api.importTransactions.mockImplementation(reconciliation);
  });

  it("dry-runs grouped imports without syncing and preserves imported IDs", async () => {
    const { importTransactionGroups } = await import("./actual-core.ts");
    const result = await importTransactionGroups("owner-1", groups, true);

    expect(api.importTransactions).toHaveBeenCalledTimes(2);
    expect(api.importTransactions).toHaveBeenNthCalledWith(
      1,
      "account-1",
      expect.arrayContaining([expect.objectContaining({ imported_id: "amazon-111", account: "account-1", amount: -1234 })]),
      { dryRun: true },
    );
    expect(api.sync).not.toHaveBeenCalled();
    expect(result.groups.flatMap((group) => group.items)).toEqual([
      expect.objectContaining({ itemId: "new", outcome: "would_add" }),
      expect.objectContaining({ itemId: "existing", outcome: "already_present" }),
      expect.objectContaining({ itemId: "update", outcome: "would_update" }),
    ]);
  });

  it("treats transactions returned only in Actual's added list as new", async () => {
    api.importTransactions.mockResolvedValueOnce({
      errors: [],
      added: ["generated-transaction-id"],
      updated: [],
      updatedPreview: [],
    });
    const { importTransactionGroups } = await import("./actual-core.ts");

    const result = await importTransactionGroups("owner-1", [{
      accountId: "account-1",
      transactions: [groups[0]!.transactions[0]!],
    }], true);

    expect(result.groups[0]!.items[0]).toMatchObject({
      itemId: "new",
      outcome: "would_add",
    });
  });

  it("imports every account group and syncs exactly once after all groups succeed", async () => {
    const { importTransactionGroups } = await import("./actual-core.ts");
    const result = await importTransactionGroups("owner-1", groups, false);

    expect(api.importTransactions).toHaveBeenCalledTimes(2);
    expect(api.sync).toHaveBeenCalledTimes(1);
    expect(result.groups.flatMap((group) => group.items)).toEqual([
      expect.objectContaining({ itemId: "new", outcome: "added" }),
      expect.objectContaining({ itemId: "existing", outcome: "already_present" }),
      expect.objectContaining({ itemId: "update", outcome: "updated" }),
    ]);
  });

  it("distinguishes a post-import sync failure from an import rejection", async () => {
    api.sync.mockRejectedValueOnce(new Error("out-of-sync"));
    const { importTransactionGroups } = await import("./actual-core.ts");

    await expect(importTransactionGroups("owner-1", groups, false)).rejects.toMatchObject({
      code: "ACTUAL_IMPORT_SYNC_UNCERTAIN",
      message: expect.stringContaining("out-of-sync"),
    });
  });

  it("rejects invalid imported transactions before calling Actual", async () => {
    const { importTransactionGroups } = await import("./actual-core.ts");
    await expect(importTransactionGroups("owner-1", [{
      accountId: "account-1",
      transactions: [{ itemId: "bad", importedId: "", date: "2026-04-16", amountCents: -1, payee: "Amazon", notes: "" }],
    }], false)).rejects.toMatchObject({ status: 400 });
    expect(api.importTransactions).not.toHaveBeenCalled();
    expect(api.sync).not.toHaveBeenCalled();
  });

  it("surfaces an actionable incompatibility without package mutation", async () => {
    const { importTransactionGroups } = await import("./actual-core.ts");
    api.importTransactions.mockRejectedValueOnce(new TypeError("sdk.importTransactions is not a function"));
    await expect(importTransactionGroups("owner-1", groups, false)).rejects.toMatchObject({
      status: 503,
      code: "ACTUAL_IMPORT_INCOMPATIBLE",
    });
    expect(api.sync).not.toHaveBeenCalled();
  });
});
