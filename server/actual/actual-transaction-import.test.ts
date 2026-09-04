import { beforeEach, describe, expect, it, vi } from "vitest";
import { runActualTransactionImport } from "./actualTransactionImportModel.ts";

const api = {
  sync: vi.fn().mockResolvedValue(undefined),
  importTransactions: vi.fn(),
};

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
    vi.clearAllMocks();
    api.importTransactions.mockImplementation(reconciliation);
    api.sync.mockResolvedValue(undefined);
  });

  it("dry-runs grouped imports without syncing and preserves imported IDs", async () => {
    const result = await runActualTransactionImport({ groups, dryRun: true, ...api });

    // test-architecture: allow-boundary-interaction -- importTransactions is the outbound Actual SDK boundary; imported IDs, account identity, cents, and dry-run mode are the compatibility contract.
    expect(api.importTransactions).toHaveBeenNthCalledWith(
      1,
      "account-1",
      expect.arrayContaining([expect.objectContaining({ imported_id: "amazon-111", account: "account-1", amount: -1234 })]),
      { dryRun: true },
    );
    // test-architecture: allow-boundary-interaction -- sync is the outbound financial-write boundary; a dry run must never push changes to Actual.
    expect(api.sync).not.toHaveBeenCalled();
    expect(result.groups.flatMap((group) => group.items)).toEqual([
      expect.objectContaining({ itemId: "new", outcome: "would_add" }),
      expect.objectContaining({ itemId: "existing", outcome: "already_present" }),
      expect.objectContaining({ itemId: "update", outcome: "would_update" }),
    ]);
  });

  it("preserves positive integer cents for income imports", async () => {
    const incomeGroups = [{
      accountId: "account-1",
      transactions: [{
        itemId: "refund",
        importedId: "financial-email:v1:refund",
        date: "2026-04-19",
        amountCents: 2599,
        payee: "Example Merchant",
        notes: "Refund",
      }],
    }];

    await runActualTransactionImport({ groups: incomeGroups, dryRun: true, ...api });

    // test-architecture: allow-boundary-interaction -- Actual import is the external financial boundary; signed cents are the public direction contract and must reach the SDK unchanged.
    expect(api.importTransactions).toHaveBeenCalledWith(
      "account-1",
      [expect.objectContaining({ imported_id: "financial-email:v1:refund", amount: 2599, cleared: false })],
      { dryRun: true },
    );
  });

  it("treats transactions returned only in Actual's added list as new", async () => {
    api.importTransactions.mockResolvedValueOnce({
      errors: [],
      added: ["generated-transaction-id"],
      updated: [],
      updatedPreview: [],
    });
    const result = await runActualTransactionImport({ groups: [{
      accountId: "account-1",
      transactions: [groups[0]!.transactions[0]!],
    }], dryRun: true, ...api });

    expect(result.groups[0]!.items[0]).toMatchObject({
      itemId: "new",
      outcome: "would_add",
    });
  });

  it("imports every account group and syncs exactly once after all groups succeed", async () => {
    const result = await runActualTransactionImport({ groups, dryRun: false, ...api });

    // test-architecture: allow-boundary-interaction -- importTransactions is the outbound Actual SDK boundary; each validated account group must produce one financial import effect.
    expect(api.importTransactions).toHaveBeenCalledTimes(2);
    // test-architecture: allow-boundary-interaction -- sync is the outbound Actual write boundary; successful multi-account import must push exactly once after all groups settle.
    expect(api.sync).toHaveBeenCalledTimes(1);
    expect(result.groups.flatMap((group) => group.items)).toEqual([
      expect.objectContaining({ itemId: "new", outcome: "added" }),
      expect.objectContaining({ itemId: "existing", outcome: "already_present" }),
      expect.objectContaining({ itemId: "update", outcome: "updated" }),
    ]);
  });

  it("distinguishes a post-import sync failure from an import rejection", async () => {
    api.sync.mockRejectedValueOnce(new Error("out-of-sync"));

    await expect(runActualTransactionImport({ groups, dryRun: false, ...api })).rejects.toMatchObject({
      code: "ACTUAL_IMPORT_SYNC_UNCERTAIN",
      message: expect.stringContaining("out-of-sync"),
    });
  });

  it("rejects invalid imported transactions before calling Actual", async () => {
    await expect(runActualTransactionImport({ groups: [{
      accountId: "account-1",
      transactions: [{ itemId: "bad", importedId: "", date: "2026-04-16", amountCents: -1, payee: "Amazon", notes: "" }],
    }], dryRun: false, ...api })).rejects.toMatchObject({ status: 400 });
    // test-architecture: allow-boundary-interaction -- importTransactions is the outbound financial-write boundary; invalid input must be rejected before any Actual mutation.
    expect(api.importTransactions).not.toHaveBeenCalled();
    // test-architecture: allow-boundary-interaction -- sync is the outbound financial-write boundary; invalid input must not push unrelated or partial state.
    expect(api.sync).not.toHaveBeenCalled();
  });

  it("surfaces an actionable incompatibility without package mutation", async () => {
    api.importTransactions.mockRejectedValueOnce(new TypeError("sdk.importTransactions is not a function"));
    await expect(runActualTransactionImport({ groups, dryRun: false, ...api })).rejects.toMatchObject({
      status: 503,
      code: "ACTUAL_IMPORT_INCOMPATIBLE",
    });
    // test-architecture: allow-boundary-interaction -- sync is the outbound financial-write boundary; an incompatible import adapter must fail without pushing partial state.
    expect(api.sync).not.toHaveBeenCalled();
  });
});
