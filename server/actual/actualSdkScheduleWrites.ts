import {
  buildDateCondition,
  findScheduleByName,
  findScheduleByPayee,
} from "./actualCoreModel.ts";
import type {
  ActualAccount,
  ActualPayee,
  ActualSchedule,
  ActualScheduleCondition,
} from "../../shared/types/actual.ts";

type ActualError = Error & { status?: number };

export interface ActualBillData {
  amount: number;
  due_date: string;
  payee: string;
  type: string;
  account_id?: string | null;
  category_id?: string | null;
  from_account_id?: string | null;
  to_account_id?: string | null;
  schedule_name?: string | null;
  notes?: string | null;
}

interface SdkTransactionInput {
  date: string;
  amount: number;
  payee?: string;
  payee_name?: string;
  category?: string;
  notes?: string;
  cleared?: boolean;
}

export interface ActualScheduleQueryBuilder {
  filter(value: unknown): ActualScheduleQueryBuilder;
  select(fields: string[]): ActualScheduleQueryBuilder;
  withDead(): ActualScheduleQueryBuilder;
  withoutValidatedRefs(): ActualScheduleQueryBuilder;
}

export interface ActualSdkSchedulePort {
  getAccounts(): Promise<ActualAccount[]>;
  getPayees(): Promise<ActualPayee[]>;
  getRules(): Promise<Array<{ id: string; conditions?: ActualScheduleCondition[] }>>;
  q(dataset: string): ActualScheduleQueryBuilder;
  runQuery(query: ActualScheduleQueryBuilder): Promise<{ data: unknown[] }>;
  createPayee(input: { name: string }): Promise<string>;
  createSchedule(input: { name: string; date: string; amount: number }): Promise<string>;
  addTransactions(accountId: string, transactions: SdkTransactionInput[]): Promise<void>;
  internal: { send(operation: string, payload: unknown): Promise<unknown> };
}

