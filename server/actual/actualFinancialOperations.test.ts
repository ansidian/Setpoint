import { describe, expect, it } from "vitest";
import type { ActualScheduleCondition } from "../../shared/types/actual.ts";
import type { ActualCompletedTransferInput, ActualFinancialTransactionInput, ActualUtilityScheduleInput } from "../../shared/types/financial-operations.ts";
import { reconcileActualFinancialOperation, type ActualFinancialSdk } from "./actualFinancialOperations.ts";

interface Transaction {
  id: string; account: string; payee: string; amount: number; date: string;
  imported_id: string | null; transfer_id: string | null; tombstone: boolean;
  category?: string;
}
interface Schedule {
  id: string; name: string; rule: string; next_date: string; completed: boolean;
  tombstone: boolean; posts_transaction: boolean; active: boolean;
}
interface Rule {
  id: string; conditions: ActualScheduleCondition[]; conditions_op: string;
  actions: Array<{ op: string; field?: string; value?: unknown }>; tombstone: boolean;
}
const now = new Date("2026-09-06T12:00:00Z");
const transfer: ActualCompletedTransferInput = {
  kind: "completed_transfer", identityKey: "event:payment:1", budgetId: "budget",
  fromAccountId: "checking", toAccountId: "card", amountCents: 12_345, date: "2026-09-05", notes: "Card payment",
};
const utility: ActualUtilityScheduleInput = {
  kind: "utility_schedule", identityKey: "event:utility:1", budgetId: "budget",
  accountId: "checking", payee: "Power Co", amountCents: -8_700, date: "2026-09-28", name: "Power Co",
};
const purchase: ActualFinancialTransactionInput = {
  kind: "transaction", identityKey: "financial-event:purchase:1", budgetId: "budget",
  accountId: "card", payee: "Example Shop", amountCents: -3_000, date: "2026-09-05", notes: "Receipt",
};

