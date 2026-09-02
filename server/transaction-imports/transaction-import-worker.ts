import { isTransferImport, processTransferImportItem } from "./financial-email-transfer.ts";
import { randomUUID } from "crypto";
import type { Client } from "@libsql/client";
import db from "../db/connection.ts";
import { GmailTransactionSearchError } from "../email/transaction-email-search.ts";
import { searchTransactionEmails } from "./transaction-email-discovery.ts";
import type { ConfiguredEmailAccount } from "../email/transaction-email-search.ts";
import { prepareTransactionImportItems } from "./transaction-import-service.ts";
import { planTransactionImportItems } from "./transaction-import-planner-adapter.ts";
import { transactionImportStore, type ClaimedItem, type TransactionImportStore } from "./transaction-import-store.ts";
import { importTransactionGroups } from "../actual/actual.ts";
import { invalidateActualAfterTransactionImport } from "../bills/bills-service.ts";
import { applyFinancialEmailPreflightOutcome } from "./financial-email-preflight.ts";
import { financialEmailAutomationEnabled } from "../bills/financial-email-planner.ts";
import type {
  ActualImportAccountGroup,
  ActualImportBatchResult,
  TransactionImportItemStatus,
} from "../../shared/types/transaction-imports.ts";

const MAX_BATCH_ITEMS = 100;
const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MS = 15 * 60 * 1000;
const RETRY_BASE_MS = 30_000;

type WorkerDb = Pick<Client, "execute">;

function conciseError(error: unknown): string {
  const candidate = error instanceof Error ? error.message : String(error);
  return candidate.replace(/<[^>]*>/g, "").slice(0, 300);
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : null;
}

function itemGroups(items: ClaimedItem[]): ActualImportAccountGroup[] {
  const groups = new Map<string, ActualImportAccountGroup>();
  for (const item of items) {
    if (!item.actualAccountId || !item.importedId || !item.date || item.amountCents == null || !item.payee) continue;
    const group = groups.get(item.actualAccountId) || { accountId: item.actualAccountId, transactions: [] };
    group.transactions.push({
      itemId: item.id,
      importedId: item.importedId,
      date: item.date,
      amountCents: item.amountCents,
      payee: item.payee,
      notes: item.notes,
      categoryId: item.actualCategoryId,
    });
    groups.set(item.actualAccountId, group);
  }
  return [...groups.values()];
}

