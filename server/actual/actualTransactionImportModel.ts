import type {
  ActualImportAccountGroup,
  ActualImportBatchResult,
  ActualImportItemOutcome,
  ActualImportTransaction,
} from "../../shared/types/transaction-imports.ts";

export interface SdkImportTransactionInput {
  account: string;
  date: string;
  amount: number;
  payee_name: string;
  imported_payee: string;
  notes: string;
  imported_id: string;
  cleared: boolean;
  category?: string;
}

export interface SdkImportResult {
  added?: string[];
  updated?: string[];
  updatedPreview?: Array<{
    transaction?: { imported_id?: string | null };
    existing?: { imported_id?: string | null };
    ignored?: boolean;
    tombstone?: boolean;
  }>;
  errors?: Array<{ message?: string }>;
}

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function isValidYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateActualImportGroups(groups: ActualImportAccountGroup[], dryRun: boolean): void {
  if (!Array.isArray(groups) || groups.length === 0) invalid("Actual transaction import requires at least one account group");
  if (typeof dryRun !== "boolean") invalid("Actual transaction import dryRun flag is required");
  const accountIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const group of groups) {
    if (!group || typeof group.accountId !== "string" || !group.accountId.trim() || !Array.isArray(group.transactions) || group.transactions.length === 0) {
      invalid("Actual transaction import account groups are invalid");
    }
    if (accountIds.has(group.accountId)) invalid("Actual transaction import account groups must be unique");
    accountIds.add(group.accountId);
    for (const transaction of group.transactions) {
      if (!transaction || typeof transaction.itemId !== "string" || !transaction.itemId.trim() || itemIds.has(transaction.itemId)) {
        invalid("Actual transaction import item IDs must be non-empty and unique");
      }
      itemIds.add(transaction.itemId);
      if (typeof transaction.importedId !== "string" || !transaction.importedId.trim()) invalid("Actual transaction import requires a stable imported ID");
      if (!isValidYmd(transaction.date)) {
        invalid("Actual transaction import date is invalid");
      }
      if (!Number.isSafeInteger(transaction.amountCents) || transaction.amountCents === 0) invalid("Actual transaction import amount must be a nonzero integer");
      if (typeof transaction.payee !== "string" || !transaction.payee.trim() || typeof transaction.notes !== "string") {
        invalid("Actual transaction import payee or notes are invalid");
      }
      if (transaction.categoryId != null && (typeof transaction.categoryId !== "string" || !transaction.categoryId.trim())) {
        invalid("Actual transaction import category is invalid");
      }
    }
  }
}

function toSdkImportTransaction(accountId: string, transaction: ActualImportTransaction): SdkImportTransactionInput {
  return {
    account: accountId,
    date: transaction.date,
    amount: transaction.amountCents,
    payee_name: transaction.payee,
    imported_payee: transaction.payee,
    notes: transaction.notes,
    imported_id: transaction.importedId,
    cleared: false,
    ...(transaction.categoryId ? { category: transaction.categoryId } : {}),
  };
}

function isActualImportCompatibilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /importTransactions.*(not a function|undefined)|dryRun.*(unknown|unsupported)|unsupported.*import/i.test(message);
}

function projectActualImportOutcome(
  importedId: string,
  result: SdkImportResult,
  dryRun: boolean,
): { outcome: ActualImportItemOutcome; error: string | null } {
  const preview = result.updatedPreview?.find((entry) =>
    entry.transaction?.imported_id === importedId || entry.existing?.imported_id === importedId,
  );
  if (preview?.ignored) return { outcome: "already_present", error: null };
  if (preview?.existing && !preview.tombstone) return { outcome: dryRun ? "would_update" : "updated", error: null };
  if (preview) return { outcome: dryRun ? "would_add" : "added", error: null };
  if ((result.errors?.length || 0) > 0) {
    return { outcome: "failed", error: result.errors!.map((entry) => entry.message || "Actual import failed").join("; ") };
  }
  if ((result.added?.length || 0) > 0) {
    return { outcome: dryRun ? "would_add" : "added", error: null };
  }
  return { outcome: "failed", error: "Actual did not return a reconciliation outcome" };
}

export async function runActualTransactionImport({
  groups,
  dryRun,
  importTransactions,
  sync,
}: {
  groups: ActualImportAccountGroup[];
  dryRun: boolean;
  importTransactions: (accountId: string, transactions: SdkImportTransactionInput[], options: { dryRun: boolean }) => Promise<SdkImportResult>;
  sync: () => Promise<void>;
}): Promise<ActualImportBatchResult> {
  validateActualImportGroups(groups, dryRun);
  const projectedGroups: ActualImportBatchResult["groups"] = [];
  try {
    for (const group of groups) {
      const transactions = group.transactions.map((transaction) => toSdkImportTransaction(group.accountId, transaction));
      const result = await importTransactions(group.accountId, transactions, { dryRun });
      projectedGroups.push({
        accountId: group.accountId,
        items: group.transactions.map((transaction) => ({
          itemId: transaction.itemId,
          importedId: transaction.importedId,
          ...projectActualImportOutcome(transaction.importedId, result, dryRun),
        })),
      });
    }
  } catch (error) {
    if (isActualImportCompatibilityError(error)) {
      throw Object.assign(new Error("Installed Actual API does not support transaction import reconciliation"), {
        status: 503,
        code: "ACTUAL_IMPORT_INCOMPATIBLE",
      });
    }
    throw error;
  }
  if (!dryRun) {
    try {
      await sync();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`Actual import completed but sync failed: ${message}`), {
        status: 503,
        code: "ACTUAL_IMPORT_SYNC_UNCERTAIN",
        cause: error,
      });
    }
  }
  return { dryRun, groups: projectedGroups };
}
