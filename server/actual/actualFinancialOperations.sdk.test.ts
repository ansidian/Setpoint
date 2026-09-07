import actualApi from "@actual-app/api";
import { runActualTransactionImport } from "./actualTransactionImportModel.ts";
import { readOriginalTransactions } from "./actualOriginalEvidence.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import { reconcileActualFinancialOperation, type ActualFinancialSdk } from "./actualFinancialOperations.ts";
import { createActualSdkScheduleWrites, type ActualSdkSchedulePort } from "./actualSdkScheduleWrites.ts";
import type { ActualCompletedTransferInput, ActualFinancialTransactionInput, ActualUtilityScheduleInput } from "../../shared/types/financial-operations.ts";

let dataDir: string | null = null;
let started = false;

afterEach(async () => {
  if (started) await actualApi.shutdown();
  started = false;
  await removeTempDir(dataDir);
  dataDir = null;
});

describe("Actual financial operation SDK compatibility", () => {
  it("records distinct event transactions, a reciprocal transfer, and a utility schedule in an offline budget", async () => {
    dataDir = await createTestTempDir("actual-financial-operations-");
    // Supplying only a new dataDir prevents use of environment credentials or
    // any existing budget. No Actual server URL or account settings are loaded.
    const internal = await actualApi.init({ dataDir, verbose: false });
    started = true;
    await internal.send("create-budget", { budgetName: "Financial operation compatibility", avoidUpload: true });
    const fromAccountId = await actualApi.createAccount({ name: "Checking", offbudget: false });
    const toAccountId = await actualApi.createAccount({ name: "Card", offbudget: false });
    // All ledger operations use the installed SDK. Remote sync is the external
    // boundary omitted in this offline compatibility test; recovery/sync errors
    // are covered through the operation facade's stateful SDK fixture.
    const sdk = { ...actualApi, sync: async () => undefined } as unknown as ActualFinancialSdk;
    const input: ActualCompletedTransferInput = {
      kind: "completed_transfer", identityKey: "isolated-completed-transfer", budgetId: "isolated-budget",
      fromAccountId, toAccountId, amountCents: 12_345, date: "2026-09-05", notes: "Verified completed payment",
    };
    const now = new Date("2026-09-06T12:00:00Z");
    const transferPreview = await reconcileActualFinancialOperation(sdk, "isolated-budget", input, "preview", now);
    expect(transferPreview).toMatchObject({ outcome: "would_add" });
    const transferResult = await reconcileActualFinancialOperation(sdk, "isolated-budget", { ...input, preparedEvidence: transferPreview.evidence }, "write_once", now);
    expect(transferResult).toMatchObject({ outcome: "added" });
    expect(transferResult.evidence?.objects.map((object) => object.role)).toEqual(["primary", "counterpart"]);
    expect(transferResult.evidence?.objects.every((object) => object.provenance === "created")).toBe(true);
    const source = await actualApi.getTransactions(fromAccountId, input.date, input.date);
    const destination = await actualApi.getTransactions(toAccountId, input.date, input.date);
    expect(source).toHaveLength(1);
    expect(destination).toHaveLength(1);
    expect(source[0]).toMatchObject({ amount: -12_345, imported_id: input.identityKey, transfer_id: destination[0]!.id, cleared: false });
    expect(destination[0]).toMatchObject({ amount: 12_345, transfer_id: source[0]!.id, cleared: false });
    expect(await reconcileActualFinancialOperation(sdk, "isolated-budget", input, "recover", now)).toMatchObject({ outcome: "already_present", transactionId: source[0]!.id });
    expect(await reconcileActualFinancialOperation(sdk, "isolated-budget", input, "write_once", now)).toMatchObject({ outcome: "already_present" });
    expect(await actualApi.getTransactions(fromAccountId, input.date, input.date)).toHaveLength(1);

    const categoryId = (await actualApi.getCategories()).find((category) => "group_id" in category)?.id;
    expect(categoryId).toBeTruthy();
    const utility: ActualUtilityScheduleInput = {
      kind: "utility_schedule", identityKey: "isolated-utility-statement", budgetId: "isolated-budget",
      accountId: fromAccountId, payee: "Example Power", categoryId, amountCents: -8_700, date: "2026-09-28", name: "Example Power",
    };
    const created = await reconcileActualFinancialOperation(sdk, "isolated-budget", utility, "write_once", now);
    expect(created).toMatchObject({ outcome: "added" });
    const update = { ...utility, identityKey: "isolated-next-statement", scheduleId: created.scheduleId, amountCents: -9_850, date: "2026-10-28", categoryId: "removed-category" };
    const preview = await reconcileActualFinancialOperation(sdk, "isolated-budget", update, "preview", now);
    expect(preview).toMatchObject({ outcome: "would_update", scheduleId: created.scheduleId });
    const updated = await reconcileActualFinancialOperation(sdk, "isolated-budget", {
      ...update, expectedScheduleFingerprint: preview.scheduleFingerprint, preparedEvidence: preview.evidence,
    }, "write_once", now);
    expect(updated).toMatchObject({ outcome: "updated", scheduleId: created.scheduleId });
    expect(updated.evidence?.objects.map((object) => object.kind).sort()).toEqual(["rule", "schedule", "schedule_next_date"]);
    const priorRule = preview.evidence?.objects.find((object) => object.kind === "rule")?.before;
    expect(updated.evidence?.objects.find((object) => object.kind === "rule")?.before).toEqual(priorRule);
    expect(updated.evidence?.objects.every((object) => object.beforeState === "captured")).toBe(true);
    expect(updated.evidence?.objects.find((object) => object.kind === "rule")?.after).not.toEqual(priorRule);
    expect(await actualApi.getSchedules()).toEqual([expect.objectContaining({ id: created.scheduleId, amount: -9_850, date: "2026-10-28" })]);
    expect((await actualApi.getRules()).some((rule) => rule.actions.some((action) => "field" in action && action.field === "category" && action.value === categoryId))).toBe(true);
    expect(await actualApi.getTransactions(fromAccountId, "2026-09-01", "2026-10-31")).toHaveLength(1);

    const purchase: ActualFinancialTransactionInput = {
      kind: "transaction", identityKey: "financial-event:purchase:1", budgetId: "isolated-budget",
      accountId: toAccountId, payee: "Example Shop", amountCents: -3_000, date: input.date, notes: "Purchase receipt", categoryId: "removed-category",
    };
    expect(await reconcileActualFinancialOperation(sdk, "isolated-budget", purchase, "preview", now)).toMatchObject({ outcome: "would_add" });
    expect(await reconcileActualFinancialOperation(sdk, "isolated-budget", purchase, "write_once", now)).toMatchObject({ outcome: "added" });
    const secondPurchase = { ...purchase, identityKey: "financial-event:purchase:2" };
    expect(await reconcileActualFinancialOperation(sdk, "isolated-budget", secondPurchase, "write_once", now)).toMatchObject({ outcome: "added" });
    const purchases = (await actualApi.getTransactions(toAccountId, input.date, input.date)).filter((row) => row.amount === -3_000);
    expect(purchases).toHaveLength(2);
    expect(purchases.map((row) => row.imported_id).sort()).toEqual([purchase.identityKey, secondPurchase.identityKey]);
    expect(purchases.every((row) => row.cleared === false)).toBe(true);
    expect(purchases.every((row) => row.category == null)).toBe(true);
    const firstPurchase = purchases.find((row) => row.imported_id === purchase.identityKey)!;
    await actualApi.updateTransaction(firstPurchase.id, { category: categoryId });
    expect(await reconcileActualFinancialOperation(sdk, "isolated-budget", purchase, "recover", now)).toMatchObject({ outcome: "already_present" });
    expect(await reconcileActualFinancialOperation(sdk, "isolated-budget", purchase, "write_once", now)).toMatchObject({ outcome: "already_present" });
    expect(await actualApi.getTransactions(toAccountId, input.date, input.date)).toHaveLength(3);
    expect((await actualApi.getTransactions(toAccountId, input.date, input.date)).find((row) => row.id === firstPurchase.id)?.category).toBe(categoryId);

    const legacy = createActualSdkScheduleWrites(actualApi as unknown as ActualSdkSchedulePort);
    for (const type of ["expense", "bill"]) {
      expect(await legacy.writeBill({
        type, payee: `Legacy ${type}`, amount: 4.56, due_date: "2020-05-10",
        account_id: fromAccountId, category_id: "removed-category",
      })).toMatchObject({ success: true });
    }
    const manualTransactions = await actualApi.getTransactions(fromAccountId, "2020-05-10", "2020-05-10");
    expect(manualTransactions).toHaveLength(2);
    expect(manualTransactions.every((row) => row.amount === -456 && row.category == null)).toBe(true);
    expect(await legacy.writeBill({
      type: "expense", payee: "Categorized legacy expense", amount: 7.89, due_date: "2020-05-10",
      account_id: fromAccountId, category_id: categoryId,
    })).toMatchObject({ success: true });
    expect((await actualApi.getTransactions(fromAccountId, "2020-05-10", "2020-05-10"))
      .find((row) => row.amount === -789)?.category).toBe(categoryId);
  }, 30_000);
  it("receipts exact grouped-import IDs and raw cents and rejects a changed prepared target", async () => {
    dataDir = await createTestTempDir("actual-original-import-");
    const internal = await actualApi.init({ dataDir, verbose: false });
    started = true;
    await internal.send("create-budget", { budgetName: "Original import receipts", avoidUpload: true });
    const accountId = await actualApi.createAccount({ name: "Fictional checking", offbudget: false });
    const sdk = actualApi as unknown as ActualFinancialSdk;
    const input = { groups: [{ accountId, transactions: [{ itemId: "one", importedId: "receipt-one", date: "2026-09-06",
      amountCents: -1234, payee: "Fictional shop", notes: "Original" }] }],
      sync: async () => undefined,
      evidenceAccess: { budgetId: "isolated", readTransactions: (id: string) => readOriginalTransactions(sdk, id) },
      importTransactions: sdk.importTransactions.bind(sdk) };
    const preview = await runActualTransactionImport({ ...input, dryRun: true });
    const preparedEvidence = preview.groups[0]!.items[0]!.evidence!;
    const groups = [{ accountId, transactions: input.groups[0]!.transactions.map((item) => ({ ...item, preparedEvidence })) }];
    const result = await runActualTransactionImport({ ...input, groups, dryRun: false });
    expect(result.groups[0]!.items[0]!.error).toBeNull();
    expect(result.groups[0]!.items[0]).toMatchObject({ outcome: "added", evidence: { budgetId: "isolated", objects: [
      { kind: "transaction", provenance: "created", beforeState: "confirmed_absent", before: null, after: { amount: -1234, financial_id: "receipt-one" } },
    ] } });
    const id = result.groups[0]!.items[0]!.evidence!.objects[0]!.id;
    expect((await actualApi.getTransactions(accountId, "2026-09-06", "2026-09-06"))[0]?.id).toBe(id);
    await expect(runActualTransactionImport({ ...input, groups, dryRun: false })).rejects.toMatchObject({ code: "ACTUAL_IMPORT_PREPARATION_CHANGED" });
    expect(await actualApi.getTransactions(accountId, "2026-09-06", "2026-09-06")).toHaveLength(1);
    const matched = await runActualTransactionImport({ ...input, dryRun: true });
    expect(matched.groups[0]!.items[0]).toMatchObject({ outcome: "already_present", evidence: { objects: [
      { id, provenance: "matched", before: { amount: -1234 }, after: { amount: -1234 } },
    ] } });
  }, 30_000);

});