function fixture() {
  const transactions: Transaction[] = [];
  const schedules: Schedule[] = [];
  const rules: Rule[] = [];
  const accounts = [
    { id: "checking", name: "Checking", type: "checking", closed: false },
    { id: "card", name: "Card", type: "credit", closed: false },
  ];
  const payees = [
    { id: "to-card", name: "Transfer: Card", transfer_acct: "card" },
    { id: "to-checking", name: "Transfer: Checking", transfer_acct: "checking" },
  ];
  let partialTransfer = false;
  let failedSyncPending = false;
  let failSyncAfterWrite = false;
  let unavailableCategoryMetadata = false;
  const sdk: ActualFinancialSdk = {
    sync: async () => {
      if (failedSyncPending) {
        failedSyncPending = false;
        throw new Error("sync unavailable after write");
      }
    },
    getAccounts: async () => accounts,
    getPayees: async () => payees,
    createPayee: async ({ name }) => {
      const id = `payee-${payees.length}`;
      payees.push({ id, name, transfer_acct: "" });
      return id;
    },
    addTransactions: async (accountId, inputs, options) => {
      for (const input of inputs) {
        const id = `transaction-${transactions.length}`;
        const destinationId = `destination-${transactions.length}`;
        transactions.push({ ...input, id, account: accountId, transfer_id: null, tombstone: false });
        if (options.runTransfers && !partialTransfer) {
          transactions[transactions.length - 1]!.transfer_id = destinationId;
          transactions.push({
            id: destinationId, account: "card", payee: "to-checking", amount: -input.amount,
            date: input.date, imported_id: null, transfer_id: id, tombstone: false,
          });
        }
      }
      if (failSyncAfterWrite) failedSyncPending = true;
    },
    importTransactions: async (accountId, inputs, { dryRun }) => {
      const updatedPreview = [];
      for (const input of inputs) {
        const existing = transactions.find((row) => row.imported_id === input.imported_id && row.account === accountId);
        if (existing) {
          updatedPreview.push({ transaction: input, existing, ignored: true });
        } else {
          if (!dryRun) {
            const payee = payees.find((entry) => entry.name === input.payee_name);
            const payeeId = input.payee || payee?.id || await sdk.createPayee({ name: input.payee_name });
            transactions.push({ id: `transaction-${transactions.length}`, account: accountId, payee: payeeId,
              amount: input.amount, date: input.date, imported_id: input.imported_id, transfer_id: null, tombstone: false,
              ...(input.category ? { category: input.category } : {}) });
          }
          updatedPreview.push({ transaction: input });
        }
      }
      if (!dryRun && failSyncAfterWrite) failedSyncPending = true;
      return { added: [], updated: [], errors: [], updatedPreview };
    },
    q: (dataset) => {
      const query = { dataset, filter: () => query, select: () => query, withDead: () => query, withoutValidatedRefs: () => query };
      return query;
    },
    runQuery: async (query) => {
      const dataset = (query as unknown as { dataset: string }).dataset;
      if (dataset === "categories" && unavailableCategoryMetadata) throw new Error("Category metadata unavailable");
      return { data: ({ transactions, schedules, rules, categories: [{ id: "utilities" }] } as Record<string, unknown[]>)[dataset] || [] };
    },
    internal: { send: async (operation, rawPayload) => {
      const payload = rawPayload as { schedule?: Partial<Schedule> & { id: string }; conditions?: ActualScheduleCondition[]; id?: string; actions?: Rule["actions"] };
      if (operation === "schedule/create") {
        const schedule = payload.schedule!;
        const ruleId = `rule-${rules.length}`;
        rules.push({ id: ruleId, conditions: payload.conditions!, conditions_op: "and", actions: [{ op: "link-schedule", value: schedule.id }], tombstone: false });
        schedules.push({ id: schedule.id, name: schedule.name!, rule: ruleId, next_date: String(payload.conditions!.find((item) => item.field === "date")!.value), completed: false, tombstone: false, posts_transaction: false, active: true });
      } else if (operation === "schedule/update") {
        const schedule = schedules.find((item) => item.id === payload.schedule!.id)!;
        const rule = rules.find((item) => item.id === schedule.rule)!;
        rule.conditions = payload.conditions!;
        const value = rule.conditions.find((item) => item.field === "date")!.value;
        schedule.next_date = typeof value === "object" ? String(value?.start) : String(value);
      } else if (operation === "rule-update") {
        rules.find((item) => item.id === payload.id)!.actions = payload.actions!;
      } else throw new Error(`Unexpected SDK operation ${operation}`);
      if (failSyncAfterWrite) failedSyncPending = true;
      return undefined;
    } },
  };
  return {
    sdk, transactions, schedules, rules, payees, accounts,
    partialTransfer: () => { partialTransfer = true; },
    failSyncAfterWrite: () => { failSyncAfterWrite = true; },
    failCategoryRead: () => { unavailableCategoryMetadata = true; },
  };
}