export function createActualSdkScheduleWrites(sdk: ActualSdkSchedulePort) {
  async function availableCategoryId(categoryId: string | null | undefined): Promise<string | undefined> {
    if (typeof categoryId !== "string" || !categoryId.trim()) return undefined;
    try {
      const rows = (await sdk.runQuery(sdk.q("categories").filter({ id: categoryId }).select(["id"]))).data;
      return rows.some((row) => row && typeof row === "object" && "id" in row && row.id === categoryId)
        ? categoryId : undefined;
    } catch {
      return undefined;
    }
  }

  async function readSchedules({ includeCompleted = false }: { includeCompleted?: boolean } = {}): Promise<ActualSchedule[]> {
    const rows = (await sdk.runQuery(
      sdk.q("schedules").select(["id", "name", "rule", "next_date", "completed"]),
    )).data;
    const rules = await sdk.getRules();
    const ruleMap = Object.fromEntries(rules.map((rule) => [rule.id, rule]));
    return rows
      .filter((row) => includeCompleted || !(row as ActualSchedule).completed)
      .map((row) => {
        const schedule = row as ActualSchedule;
        const ruleId = typeof schedule.rule === "string" ? schedule.rule : "";
        return { ...schedule, conditions: ruleMap[ruleId]?.conditions || [] };
      });
  }

  async function resolvePayee(payeeName: string | null | undefined): Promise<string | null> {
    if (!payeeName) return null;
    const payees = await sdk.getPayees();
    const match = payees.find((payee) => payee.name?.toLowerCase() === payeeName.toLowerCase());
    return match ? match.id : sdk.createPayee({ name: payeeName });
  }

  async function findExistingSchedule(
    payeeId: string | null,
    accountId: string | null,
    amount: number,
    name: string | null,
  ): Promise<string | null> {
    if (payeeId) {
      const existing = findScheduleByPayee(await readSchedules(), payeeId, accountId, Math.abs(amount));
      if (existing?.id) return existing.id;
    }
    if (name) {
      const byName = findScheduleByName(await readSchedules({ includeCompleted: true }), name, amount);
      if (byName?.id) return byName.id;
    }
    return null;
  }

  async function updateExistingSchedule(
    existingId: string,
    newDueDate: string,
    amount: number,
    extraConditions: ActualScheduleCondition[] = [],
  ): Promise<string | null | undefined> {
    const existing = (await readSchedules({ includeCompleted: true })).find((schedule) => schedule.id === existingId);
    const oldConditions = existing?.conditions || [];
    const newConditions = [
      buildDateCondition(oldConditions, newDueDate),
      { op: "is", field: "amount", value: amount },
      ...extraConditions,
    ];

    const extraFields = new Set(extraConditions.map((condition) => condition.field));
    for (const condition of oldConditions) {
      if (condition.field !== "date" && condition.field !== "amount" && !extraFields.has(condition.field)) {
        newConditions.push(condition);
      }
    }

    await sdk.internal.send("schedule/update", {
      schedule: { id: existingId, completed: false },
      conditions: newConditions,
    });
    return existing?.name;
  }

  async function createOrReuseSchedule(
    name: string,
    dueDate: string,
    amount: number,
    conditions: ActualScheduleCondition[],
  ): Promise<{ reused: boolean; name: string }> {
    const byName = findScheduleByName(await readSchedules({ includeCompleted: true }), name, amount);
    if (byName) {
      await sdk.internal.send("schedule/update", {
        schedule: { id: byName.id || "", completed: false },
        conditions,
      });
      return { reused: true, name };
    }
    const id = await sdk.createSchedule({ name, date: dueDate, amount });
    await sdk.internal.send("schedule/update", { schedule: { id, name }, conditions });
    return { reused: false, name };
  }

  async function upsertSchedule(billData: ActualBillData, targetAccountId: string) {
    const amountCents = -Math.round(billData.amount * 100);
    const signedAmount = billData.type === "income" ? Math.abs(amountCents) : amountCents;
    const name = billData.payee;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

    if (billData.due_date <= today) {
      const transaction: SdkTransactionInput = { date: billData.due_date, amount: signedAmount, cleared: false };
      const payeeId = await resolvePayee(billData.payee);
      if (payeeId) transaction.payee = payeeId;
      const categoryId = await availableCategoryId(billData.category_id);
      if (categoryId) transaction.category = categoryId;
      await sdk.addTransactions(targetAccountId, [transaction]);
      return { success: true, message: `Transaction "${name}" created (date is today or past)` };
    }

    const payeeId = await resolvePayee(billData.payee);
    const existingId = await findExistingSchedule(payeeId, targetAccountId, amountCents, name);
    if (existingId) {
      const existingName = await updateExistingSchedule(existingId, billData.due_date, signedAmount);
      return { success: true, message: `Updated schedule "${existingName || name}"` };
    }

    const conditions: ActualScheduleCondition[] = [
      { op: "is", field: "date", value: billData.due_date },
      { op: "is", field: "amount", value: signedAmount },
    ];
    if (payeeId) conditions.push({ op: "is", field: "payee", value: payeeId });
    conditions.push({ op: "is", field: "account", value: targetAccountId });

    const result = await createOrReuseSchedule(name, billData.due_date, signedAmount, conditions);
    return { success: true, message: result.reused ? `Updated existing schedule "${name}"` : `Schedule "${name}" created` };
  }

  async function upsertTransferSchedule(billData: ActualBillData) {
    if (!billData.to_account_id || !billData.schedule_name) {
      throw Object.assign(new Error("Transfer requires to_account_id and schedule_name"), { status: 400 });
    }
    const amountCents = Math.round(billData.amount * 100);
    const transferPayee = (await sdk.getPayees()).find((payee) => payee.transfer_acct === billData.from_account_id);
    if (!transferPayee) {
      const error: ActualError = new Error("No transfer payee found for selected source account");
      error.status = 400;
      throw error;
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    if (billData.due_date <= today) {
      await sdk.addTransactions(billData.to_account_id, [{
        date: billData.due_date,
        amount: amountCents,
        payee: transferPayee.id,
        cleared: false,
      }]);
      return { success: true, message: "Transfer created as transaction (date is today or past)" };
    }

    const name = billData.schedule_name;
    const extraConditions: ActualScheduleCondition[] = [
      { op: "is", field: "payee", value: transferPayee.id },
      { op: "is", field: "account", value: billData.to_account_id },
    ];
    const existingId = await findExistingSchedule(transferPayee.id, billData.to_account_id, amountCents, name);
    if (existingId) {
      const existingName = await updateExistingSchedule(existingId, billData.due_date, amountCents, extraConditions);
      return { success: true, message: `Updated transfer schedule "${existingName || name}"` };
    }

    const conditions: ActualScheduleCondition[] = [
      { op: "is", field: "date", value: billData.due_date },
      { op: "is", field: "amount", value: amountCents },
      ...extraConditions,
    ];
    const result = await createOrReuseSchedule(name, billData.due_date, amountCents, conditions);
    return {
      success: true,
      message: result.reused
        ? `Updated existing transfer schedule "${name}"`
        : `Transfer schedule "${name}" created`,
    };
  }

  async function writeBill(billData: ActualBillData) {
    const accounts = await sdk.getAccounts();
    const targetAccount = billData.account_id
      ? accounts.find((account) => account.id === billData.account_id)
      : undefined;
    const resolvedAccount = targetAccount
      || accounts.find((account) => account.type === "checking" || account.name.toLowerCase().includes("checking"))
      || accounts[0];

    if (billData.type === "transfer") {
      if (!billData.from_account_id || !billData.to_account_id || !billData.schedule_name) {
        const error: ActualError = new Error("Transfer requires from_account_id, to_account_id, and schedule_name");
        error.status = 400;
        throw error;
      }
      return upsertTransferSchedule(billData);
    }
    if (billData.type === "bill") {
      if (!resolvedAccount) throw Object.assign(new Error("No open Actual account found"), { status: 400 });
      return upsertSchedule(billData, resolvedAccount.id);
    }

    if (!resolvedAccount) throw Object.assign(new Error("No open Actual account found"), { status: 400 });
    const amountCents = Math.round(billData.amount * 100);
    const transaction: SdkTransactionInput = {
      date: billData.due_date,
      amount: billData.type === "income" ? amountCents : -amountCents,
      payee_name: billData.payee,
      notes: billData.notes == null || String(billData.notes).trim() === "" ? "" : String(billData.notes),
    };
    const categoryId = await availableCategoryId(billData.category_id);
    if (categoryId) transaction.category = categoryId;
    await sdk.addTransactions(resolvedAccount.id, [transaction]);
    return { success: true, message: `Sent ${billData.payee} $${billData.amount} to Actual Budget` };
  }

  return { readSchedules, writeBill };
}