export function createTransactionImportWorker({
  store = transactionImportStore,
  dbClient = db,
  searchPage = searchTransactionEmails,
  importGroups = importTransactionGroups,
  invalidateAfterCommit = invalidateActualAfterTransactionImport,
  createId = randomUUID,
  now = Date.now,
  planItems = planTransactionImportItems,
}: {
  store?: TransactionImportStore;
  dbClient?: WorkerDb;
  searchPage?: typeof searchTransactionEmails;
  importGroups?: typeof importTransactionGroups;
  invalidateAfterCommit?: typeof invalidateActualAfterTransactionImport;
  createId?: () => string;
  now?: () => number;
  planItems?: typeof planTransactionImportItems;
} = {}) {
  async function loadGmailAccount(userId: string, accountId: string): Promise<ConfiguredEmailAccount | null> {
    const result = await dbClient.execute({
      sql: `SELECT * FROM ea_accounts WHERE user_id = ? AND id = ? AND type = 'gmail' LIMIT 1`,
      args: [userId, accountId],
    });
    return result.rows[0] as unknown as ConfiguredEmailAccount || null;
  }

  async function processNextHistoricalPage(): Promise<boolean> {
    const claimToken = createId();
    const run = await store.claimNextRun(claimToken);
    if (!run) return false;
    if (run.trigger !== "historical_scan" || !run.startDate || !run.endDate) {
      await store.settleRun(run.userId, run.id, claimToken, { status: "failed", cursor: run.cursor, lastError: "Invalid transaction import run" });
      return true;
    }
    const accountIndex = Number(run.cursor.accountIndex || 0);
    const sourceIndex = Number(run.cursor.sourceIndex || 0);
    const accountId = run.gmailAccountIds[accountIndex];
    const source = run.sources[sourceIndex];
    if (!accountId || !source || source === "generic") {
      await store.settleRun(run.userId, run.id, claimToken, { status: "completed", cursor: { complete: true } });
      return true;
    }
    const account = await loadGmailAccount(run.userId, accountId);
    if (!account) {
      await store.settleRun(run.userId, run.id, claimToken, {
        status: "failed",
        cursor: run.cursor,
        lastError: `Gmail account is unavailable: ${accountId}`,
        failed: 1,
      });
      return true;
    }

    try {
      const page = await searchPage(account, {
        source,
        start: run.startDate,
        end: run.endDate,
        pageSize: 50,
        pageToken: typeof run.cursor.pageToken === "string" ? run.cursor.pageToken : undefined,
      });
      const prepared = prepareTransactionImportItems(run.userId, run.id, page.emails, createId);
      const plannedItems = await planItems(run.userId, prepared.items);
      let insertedQueued = 0;
      let insertedReview = 0;
      let insertedDuplicates = 0;
      const insertedMessages = new Set<string>();
      for (const item of plannedItems) {
        if (await store.insertItem(item)) {
          insertedMessages.add(item.gmailMessageId);
          if (item.status === "queued") insertedQueued++;
          else if (item.status === "already_present") insertedDuplicates++;
          else insertedReview++;
        }
      }

      let nextAccountIndex = accountIndex;
      let nextSourceIndex = sourceIndex;
      const nextPageToken: string | null = page.nextPageToken;
      if (!nextPageToken) {
        nextSourceIndex++;
        if (nextSourceIndex >= run.sources.length) {
          nextSourceIndex = 0;
          nextAccountIndex++;
        }
      }
      const complete = nextAccountIndex >= run.gmailAccountIds.length;
      await store.settleRun(run.userId, run.id, claimToken, {
        status: complete ? "completed" : "queued",
        cursor: complete ? { complete: true } : {
          accountIndex: nextAccountIndex,
          sourceIndex: nextSourceIndex,
          ...(nextPageToken ? { pageToken: nextPageToken } : {}),
        },
        discovered: insertedMessages.size,
        parsed: insertedMessages.size,
        queued: insertedQueued,
        review: insertedReview,
        failed: page.failures.length,
        lastError: page.failures.length ? `${page.failures.length} Gmail messages could not be fetched` : null,
      });
      if (insertedDuplicates) await store.incrementRunOutcomes(run.userId, run.id, { duplicate: insertedDuplicates });
      return true;
    } catch (error) {
      const isReauth = error instanceof GmailTransactionSearchError && error.code === "reauth_required";
      const resetPage = error instanceof GmailTransactionSearchError && error.code === "page_token_expired";
      await store.settleRun(run.userId, run.id, claimToken, {
        status: run.attempts >= MAX_ATTEMPTS ? "failed" : isReauth ? "paused" : "retry",
        cursor: resetPage ? { ...run.cursor, pageToken: null } : run.cursor,
        lastError: conciseError(error),
        failed: run.attempts >= MAX_ATTEMPTS ? 1 : 0,
      });
      return true;
    }
  }

  async function claimItemBatch(): Promise<ClaimedItem[]> {
    const items: ClaimedItem[] = [];
    for (let index = 0; index < MAX_BATCH_ITEMS; index++) {
      const item = await store.claimNextItem(createId());
      if (!item) break;
      items.push(item);
    }
    return items;
  }

  async function settleImportFailure(items: ClaimedItem[], error: unknown): Promise<void> {
    const code = errorCode(error);
    const actionablePause = code === "ACTUAL_IMPORT_INCOMPATIBLE" || code === "ACTUAL_LOCAL_BUDGET_REQUIRED"
      || /not configured|auth|password|reauth/i.test(conciseError(error));
    for (const item of items) {
      const uncertainCommit = item.status === "importing"
        && (code === "ACTUAL_IMPORT_SYNC_UNCERTAIN" || code === "ACTUAL_WORKER_TIMEOUT");
      const retryStatus: TransactionImportItemStatus = uncertainCommit
        ? "queued"
        : item.status === "importing" ? "ready" : "queued";
      const terminal = !uncertainCommit && item.attempts >= MAX_ATTEMPTS;
      await store.settleItem(item.userId, item.id, item.claimToken, {
        status: terminal ? "failed" : actionablePause ? "paused" : retryStatus,
        reconciliationStatus: terminal ? "failed" : null,
        lastError: code ? `${code}: ${conciseError(error)}` : conciseError(error),
        nextAttemptAt: terminal || actionablePause
          ? null
          : uncertainCommit ? now() : now() + Math.min(2 ** item.attempts * RETRY_BASE_MS, 10 * 60_000),
      });
      if (terminal) await store.incrementRunOutcomes(item.userId, item.runId, { failed: 1 });
    }
  }

  async function applyResults(items: ClaimedItem[], result: ActualImportBatchResult): Promise<void> {
    const outcomeByItem = new Map(result.groups.flatMap((group) => group.items).map((item) => [item.itemId, item]));
    for (const item of items) {
      const outcome = outcomeByItem.get(item.id);
      if (!outcome) {
        await store.settleItem(item.userId, item.id, item.claimToken, { status: "failed", reconciliationStatus: "failed", lastError: "Actual did not return an item outcome" });
        await store.incrementRunOutcomes(item.userId, item.runId, { failed: 1 });
        continue;
      }
      if (result.dryRun) {
        const plannerOwned = item.source === "generic"
          || item.financialPlan?.candidate.transaction_import?.executionOwner === "planner";
        const financialPlan = plannerOwned && item.financialPlan
          ? applyFinancialEmailPreflightOutcome(item.financialPlan, outcome.outcome, new Date(now()).toISOString())
          : null;
        const automaticSafe = plannerOwned
          ? financialPlan?.automation.eligible === true
          : item.automaticSafe;
        const status: TransactionImportItemStatus = outcome.outcome === "already_present"
          ? "already_present"
          : outcome.outcome === "failed"
            ? "failed"
            : item.confirmedAt != null || item.automationMode === "automatic" && automaticSafe
              ? "ready"
              : "needs_review";
        const settled = await store.settleItem(item.userId, item.id, item.claimToken, {
          status,
          reconciliationStatus: outcome.outcome,
          lastError: outcome.error,
          financialPlan,
          automaticSafe,
        });
        if (financialPlan && settled) {
          await store.persistFinancialPlanForEmail(
            item.userId,
            item.gmailAccountId,
            item.emailUid,
            financialPlan,
          ).catch((error) => {
            console.error("[Transaction Imports] Financial plan projection sync failed:", conciseError(error));
          });
        }
        if (outcome.outcome === "already_present") await store.incrementRunOutcomes(item.userId, item.runId, { duplicate: 1 });
        if (outcome.outcome === "failed") await store.incrementRunOutcomes(item.userId, item.runId, { failed: 1 });
      } else {
        const status: TransactionImportItemStatus = outcome.outcome === "added" ? "added"
          : outcome.outcome === "updated" ? "updated"
            : outcome.outcome === "already_present" ? "already_present" : "failed";
        await store.settleItem(item.userId, item.id, item.claimToken, {
          status,
          reconciliationStatus: outcome.outcome,
          lastError: outcome.error,
        });
        await store.incrementRunOutcomes(item.userId, item.runId, {
          added: outcome.outcome === "added" ? 1 : 0,
          updated: outcome.outcome === "updated" ? 1 : 0,
          duplicate: outcome.outcome === "already_present" ? 1 : 0,
          failed: outcome.outcome === "failed" ? 1 : 0,
        });
      }
    }
  }

  async function processNextItemBatch(): Promise<boolean> {
    const batch = await claimItemBatch();
    if (!batch.length) return false;
    for (const item of batch.filter(isTransferImport)) {
      if (await processTransferImportItem(item, { store, now })) {
        await invalidateAfterCommit(item.userId).catch((error) => console.error("[Transaction Imports] Transfer invalidation failed:", conciseError(error)));
      }
    }
    const claimed = batch.filter((item) => !isTransferImport(item));
    const invalid = claimed.filter((item) => !item.actualAccountId || !item.importedId || !item.date || item.amountCents == null || !item.payee || item.currency !== "USD"
      || ((item.source === "generic" || item.financialPlan?.candidate.transaction_import?.executionOwner === "planner")
        && item.status === "importing" && item.confirmedAt == null
        && (item.automationMode !== "automatic" || !item.automaticSafe
          || !item.financialPlan?.automation.eligible
          || !financialEmailAutomationEnabled(item.financialPlan.automation.operationClass))));
    for (const item of invalid) {
      await store.settleItem(item.userId, item.id, item.claimToken, {
        status: "needs_review",
        lastError: "Candidate is incomplete or unsupported for Actual reconciliation",
      });
    }
    const valid = claimed.filter((item) => !invalid.includes(item));
    const previewItems = valid.filter((item) => item.status === "reconciling");
    const commitItems = valid.filter((item) => item.status === "importing");
    for (const [items, dryRun] of [[previewItems, true], [commitItems, false]] as const) {
      if (!items.length) continue;
      try {
        const result = await importGroups(items[0]!.userId, itemGroups(items), dryRun);
        await applyResults(items, result);
        if (!dryRun && result.groups.some((group) => group.items.some((item) => item.outcome === "added" || item.outcome === "updated"))) {
          await invalidateAfterCommit(items[0]!.userId).catch((error) => {
            console.error("[Transaction Imports] Post-import Actual invalidation failed:", conciseError(error));
          });
        }
      } catch (error) {
        await settleImportFailure(items, error);
      }
    }
    return true;
  }

  async function recoverStaleClaims(): Promise<Awaited<ReturnType<TransactionImportStore["recoverStaleClaims"]>>> {
    return store.recoverStaleClaims(now() - STALE_CLAIM_MS, MAX_ATTEMPTS);
  }

  async function recoverAbandonedHistoricalRuns(): Promise<Awaited<ReturnType<TransactionImportStore["recoverAbandonedHistoricalRuns"]>>> {
    return store.recoverAbandonedHistoricalRuns();
  }

  async function getNextWakeAt(): Promise<number | null> {
    return store.getNextWakeAt();
  }

  return {
    processNextHistoricalPage,
    processNextItemBatch,
    recoverStaleClaims,
    recoverAbandonedHistoricalRuns,
    getNextWakeAt,
  };
}

export const transactionImportWorker = createTransactionImportWorker();