describe("Actual financial operations", () => {
  it("keeps two managed purchases with identical visible fields separate, then suppresses replay", async () => {
    const state = fixture();
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", { ...purchase, budgetId: undefined }, "preview", now)).toMatchObject({ outcome: "would_add", budgetId: "budget" });
    expect(state.transactions).toEqual([]);
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", purchase, "write_once", now)).toMatchObject({ outcome: "added" });
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", { ...purchase, identityKey: "financial-event:purchase:2" }, "write_once", now)).toMatchObject({ outcome: "added" });
    expect(state.transactions.map((row) => row.imported_id)).toEqual([purchase.identityKey, "financial-event:purchase:2"]);
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", purchase, "recover", now)).toMatchObject({ outcome: "already_present" });
    expect(state.transactions).toHaveLength(2);
  });

  it("recovers an uncertain income import with its original signed cents and identity", async () => {
    const state = fixture();
    state.failSyncAfterWrite();
    const income = { ...purchase, identityKey: "financial-event:refund:1", amountCents: 3_000 };
    await expect(reconcileActualFinancialOperation(state.sdk, "budget", income, "write_once", now)).rejects.toMatchObject({ code: "ACTUAL_IMPORT_SYNC_UNCERTAIN" });
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", income, "recover", now)).toMatchObject({ outcome: "already_present" });
    expect(state.transactions).toEqual([expect.objectContaining({ amount: 3_000, imported_id: income.identityKey })]);
  });

  it.each(["missing", "unavailable"])("omits a %s inferred transaction category and preserves the owner's category on recovery", async (failure) => {
    const state = fixture();
    const input = { ...purchase, categoryId: failure === "missing" ? "removed-category" : "utilities" };
    if (failure === "unavailable") state.failCategoryRead();
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", input, "preview", now)).toMatchObject({ outcome: "would_add" });
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", input, "write_once", now)).toMatchObject({ outcome: "added" });
    expect(state.transactions[0]?.category).toBeUndefined();
    state.transactions[0]!.category = "owner-selected";
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", input, "recover", now)).toMatchObject({ outcome: "already_present" });
    expect(state.transactions).toEqual([expect.objectContaining({ category: "owner-selected" })]);
  });

  it("uses an explicitly resolved payee when multiple payees share the same name", async () => {
    const state = fixture();
    state.payees.push({ id: "first-shop", name: purchase.payee, transfer_acct: "" }, { id: "selected-shop", name: purchase.payee, transfer_acct: "" });
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", { ...purchase, payeeId: "selected-shop" }, "write_once", now)).toMatchObject({ outcome: "added" });
    expect(state.transactions).toEqual([expect.objectContaining({ payee: "selected-shop" })]);
  });

  it("recognizes a unique legacy transaction but contains ambiguous old matches", async () => {
    const state = fixture();
    state.payees.push({ id: "shop", name: purchase.payee, transfer_acct: "" });
    const legacy: Transaction = { id: "manual", account: purchase.accountId, payee: "shop", amount: purchase.amountCents,
      date: purchase.date, imported_id: null, transfer_id: null, tombstone: false };
    state.transactions.push(legacy);
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", purchase, "preview", now)).toMatchObject({ outcome: "already_present", transactionId: "manual" });
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", purchase, "recover", now)).toMatchObject({ outcome: "already_present" });
    state.transactions.push({ ...legacy, id: "manual-2" });
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", purchase, "write_once", now)).toMatchObject({ outcome: "needs_review" });
    expect(state.transactions).toHaveLength(2);
  });

  it("binds transaction writes to the preview budget and never imports during empty recovery", async () => {
    const state = fixture();
    for (const input of [{ ...purchase, budgetId: undefined }, { ...purchase, budgetId: "other-budget" }]) {
      expect(await reconcileActualFinancialOperation(state.sdk, "budget", input, "write_once", now)).toMatchObject({ outcome: "needs_review" });
    }
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", purchase, "recover", now)).toMatchObject({ outcome: "needs_review" });
    expect(state.transactions).toEqual([]);
    expect(state.payees).toHaveLength(2);
  });

  it("does not recreate a deleted transaction or overwrite an edited imported identity", async () => {
    const state = fixture();
    await reconcileActualFinancialOperation(state.sdk, "budget", purchase, "write_once", now);
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", { ...purchase, amountCents: -4_000 }, "recover", now)).toMatchObject({ outcome: "needs_review" });
    state.transactions[0]!.tombstone = true;
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", purchase, "write_once", now)).toMatchObject({ outcome: "needs_review" });
    expect(state.transactions).toHaveLength(1);
  });

  it("previews a completed transfer and records exactly one reciprocal pair", async () => {
    const { sdk, transactions } = fixture();
    expect(await reconcileActualFinancialOperation(sdk, "budget", { ...transfer, budgetId: undefined }, "preview", now)).toMatchObject({ outcome: "would_add", budgetId: "budget" });
    expect(transactions).toEqual([]);
    expect(await reconcileActualFinancialOperation(sdk, "budget", transfer, "write_once", now)).toMatchObject({ outcome: "added" });
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({ amount: -12_345, account: "checking", imported_id: transfer.identityKey, transfer_id: transactions[1]!.id });
    expect(transactions[1]).toMatchObject({ amount: 12_345, account: "card", transfer_id: transactions[0]!.id });
    expect(await reconcileActualFinancialOperation(sdk, "budget", transfer, "recover", now)).toMatchObject({ outcome: "already_present" });
    expect(await reconcileActualFinancialOperation(sdk, "budget", transfer, "write_once", now)).toMatchObject({ outcome: "already_present" });
    expect(transactions).toHaveLength(2);
  });

  it("keeps distinct managed transfers separate even when their account, date, and amount coincide", async () => {
    const state = fixture();
    const first = { ...transfer, identityKey: "financial-event:payment:1" };
    const second = { ...transfer, identityKey: "financial-event:payment:2" };
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", first, "write_once", now)).toMatchObject({ outcome: "added" });
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", second, "write_once", now)).toMatchObject({ outcome: "added" });
    expect(state.transactions).toHaveLength(4);
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", first, "recover", now)).toMatchObject({ outcome: "already_present", transactionId: state.transactions[0]!.id });
    expect(state.transactions).toHaveLength(4);
  });

  it("recovers a transfer after a post-write sync failure without adding another pair", async () => {
    const state = fixture();
    state.failSyncAfterWrite();
    await expect(reconcileActualFinancialOperation(state.sdk, "budget", transfer, "write_once", now)).rejects.toThrow("sync unavailable");
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", transfer, "recover", now)).toMatchObject({ outcome: "already_present" });
    expect(state.transactions).toHaveLength(2);
  });

  it("never repairs an incomplete transfer by creating another one", async () => {
    const state = fixture();
    state.partialTransfer();
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", transfer, "write_once", now)).toMatchObject({ outcome: "needs_review" });
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", transfer, "recover", now)).toMatchObject({ outcome: "needs_review" });
    expect(state.transactions).toHaveLength(1);
  });

  it("does not recreate a deleted transfer or accept changes to a recorded identity", async () => {
    const state = fixture();
    await reconcileActualFinancialOperation(state.sdk, "budget", transfer, "write_once", now);
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", { ...transfer, amountCents: 15_000 }, "write_once", now)).toMatchObject({ outcome: "needs_review" });
    state.transactions[0]!.tombstone = true;
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", transfer, "write_once", now)).toMatchObject({ outcome: "needs_review" });
    expect(state.transactions).toHaveLength(2);
  });

  it("rejects future transfers, unavailable accounts, and unbound writes", async () => {
    const state = fixture();
    for (const invalid of [
      { ...transfer, date: "2026-09-28" }, { ...transfer, toAccountId: "missing" },
      { ...transfer, budgetId: undefined }, { ...transfer, budgetId: "another-budget" },
    ]) expect(await reconcileActualFinancialOperation(state.sdk, "budget", invalid, "write_once", now)).toMatchObject({ outcome: "needs_review" });
    expect(state.transactions).toEqual([]);
  });

  it("creates a grounded payee and utility schedule, including an overdue statement, without posting money", async () => {
    const state = fixture();
    const input = { ...utility, date: "2026-09-01", categoryId: "utilities" };
    const preview = await reconcileActualFinancialOperation(state.sdk, "budget", { ...input, budgetId: undefined }, "preview", now);
    expect(preview).toMatchObject({ outcome: "would_add", budgetId: "budget" });
    expect(state.schedules).toEqual([]);
    expect(state.payees).toHaveLength(2);
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", { ...input, scheduleId: preview.scheduleId }, "write_once", now)).toMatchObject({ outcome: "added", scheduleId: preview.scheduleId });
    expect(state.schedules[0]).toMatchObject({ next_date: "2026-09-01", posts_transaction: false });
    expect(state.rules[0]!.actions).toContainEqual({ op: "set", field: "category", value: "utilities" });
    expect(state.transactions).toEqual([]);
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", input, "recover", now)).toMatchObject({ outcome: "already_present" });
    expect(state.schedules).toHaveLength(1);
    expect(state.payees).toHaveLength(3);
  });

  it("updates only the exact previewed schedule while preserving recurrence and posting settings", async () => {
    const state = fixture();
    await reconcileActualFinancialOperation(state.sdk, "budget", { ...utility, categoryId: "utilities" }, "write_once", now);
    const schedule = state.schedules[0]!;
    schedule.posts_transaction = true;
    state.rules[0]!.conditions.find((item) => item.field === "date")!.value = { frequency: "monthly", interval: 1, start: utility.date };
    const input = { ...utility, identityKey: "event:utility:2", amountCents: -9_850, date: "2026-10-28", scheduleId: schedule.id, categoryId: "removed-category" };
    const preview = await reconcileActualFinancialOperation(state.sdk, "budget", input, "preview", now);
    expect(preview.outcome).toBe("would_update");
    expect(preview.scheduleFingerprint).toBeTruthy();
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", { ...input, expectedScheduleFingerprint: preview.scheduleFingerprint }, "write_once", now)).toMatchObject({ outcome: "updated", scheduleId: schedule.id });
    expect(state.schedules).toHaveLength(1);
    expect(schedule).toMatchObject({ posts_transaction: true, next_date: "2026-10-28" });
    expect(state.rules[0]!.conditions).toContainEqual({ field: "date", op: "is", value: { frequency: "monthly", interval: 1, start: "2026-10-28" } });
    expect(state.rules[0]!.actions).toContainEqual({ op: "set", field: "category", value: "utilities" });
    expect(state.transactions).toEqual([]);
  });

  it("creates and recovers a utility schedule when optional category metadata is unavailable", async () => {
    const state = fixture();
    state.failCategoryRead();
    const input = { ...utility, categoryId: "utilities" };
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", input, "preview", now)).toMatchObject({ outcome: "would_add" });
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", input, "write_once", now)).toMatchObject({ outcome: "added" });
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", input, "recover", now)).toMatchObject({ outcome: "already_present" });
    expect(state.schedules).toHaveLength(1);
    expect(state.rules[0]?.actions).toEqual([{ op: "link-schedule", value: state.schedules[0]!.id }]);
    expect(state.transactions).toEqual([]);
  });

  it("does not schedule a utility payment that already exists in Actual", async () => {
    const state = fixture();
    state.payees.push({ id: "power", name: "Power Co", transfer_acct: "" });
    state.transactions.push({ id: "paid", account: "checking", payee: "power", amount: utility.amountCents,
      date: utility.date, imported_id: null, transfer_id: null, tombstone: false });
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", utility, "write_once", now)).toMatchObject({ outcome: "already_present", transactionId: "paid" });
    expect(state.schedules).toEqual([]);
    expect(state.transactions).toHaveLength(1);
  });

  it("rejects changes between schedule preview and write", async () => {
    const state = fixture();
    await reconcileActualFinancialOperation(state.sdk, "budget", utility, "write_once", now);
    const input = { ...utility, amountCents: -9_850 };
    const preview = await reconcileActualFinancialOperation(state.sdk, "budget", input, "preview", now);
    state.schedules[0]!.posts_transaction = true;
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", { ...input, expectedScheduleFingerprint: preview.scheduleFingerprint }, "write_once", now)).toMatchObject({ outcome: "needs_review" });
    expect(state.rules[0]!.conditions.find((item) => item.field === "amount")!.value).toBe(-8_700);
  });

  it("does not duplicate a matching utility schedule created after preview", async () => {
    const state = fixture();
    const preview = await reconcileActualFinancialOperation(state.sdk, "budget", utility, "preview", now);
    await reconcileActualFinancialOperation(state.sdk, "budget", { ...utility, identityKey: "another-notice" }, "write_once", now);
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", { ...utility, scheduleId: preview.scheduleId }, "write_once", now)).toMatchObject({ outcome: "already_present" });
    expect(state.schedules).toHaveLength(1);
  });

  it("recovers a utility write after sync failure and refuses deleted or missing recovery targets", async () => {
    const state = fixture();
    state.failSyncAfterWrite();
    await expect(reconcileActualFinancialOperation(state.sdk, "budget", utility, "write_once", now)).rejects.toThrow("sync unavailable");
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", utility, "recover", now)).toMatchObject({ outcome: "already_present" });
    state.schedules[0]!.tombstone = true;
    expect(await reconcileActualFinancialOperation(state.sdk, "budget", utility, "recover", now)).toMatchObject({ outcome: "needs_review" });
    expect(state.schedules).toHaveLength(1);
    const empty = fixture();
    expect(await reconcileActualFinancialOperation(empty.sdk, "budget", utility, "recover", now)).toMatchObject({ outcome: "needs_review" });
    expect(empty.schedules).toEqual([]);
    expect(empty.payees).toHaveLength(2);
  });
});
