import actualApi from "@actual-app/api";
import { bindFinancialEventOperation, createFinancialEventExecutor } from "../financial-events/financial-event-operation.ts";
import { reconcileActualTransferSchedule } from "./actualTransferSchedules.ts";
import { runActualTransactionImport } from "./actualTransactionImportModel.ts";
import { readOriginalSchedule, readOriginalTransactions } from "./actualOriginalEvidence.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import { reconcileActualFinancialOperation, type ActualFinancialSdk } from "./actualFinancialOperations.ts";
import { createActualSdkScheduleWrites, type ActualSdkSchedulePort } from "./actualSdkScheduleWrites.ts";
import type { ActualCompletedTransferInput, ActualFinancialTransactionInput, ActualUtilityScheduleInput } from "../../shared/types/financial-operations.ts";

let dataDir: string | null = null;
let started = false;

afterEach(async () => {
  if (started) await actualApi.shutdown();
  vi.useRealTimers();
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
  it("updates and reactivates existing payment schedules without duplicates", async () => {
    dataDir = await createTestTempDir("actual-payment-schedule-reuse-");
    const internal = await actualApi.init({ dataDir, verbose: false });
    started = true;
    await internal.send("create-budget", { budgetName: "Schedule reuse", avoidUpload: true });
    const fromAccountId = await actualApi.createAccount({ name: "Checking", offbudget: false });
    const toAccountId = await actualApi.createAccount({ name: "Example Card", offbudget: false });
    const sdk = { ...actualApi, sync: async () => undefined } as unknown as Parameters<typeof reconcileActualTransferSchedule>[0];
    const now = new Date("2026-09-06T12:00:00Z");
    const input = { identityKey: "first-notice", budgetId: "isolated", fromAccountId, toAccountId,
      amountCents: 25_869, date: "2026-09-10", name: "", allowUpdate: true };
    const original = await reconcileActualTransferSchedule(sdk, "isolated", input, "create_once", now);
    expect(original.outcome).toBe("created");
    const changed = { ...input, identityKey: "confirmed-notice", amountCents: 26_000, date: "2026-09-14" };
    const preview = await reconcileActualTransferSchedule(sdk, "isolated", changed, "preview", now);
    expect(preview).toMatchObject({ outcome: "would_update", scheduleId: original.scheduleId });
    const execute = createFinancialEventExecutor({ transfer: (_userId, value, mode) =>
      reconcileActualTransferSchedule(sdk, "isolated", value, mode, now) });
    const operation = { executor: "transfer_schedule" as const, input: changed };
    const managedPreview = await execute("owner", operation, "preview");
    expect(managedPreview).toMatchObject({ outcome: "would_update", scheduleId: original.scheduleId });
    const bound = bindFinancialEventOperation(operation, managedPreview);
    expect(await execute("owner", bound, "recover")).toMatchObject({ outcome: "needs_review" });
    const updated = await execute("owner", bound, "write_once");
    expect(updated).toMatchObject({ outcome: "updated", scheduleId: original.scheduleId });
    expect(updated.evidence?.objects.every(object => object.provenance === "updated" && object.beforeState === "captured")).toBe(true);
    expect(await execute("owner", bound, "recover"))
      .toMatchObject({ outcome: "already_present", scheduleId: original.scheduleId });
    expect(await actualApi.getSchedules()).toEqual([expect.objectContaining({
      id: original.scheduleId, name: "Example Card Payment", amount: 26_000, date: "2026-09-14",
    })]);
    const staleOperation = { ...operation, input: { ...changed, date: "2026-09-16" } };
    const stalePreview = await execute("owner", staleOperation, "preview");
    const staleBound = bindFinancialEventOperation(staleOperation, stalePreview);
    await internal.send("schedule/update", { schedule: { id: original.scheduleId!, posts_transaction: true } });
    expect(await execute("owner", staleBound, "write_once")).toMatchObject({ outcome: "needs_review" });
    expect((await actualApi.getSchedules())[0]).toMatchObject({ date: "2026-09-14", posts_transaction: true });
    await internal.send("schedule/update", { schedule: { id: original.scheduleId!, completed: true } });
    const next = { ...input, identityKey: "next-month", date: "2026-10-14" };
    const nextPreview = await reconcileActualTransferSchedule(sdk, "isolated", next, "preview", now);
    expect(nextPreview).toMatchObject({ outcome: "would_update", scheduleId: original.scheduleId });
    expect(await reconcileActualTransferSchedule(sdk, "isolated", { ...next, scheduleId: nextPreview.scheduleId,
      expectedScheduleFingerprint: nextPreview.scheduleFingerprint, preparedEvidence: nextPreview.evidence }, "create_once", now))
      .toMatchObject({ outcome: "updated", scheduleId: original.scheduleId });
    expect(await actualApi.getSchedules()).toEqual([expect.objectContaining({ id: original.scheduleId,
      name: "Example Card Payment", posts_transaction: true, completed: false, date: "2026-10-14" })]);

    const bill = { kind: "utility_schedule" as const, identityKey: "utility-first", budgetId: "isolated",
      accountId: fromAccountId, payee: "Spectrum", amountCents: -8_000, date: "2026-09-15", name: "Internet Bill" };
    const created = await reconcileActualFinancialOperation(sdk as unknown as ActualFinancialSdk, "isolated", bill, "write_once", now);
    const renamedBillInput = { ...bill, identityKey: "spectrum-notice", name: "Spectrum", amountCents: -8_500 };
    const renamedPreview = await reconcileActualFinancialOperation(sdk as unknown as ActualFinancialSdk, "isolated", renamedBillInput, "preview", now);
    expect(renamedPreview).toMatchObject({ outcome: "would_update", scheduleId: created.scheduleId });
    expect(await reconcileActualFinancialOperation(sdk as unknown as ActualFinancialSdk, "isolated", {
      ...renamedBillInput, scheduleId: renamedPreview.scheduleId, expectedScheduleFingerprint: renamedPreview.scheduleFingerprint,
      preparedEvidence: renamedPreview.evidence,
    }, "write_once", now)).toMatchObject({ outcome: "updated", scheduleId: created.scheduleId });
    expect((await actualApi.getSchedules()).find(schedule => schedule.id === created.scheduleId))
      .toMatchObject({ name: "Internet Bill", amount: -8_500 });
    await internal.send("schedule/update", { schedule: { id: created.scheduleId!, completed: true } });
    const nextBill = { ...bill, identityKey: "utility-next", date: "2026-10-15", amountCents: -9_000 };
    const billPreview = await reconcileActualFinancialOperation(sdk as unknown as ActualFinancialSdk, "isolated", nextBill, "preview", now);
    expect(billPreview).toMatchObject({ outcome: "would_update", scheduleId: created.scheduleId });
    expect(await reconcileActualFinancialOperation(sdk as unknown as ActualFinancialSdk, "isolated", {
      ...nextBill, scheduleId: billPreview.scheduleId, expectedScheduleFingerprint: billPreview.scheduleFingerprint,
      preparedEvidence: billPreview.evidence,
    }, "write_once", now)).toMatchObject({ outcome: "updated", scheduleId: created.scheduleId });
    expect(await actualApi.getSchedules()).toHaveLength(2);

    const transferPayee = (await actualApi.getPayees()).find(payee => payee.transfer_acct === fromAccountId)!;
    await internal.send("schedule/create", { schedule: { id: "competing-payment", name: "Extra card payment" }, conditions: [
      { field: "account", op: "is", value: toAccountId }, { field: "payee", op: "is", value: transferPayee.id },
      { field: "amount", op: "is", value: 10_000 }, { field: "date", op: "is", value: "2026-10-21" },
    ] });
    const beforeAmbiguous = await actualApi.getSchedules();
    expect(await reconcileActualTransferSchedule(sdk, "isolated", { ...next, date: "2026-10-25" }, "preview", now))
      .toMatchObject({ outcome: "needs_review" });
    expect(await actualApi.getSchedules()).toEqual(beforeAmbiguous);
  }, 30_000);

  it("updates only an explicitly selected payment schedule when the same accounts have other schedules", async () => {
    dataDir = await createTestTempDir("actual-exact-payment-schedule-");
    const internal = await actualApi.init({ dataDir, verbose: false });
    started = true;
    await internal.send("create-budget", { budgetName: "Exact payment selection", avoidUpload: true });
    const fromAccountId = await actualApi.createAccount({ name: "Fictional savings", offbudget: false });
    const toAccountId = await actualApi.createAccount({ name: "Fictional card", offbudget: false });
    const otherFundingId = await actualApi.createAccount({ name: "Other savings", offbudget: false });
    const payees = await actualApi.getPayees();
    const cardPayeeId = payees.find(payee => payee.transfer_acct === toAccountId)!.id;
    const fundingPayeeId = payees.find(payee => payee.transfer_acct === fromAccountId)!.id;
    const selectedId = await actualApi.createSchedule({ name: "Selected card payment", account: fromAccountId,
      payee: cardPayeeId, amount: -10_000, amountOp: "is", date: "2026-09-10", posts_transaction: false });
    const siblingId = await actualApi.createSchedule({ name: "Other card payment", account: toAccountId,
      payee: fundingPayeeId, amount: 16_000, amountOp: "is", date: "2026-09-15", posts_transaction: false });
    const wrongEndpointId = await actualApi.createSchedule({ name: "Other funding payment", account: otherFundingId,
      payee: cardPayeeId, amount: -9_000, amountOp: "is", date: "2026-09-17", posts_transaction: false });
    const sdk = { ...actualApi, sync: async () => undefined } as unknown as Parameters<typeof reconcileActualTransferSchedule>[0];
    const now = new Date("2026-09-06T12:00:00Z");
    const input = { identityKey: "profile-selected-payment", budgetId: "isolated", fromAccountId, toAccountId,
      amountCents: 16_000, date: "2026-09-15", name: "Selected card payment", allowUpdate: true };
    const before = await actualApi.getSchedules();
    const siblingBefore = await readOriginalSchedule(sdk, "isolated", siblingId);
    const otherBefore = await readOriginalSchedule(sdk, "isolated", wrongEndpointId);
    expect(await reconcileActualTransferSchedule(sdk, "isolated", input, "preview", now))
      .toMatchObject({ outcome: "needs_review" });
    const selected = { ...input, scheduleId: selectedId };
    const execute = createFinancialEventExecutor({ transfer: (_userId, value, mode) =>
      reconcileActualTransferSchedule(sdk, "isolated", value, mode, now) });
    const operation = { executor: "transfer_schedule" as const, input: selected };
    const preview = await execute("owner", operation, "preview");
    expect(preview).toMatchObject({ outcome: "would_update", scheduleId: selectedId });
    const bound = bindFinancialEventOperation(operation, preview);
    // The sibling already has this amount/date; it cannot satisfy recovery for the selected target.
    expect(await execute("owner", bound, "recover")).toMatchObject({ outcome: "needs_review" });
    expect(await actualApi.getSchedules()).toEqual(before);
    expect(await execute("owner", bound, "write_once")).toMatchObject({ outcome: "updated", scheduleId: selectedId });
    expect(await execute("owner", bound, "recover")).toMatchObject({ outcome: "already_present", scheduleId: selectedId });
    expect(await actualApi.getSchedules()).toHaveLength(3);
    expect((await actualApi.getSchedules()).find(schedule => schedule.id === selectedId)).toMatchObject({
      name: "Selected card payment", account: fromAccountId, payee: cardPayeeId, amount: -16_000, date: "2026-09-15",
    });
    const selectedRuleId = (await actualApi.getSchedules()).find(schedule => schedule.id === selectedId)!.rule;
    expect((await actualApi.getRules()).find(rule => rule.id === selectedRuleId)?.conditions)
      .toContainEqual(expect.objectContaining({ field: "date", op: "isapprox", value: "2026-09-15" }));
    expect(await readOriginalSchedule(sdk, "isolated", siblingId)).toEqual(siblingBefore);
    expect(await readOriginalSchedule(sdk, "isolated", wrongEndpointId)).toEqual(otherBefore);
    expect(await actualApi.getTransactions(fromAccountId, "2026-09-01", "2026-10-31")).toEqual([]);
    expect(await actualApi.getTransactions(toAccountId, "2026-09-01", "2026-10-31")).toEqual([]);

    const next = { ...selected, identityKey: "next-profile-payment", date: "2026-10-15", amountCents: 20_000 };
    const unchanged = await actualApi.getSchedules();
    for (const invalid of [
      { ...next, scheduleId: "unavailable-selected-schedule" },
      { ...next, scheduleId: wrongEndpointId },
    ]) {
      expect(await reconcileActualTransferSchedule(sdk, "isolated", invalid, "preview", now))
        .toMatchObject({ outcome: "needs_review" });
    }
    expect(await actualApi.getSchedules()).toEqual(unchanged);

    const nextOperation = { ...operation, input: next };
    await actualApi.updateSchedule(selectedId, { amount: 16_000 });
    const wrongDirection = await readOriginalSchedule(sdk, "isolated", selectedId);
    expect(await execute("owner", nextOperation, "preview")).toMatchObject({ outcome: "needs_review" });
    expect(await readOriginalSchedule(sdk, "isolated", selectedId)).toEqual(wrongDirection);
    await actualApi.deleteSchedule(selectedId);
    const deleted = await readOriginalSchedule(sdk, "isolated", selectedId);
    for (const mode of ["preview", "write_once", "recover"] as const) {
      expect(await execute("owner", bound, mode)).toMatchObject({ outcome: "needs_review" });
    }
    expect(await readOriginalSchedule(sdk, "isolated", selectedId)).toEqual(deleted);
    expect(await actualApi.getSchedules()).toHaveLength(2);
    expect(await readOriginalSchedule(sdk, "isolated", siblingId)).toEqual(siblingBefore);
    expect(await readOriginalSchedule(sdk, "isolated", wrongEndpointId)).toEqual(otherBefore);
  }, 30_000);

  it("does not turn a preview-pinned new schedule into an exact selection before it exists", async () => {
    dataDir = await createTestTempDir("actual-preview-payment-race-");
    const internal = await actualApi.init({ dataDir, verbose: false });
    started = true;
    await internal.send("create-budget", { budgetName: "New payment preview", avoidUpload: true });
    const fromAccountId = await actualApi.createAccount({ name: "Fictional savings", offbudget: false });
    const toAccountId = await actualApi.createAccount({ name: "Fictional card", offbudget: false });
    const sdk = { ...actualApi, sync: async () => undefined } as unknown as Parameters<typeof reconcileActualTransferSchedule>[0];
    const now = new Date("2026-09-06T12:00:00Z");
    const execute = createFinancialEventExecutor({ transfer: (_userId, value, mode) =>
      reconcileActualTransferSchedule(sdk, "isolated", value, mode, now) });
    const operation = { executor: "transfer_schedule" as const, input: { identityKey: "new-payment", budgetId: "isolated",
      fromAccountId, toAccountId, amountCents: 16_000, date: "2026-09-15", name: "Card payment", allowUpdate: true } };
    const preview = await execute("owner", operation, "preview");
    expect(preview).toMatchObject({ outcome: "would_add" });
    const bound = bindFinancialEventOperation(operation, preview);
    const fundingPayeeId = (await actualApi.getPayees()).find(payee => payee.transfer_acct === fromAccountId)!.id;
    const siblingId = await actualApi.createSchedule({ name: "Newly added card payment", account: toAccountId,
      payee: fundingPayeeId, amount: 10_000, amountOp: "is", date: "2026-09-10", posts_transaction: false });
    const siblingBefore = await readOriginalSchedule(sdk, "isolated", siblingId);
    expect(await execute("owner", bound, "write_once")).toMatchObject({ outcome: "needs_review" });
    expect(await actualApi.getSchedules()).toEqual([expect.objectContaining({ id: siblingId, amount: 10_000, date: "2026-09-10" })]);
    expect(await readOriginalSchedule(sdk, "isolated", siblingId)).toEqual(siblingBefore);
    expect((await readOriginalSchedule(sdk, "isolated", preview.scheduleId!))?.objects).toEqual([]);
  }, 30_000);

  it("updates an existing SDK utility schedule while preserving its date tolerance and category", async () => {
    dataDir = await createTestTempDir("actual-exact-utility-schedule-");
    const internal = await actualApi.init({ dataDir, verbose: false });
    started = true;
    await internal.send("create-budget", { budgetName: "Existing utility schedule", avoidUpload: true });
    const accountId = await actualApi.createAccount({ name: "Fictional checking", offbudget: false });
    const payeeId = await actualApi.createPayee({ name: "Fictional power company" });
    const categoryId = (await actualApi.getCategories()).find(category => "group_id" in category)!.id;
    const scheduleId = await actualApi.createSchedule({ name: "Power bill", account: accountId, payee: payeeId,
      amount: -8_700, amountOp: "is", date: "2026-09-28", posts_transaction: false });
    const ruleId = (await actualApi.getSchedules()).find(schedule => schedule.id === scheduleId)!.rule;
    const rule = (await actualApi.getRules()).find(rule => rule.id === ruleId)!;
    await actualApi.updateRule({ ...rule, actions: [...rule.actions, { op: "set", field: "category", value: categoryId }] });
    const sdk = { ...actualApi, sync: async () => undefined } as unknown as ActualFinancialSdk;
    const now = new Date("2026-09-06T12:00:00Z");
    const input: ActualUtilityScheduleInput = { kind: "utility_schedule", identityKey: "exact-utility-next-cycle", budgetId: "isolated",
      accountId, payeeId, payee: "Fictional power company", scheduleId, amountCents: -9_850, date: "2026-10-28", name: "Power bill" };
    const before = await readOriginalSchedule(sdk, "isolated", scheduleId);
    const preview = await reconcileActualFinancialOperation(sdk, "isolated", input, "preview", now);
    expect(preview).toMatchObject({ outcome: "would_update", scheduleId });
    const bound = { ...input, expectedScheduleFingerprint: preview.scheduleFingerprint, preparedEvidence: preview.evidence };
    expect(await reconcileActualFinancialOperation(sdk, "isolated", bound, "recover", now)).toMatchObject({ outcome: "needs_review" });
    expect(await readOriginalSchedule(sdk, "isolated", scheduleId)).toEqual(before);
    expect(await reconcileActualFinancialOperation(sdk, "isolated", bound, "write_once", now)).toMatchObject({ outcome: "updated", scheduleId });
    expect(await reconcileActualFinancialOperation(sdk, "isolated", bound, "recover", now)).toMatchObject({ outcome: "already_present", scheduleId });
    expect(await actualApi.getSchedules()).toEqual([expect.objectContaining({ id: scheduleId,
      name: "Power bill", account: accountId, payee: payeeId, amount: -9_850, date: "2026-10-28" })]);
    const updatedRule = (await actualApi.getRules()).find(rule => rule.id === ruleId)!;
    expect(updatedRule.conditions).toContainEqual(expect.objectContaining({ field: "date", op: "isapprox", value: "2026-10-28" }));
    expect(updatedRule.actions).toContainEqual(expect.objectContaining({ op: "set", field: "category", value: categoryId }));
    expect(await actualApi.getTransactions(accountId, "2026-09-01", "2026-10-31")).toEqual([]);
  }, 30_000);

  it("updates successive quarterly utility statements without changing the recurrence or sibling rules", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-01T12:00:00Z"));
    dataDir = await createTestTempDir("actual-quarterly-utility-schedule-");
    const internal = await actualApi.init({ dataDir, verbose: false });
    started = true;
    await internal.send("create-budget", { budgetName: "Quarterly utility schedule", avoidUpload: true });
    const accountId = await actualApi.createAccount({ name: "Fictional checking", offbudget: false });
    const payeeId = await actualApi.createPayee({ name: "Fictional waste collection" });
    const categoryId = (await actualApi.getCategories()).find(category => "group_id" in category)!.id;
    const recurrence = { start: "2026-05-07", interval: 3, frequency: "monthly" as const, patterns: [],
      skipWeekend: false, weekendSolveMode: "after" as const, endMode: "never" as const,
      endOccurrences: 1, endDate: "2026-02-20" };
    const scheduleId = await actualApi.createSchedule({ name: "Waste collection", account: accountId, payee: payeeId,
      amount: -11_901, amountOp: "is", date: recurrence, posts_transaction: false });
    await internal.send("schedule/skip-next-date", { id: scheduleId });
    await internal.send("schedule/skip-next-date", { id: scheduleId });
    expect((await actualApi.getSchedules()).find(schedule => schedule.id === scheduleId)?.next_date).toBe("2026-11-07");
    const ruleId = (await actualApi.getSchedules()).find(schedule => schedule.id === scheduleId)!.rule;
    const rule = (await actualApi.getRules()).find(rule => rule.id === ruleId)!;
    await actualApi.updateRule({ ...rule, actions: [...rule.actions, { op: "set", field: "category", value: categoryId }] });
    const siblingId = await actualApi.createSchedule({ name: "Other waste collection", account: accountId, payee: payeeId,
      amount: -4_000, amountOp: "is", date: { ...recurrence, start: "2026-06-12" }, posts_transaction: false });
    const originalActions = (await actualApi.getRules()).find(entry => entry.id === ruleId)!.actions;
    const sdk = { ...actualApi, sync: async () => undefined } as unknown as ActualFinancialSdk;
    const siblingBefore = await readOriginalSchedule(sdk, "isolated", siblingId);
    // Resetting a synced next-date cursor requires a newer base timestamp.
    vi.setSystemTime(new Date("2026-04-01T12:00:01Z"));
    const now = new Date();
    for (const [date, amountCents] of [["2026-05-07", -11_238], ["2026-08-07", -11_901]] as const) {
      const input: ActualUtilityScheduleInput = { kind: "utility_schedule", identityKey: `quarterly-utility:${date}`, budgetId: "isolated",
        accountId, payeeId, payee: "Fictional waste collection", scheduleId, amountCents, date, name: "Waste collection" };
      const preview = await reconcileActualFinancialOperation(sdk, "isolated", input, "preview", now);
      expect(preview, `${date}: ${preview.reason}`).toMatchObject({ outcome: "would_update", scheduleId });
      const bound = { ...input, expectedScheduleFingerprint: preview.scheduleFingerprint, preparedEvidence: preview.evidence };
      const written = await reconcileActualFinancialOperation(sdk, "isolated", bound, "write_once", now);
      expect(written, `${date}: ${written.reason}`).toMatchObject({ outcome: "updated", scheduleId });
      expect(await reconcileActualFinancialOperation(sdk, "isolated", bound, "recover", now)).toMatchObject({ outcome: "already_present", scheduleId });
      const updated = (await actualApi.getSchedules()).find(schedule => schedule.id === scheduleId)!;
      expect(updated).toMatchObject({ id: scheduleId, amount: amountCents, next_date: date, date: recurrence });
      const updatedRule = (await actualApi.getRules()).find(entry => entry.id === ruleId)!;
      expect(updatedRule.conditions).toContainEqual(expect.objectContaining({ field: "date", op: "isapprox", value: recurrence }));
      expect(updatedRule.actions).toEqual(originalActions);
      expect(await readOriginalSchedule(sdk, "isolated", siblingId)).toEqual(siblingBefore);
    }
    const beforeOffCycle = await readOriginalSchedule(sdk, "isolated", scheduleId);
    const offCycle: ActualUtilityScheduleInput = { kind: "utility_schedule", identityKey: "quarterly-utility-off-cycle", budgetId: "isolated",
      accountId, payeeId, payee: "Fictional waste collection", scheduleId, amountCents: -12_000, date: "2026-07-07", name: "Waste collection" };
    expect(await reconcileActualFinancialOperation(sdk, "isolated", offCycle, "preview", now))
      .toMatchObject({ outcome: "needs_review" });
    expect(await readOriginalSchedule(sdk, "isolated", scheduleId)).toEqual(beforeOffCycle);
    expect(await actualApi.getSchedules()).toHaveLength(2);
    expect(await actualApi.getTransactions(accountId, "2026-05-01", "2026-11-30")).toEqual([]);
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
