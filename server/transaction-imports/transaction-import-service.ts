import { transactionImportStore, type TransactionImportStore } from "./transaction-import-store.ts";
import type { TransactionImportConfirmation } from "../../shared/types/transaction-imports.ts";

function isValidYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function createTransactionImportService({
  store = transactionImportStore,
}: { store?: TransactionImportStore } = {}) {
  async function commitItems(
    userId: string,
    runId: string,
    confirmations: TransactionImportConfirmation[],
  ): Promise<{ accepted: number }> {
    if (!await store.getRun(userId, runId)) throw Object.assign(new Error("Transaction import run not found"), { status: 404 });
    if (!Array.isArray(confirmations) || !confirmations.length || confirmations.length > 100) {
      throw Object.assign(new Error("One to 100 transaction import items are required"), { status: 400 });
    }
    const seen = new Set<string>();
    let accepted = 0;
    for (const confirmation of confirmations) {
      if (!confirmation || typeof confirmation.itemId !== "string" || !confirmation.itemId || seen.has(confirmation.itemId)) {
        throw Object.assign(new Error("Transaction import item IDs must be non-empty and unique"), { status: 400 });
      }
      seen.add(confirmation.itemId);
      const item = await store.getItem(userId, confirmation.itemId);
      if (!item || item.runId !== runId) throw Object.assign(new Error("Transaction import item not found"), { status: 404 });
      const date = confirmation.date ?? item.date;
      const amountCents = confirmation.amountCents ?? item.amountCents;
      const payee = confirmation.payee ?? item.payee;
      const notes = confirmation.notes ?? item.notes;
      const actualAccountId = confirmation.actualAccountId ?? item.actualAccountId;
      const actualCategoryId = confirmation.actualCategoryId === undefined ? item.actualCategoryId : confirmation.actualCategoryId;
      if (!date || !isValidYmd(date)) {
        throw Object.assign(new Error("Transaction date must be a valid YYYY-MM-DD value"), { status: 400 });
      }
      if (!Number.isSafeInteger(amountCents) || amountCents === 0) {
        throw Object.assign(new Error("Transaction amountCents must be a nonzero integer"), { status: 400 });
      }
      if (item.currency !== "USD") throw Object.assign(new Error("Only USD transaction candidates can be confirmed"), { status: 400 });
      if (typeof payee !== "string" || !payee.trim() || payee.length > 200) {
        throw Object.assign(new Error("Transaction payee is required and must be at most 200 characters"), { status: 400 });
      }
      if (typeof notes !== "string" || notes.length > 2_000) {
        throw Object.assign(new Error("Transaction notes must be at most 2000 characters"), { status: 400 });
      }
      if (typeof actualAccountId !== "string" || !actualAccountId.trim() || actualAccountId.length > 200) {
        throw Object.assign(new Error("An Actual account ID is required"), { status: 400 });
      }
      if (actualCategoryId != null && (typeof actualCategoryId !== "string" || !actualCategoryId.trim() || actualCategoryId.length > 200)) {
        throw Object.assign(new Error("Actual category ID is invalid"), { status: 400 });
      }
      if (await store.confirmItem(userId, runId, item.id, {
        date,
        amountCents: amountCents as number,
        payee: payee.trim(),
        notes,
        actualAccountId: actualAccountId.trim(),
        actualCategoryId,
      })) accepted++;
    }
    return { accepted };
  }

  async function retryItem(userId: string, itemId: string): Promise<{ accepted: boolean }> {
    if (!await store.getItem(userId, itemId)) throw Object.assign(new Error("Transaction import item not found"), { status: 404 });
    return { accepted: await store.retryItem(userId, itemId) };
  }

  async function dismissItem(userId: string, itemId: string): Promise<{ dismissed: boolean }> {
    if (!await store.getItem(userId, itemId)) throw Object.assign(new Error("Transaction import item not found"), { status: 404 });
    return { dismissed: await store.dismissItem(userId, itemId) };
  }

  return {
    listItemsForEmail: store.listItemsForEmail,
    commitItems,
    retryItem,
    dismissItem,
  };
}

export const transactionImportService = createTransactionImportService();
