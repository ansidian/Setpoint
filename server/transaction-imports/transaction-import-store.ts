import type { Client } from "@libsql/client";
import db from "../db/connection.ts";
import type {
  TransactionImportItem, TransactionImportItemStatus, TransactionImportMapping,
  TransactionImportMode, TransactionImportPlanShadow, TransactionImportReconciliationStatus,
  TransactionImportRunDetail, TransactionImportRunStatus, TransactionImportRunSummary,
  TransactionImportRunTrigger, TransactionImportSource, TransactionImportMappingSource,
} from "../../shared/types/transaction-imports.ts";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import {
  projectTransactionImportItem as projectItem,
  projectTransactionImportMapping as projectMapping,
  projectTransactionImportRun as projectRun,
} from "./transaction-import-store-projections.ts";

type StoreDb = Pick<Client, "execute">;
export interface CreateRunInput {
  id: string;
  userId: string;
  trigger: TransactionImportRunTrigger;
  optionsKey: string;
  gmailAccountIds: string[];
  sources: TransactionImportSource[];
  startDate?: string | null;
  endDate?: string | null;
}

export interface InsertItemInput {
  id: string;
  runId: string;
  userId: string;
  gmailAccountId: string;
  gmailMessageId: string;
  emailUid: string;
  emailSubject?: string;
  internetMessageId?: string | null;
  candidateKey: string;
  source: TransactionImportSource;
  parserVersion: string;
  externalId?: string | null;
  importedId?: string | null;
  date: string | null;
  amountCents: number | null;
  currency: string | null;
  payee: string | null;
  notes?: string;
  actualAccountId?: string | null;
  actualCategoryId?: string | null;
  automationMode: "observe" | "automatic";
  automaticSafe: boolean;
  blockingWarnings: unknown[];
  evidence: unknown[];
  financialPlan?: FinancialEmailPlan | null;
  planShadow?: TransactionImportPlanShadow | null;
  status: TransactionImportItemStatus;
}

export interface ClaimedRun extends TransactionImportRunSummary {
  userId: string;
  claimToken: string;
}

export interface ClaimedItem extends TransactionImportItem {
  userId: string;
  claimToken: string;
}

function numberValue(value: unknown): number {
  return Number(value || 0);
}

export function createTransactionImportStore(dbClient: StoreDb = db, now = Date.now) {
  async function listMappings(userId: string): Promise<TransactionImportMapping[]> {
    const result = await dbClient.execute({
      sql: `SELECT * FROM ea_transaction_import_mappings WHERE user_id = ? ORDER BY source`,
      args: [userId],
    });
    return result.rows.map(projectMapping);
  }

  async function upsertMapping(userId: string, input: {
    source: TransactionImportMappingSource;
    mode: TransactionImportMode;
    actualAccountId?: string | null;
    actualCategoryId?: string | null;
  }): Promise<TransactionImportMapping> {
    const timestamp = now();
    await dbClient.execute({
      sql: `INSERT INTO ea_transaction_import_mappings
              (user_id, source, mode, actual_account_id, actual_category_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, source) DO UPDATE SET
              mode = excluded.mode,
              actual_account_id = excluded.actual_account_id,
              actual_category_id = excluded.actual_category_id,
              updated_at = excluded.updated_at`,
      args: [userId, input.source, input.mode, input.actualAccountId ?? null, input.actualCategoryId ?? null, timestamp, timestamp],
    });
    const result = await dbClient.execute({
      sql: `SELECT * FROM ea_transaction_import_mappings WHERE user_id = ? AND source = ?`,
      args: [userId, input.source],
    });
    return projectMapping(result.rows[0]!);
  }

  async function createRun(input: CreateRunInput): Promise<{ run: TransactionImportRunSummary; created: boolean }> {
    const timestamp = now();
    const result = await dbClient.execute({
      sql: `INSERT OR IGNORE INTO ea_transaction_import_runs
              (id, user_id, trigger, options_key, gmail_account_ids_json, sources_json,
               start_date, end_date, status, cursor_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', '{}', ?, ?)`,
      args: [
        input.id,
        input.userId,
        input.trigger,
        input.optionsKey,
        JSON.stringify(input.gmailAccountIds),
        JSON.stringify(input.sources),
        input.startDate ?? null,
        input.endDate ?? null,
        timestamp,
        timestamp,
      ],
    });
    if (Number(result.rowsAffected || 0) > 0) {
      const created = await getRun(input.userId, input.id);
      return { run: created!, created: true };
    }
    if (input.trigger === "arrival") {
      const existing = await getRun(input.userId, input.id);
      if (existing) return { run: existing, created: false };
    }
    const active = await dbClient.execute({
      sql: `SELECT * FROM ea_transaction_import_runs
            WHERE user_id = ? AND options_key = ? AND trigger = 'historical_scan'
              AND status IN ('queued', 'running', 'retry', 'paused')
            ORDER BY created_at ASC LIMIT 1`,
      args: [input.userId, input.optionsKey],
    });
    if (!active.rows[0]) throw new Error("Transaction import run could not be created");
    return { run: projectRun(active.rows[0]), created: false };
  }

  async function getRun(userId: string, runId: string): Promise<TransactionImportRunSummary | null> {
    const result = await dbClient.execute({
      sql: `SELECT * FROM ea_transaction_import_runs WHERE user_id = ? AND id = ?`,
      args: [userId, runId],
    });
    return result.rows[0] ? projectRun(result.rows[0]) : null;
  }

  async function listRuns(userId: string, limit = 12): Promise<TransactionImportRunSummary[]> {
    const result = await dbClient.execute({
      sql: `SELECT * FROM ea_transaction_import_runs
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?`,
      args: [userId, Math.max(1, Math.min(50, Math.trunc(limit)))],
    });
    return result.rows.map(projectRun);
  }

  async function resumePausedRun(userId: string, runId: string): Promise<boolean> {
    const result = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_runs SET status = 'retry', last_error = NULL,
              next_attempt_at = NULL, claim_token = NULL, claimed_at = NULL, updated_at = ?
            WHERE user_id = ? AND id = ? AND status = 'paused'`,
      args: [now(), userId, runId],
    });
    return Number(result.rowsAffected || 0) === 1;
  }

  async function getRunDetail(userId: string, runId: string): Promise<TransactionImportRunDetail | null> {
    const run = await getRun(userId, runId);
    if (!run) return null;
    const result = await dbClient.execute({
      sql: `SELECT * FROM ea_transaction_import_items WHERE user_id = ? AND run_id = ? ORDER BY created_at, id`,
      args: [userId, runId],
    });
    return { ...run, items: result.rows.map(projectItem) };
  }

  async function getItem(userId: string, itemId: string): Promise<TransactionImportItem | null> {
    const result = await dbClient.execute({
      sql: `SELECT * FROM ea_transaction_import_items WHERE user_id = ? AND id = ?`,
      args: [userId, itemId],
    });
    return result.rows[0] ? projectItem(result.rows[0]) : null;
  }

  async function listItemsForEmail(userId: string, emailUid: string): Promise<TransactionImportItem[]> {
    const result = await dbClient.execute({
      sql: `SELECT * FROM ea_transaction_import_items
            WHERE user_id = ? AND email_uid = ?
            ORDER BY updated_at DESC, created_at DESC, id DESC
            LIMIT 20`,
      args: [userId, emailUid],
    });
    return result.rows.map(projectItem);
  }

  async function confirmItem(userId: string, runId: string, itemId: string, input: {
    date: string;
    amountCents: number;
    payee: string;
    notes: string;
    actualAccountId: string;
    actualCategoryId: string | null;
  }): Promise<boolean> {
    const timestamp = now();
    const result = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_items SET
              transaction_date = ?, amount_cents = ?, payee = ?, notes = ?,
              actual_account_id = ?, actual_category_id = ?,
              imported_id = COALESCE(imported_id, gmail_message_id),
              status = 'queued', confirmed_at = ?, last_error = NULL,
              claim_token = NULL, claimed_at = NULL, next_attempt_at = NULL, updated_at = ?
            WHERE user_id = ? AND run_id = ? AND id = ?
              AND status IN ('needs_review', 'paused', 'failed', 'ready')`,
      args: [
        input.date, input.amountCents, input.payee, input.notes, input.actualAccountId,
        input.actualCategoryId, timestamp, timestamp, userId, runId, itemId,
      ],
    });
    return Number(result.rowsAffected || 0) === 1;
  }

  async function retryItem(userId: string, itemId: string): Promise<boolean> {
    const result = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_items SET
              status = CASE
                WHEN reconciliation_status IN ('would_add', 'would_update') THEN 'ready'
                ELSE 'queued'
              END,
              last_error = NULL, next_attempt_at = NULL, claim_token = NULL, claimed_at = NULL, updated_at = ?
            WHERE user_id = ? AND id = ? AND status IN ('failed', 'paused')`,
      args: [now(), userId, itemId],
    });
    return Number(result.rowsAffected || 0) === 1;
  }

  async function dismissItem(userId: string, itemId: string): Promise<boolean> {
    const timestamp = now();
    const result = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_items SET
              status = 'dismissed', dismissed_at = ?, claim_token = NULL, claimed_at = NULL,
              next_attempt_at = NULL, last_error = NULL, updated_at = ?
            WHERE user_id = ? AND id = ? AND status IN ('needs_review', 'paused', 'failed', 'ready')`,
      args: [timestamp, timestamp, userId, itemId],
    });
    return Number(result.rowsAffected || 0) === 1;
  }

  async function updateRunProgress(userId: string, runId: string, input: {
    cursor: Record<string, unknown>;
    status?: TransactionImportRunStatus;
    discovered?: number;
    parsed?: number;
    review?: number;
    queued?: number;
    failed?: number;
    lastError?: string | null;
  }): Promise<boolean> {
    const result = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_runs SET
              cursor_json = ?,
              status = COALESCE(?, status),
              discovered_count = discovered_count + ?,
              parsed_count = parsed_count + ?,
              review_count = review_count + ?,
              queued_count = queued_count + ?,
              failed_count = failed_count + ?,
              last_error = ?,
              updated_at = ?
            WHERE user_id = ? AND id = ?`,
      args: [
        JSON.stringify(input.cursor), input.status ?? null, input.discovered ?? 0, input.parsed ?? 0,
        input.review ?? 0, input.queued ?? 0, input.failed ?? 0, input.lastError ?? null,
        now(), userId, runId,
      ],
    });
    return Number(result.rowsAffected || 0) === 1;
  }

  async function incrementRunOutcomes(userId: string, runId: string, input: {
    added?: number;
    updated?: number;
    duplicate?: number;
    failed?: number;
  }): Promise<void> {
    await dbClient.execute({
      sql: `UPDATE ea_transaction_import_runs SET
              added_count = added_count + ?, updated_count = updated_count + ?,
              duplicate_count = duplicate_count + ?, failed_count = failed_count + ?, updated_at = ?
            WHERE user_id = ? AND id = ?`,
      args: [input.added ?? 0, input.updated ?? 0, input.duplicate ?? 0, input.failed ?? 0, now(), userId, runId],
    });
  }

  async function insertItem(input: InsertItemInput): Promise<boolean> {
    const timestamp = now();
    const result = await dbClient.execute({
      sql: `INSERT OR IGNORE INTO ea_transaction_import_items
              (id, run_id, user_id, gmail_account_id, gmail_message_id, email_uid, email_subject,
               internet_message_id, candidate_key, source, parser_version, external_id,
               imported_id, transaction_date, amount_cents, currency, payee, notes,
               actual_account_id, actual_category_id, automation_mode, automatic_safe,
               blocking_warnings_json, evidence_json, financial_email_plan_json,
               financial_plan_shadow_json, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.id, input.runId, input.userId, input.gmailAccountId, input.gmailMessageId,
        input.emailUid, input.emailSubject ?? "", input.internetMessageId ?? null, input.candidateKey, input.source,
        input.parserVersion, input.externalId ?? null, input.importedId ?? null, input.date,
        input.amountCents, input.currency, input.payee, input.notes ?? "", input.actualAccountId ?? null,
        input.actualCategoryId ?? null, input.automationMode, input.automaticSafe ? 1 : 0,
        JSON.stringify(input.blockingWarnings), JSON.stringify(input.evidence),
        input.financialPlan ? JSON.stringify(input.financialPlan) : null,
        input.planShadow ? JSON.stringify(input.planShadow) : null, input.status,
        timestamp, timestamp,
      ],
    });
    return Number(result.rowsAffected || 0) === 1;
  }

  async function claimNextRun(claimToken: string): Promise<ClaimedRun | null> {
    const timestamp = now();
    const selected = await dbClient.execute({
      sql: `SELECT * FROM ea_transaction_import_runs
            WHERE status IN ('queued', 'retry') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY created_at, id LIMIT 1`,
      args: [timestamp],
    });
    const row = selected.rows[0];
    if (!row) return null;
    const claimed = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_runs
            SET status = 'running', claim_token = ?, claimed_at = ?, attempts = attempts + 1,
                started_at = COALESCE(started_at, ?), updated_at = ?
            WHERE id = ? AND status IN ('queued', 'retry') AND claim_token IS NULL`,
      args: [claimToken, timestamp, timestamp, timestamp, String(row.id)],
    });
    if (Number(claimed.rowsAffected || 0) !== 1) return null;
    return {
      ...projectRun({ ...row, status: "running", attempts: numberValue(row.attempts) + 1, updated_at: timestamp }),
      userId: String(row.user_id),
      claimToken,
    };
  }

  async function claimNextItem(claimToken: string): Promise<ClaimedItem | null> {
    const timestamp = now();
    const selected = await dbClient.execute({
      sql: `SELECT * FROM ea_transaction_import_items
            WHERE status IN ('queued', 'ready') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY created_at, id LIMIT 1`,
      args: [timestamp],
    });
    const row = selected.rows[0];
    if (!row) return null;
    const nextStatus = row.status === "ready" ? "importing" : "reconciling";
    const claimed = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_items
            SET status = ?, claim_token = ?, claimed_at = ?, attempts = attempts + 1, updated_at = ?
            WHERE id = ? AND status = ? AND claim_token IS NULL`,
      args: [nextStatus, claimToken, timestamp, timestamp, String(row.id), String(row.status)],
    });
    if (Number(claimed.rowsAffected || 0) !== 1) return null;
    return {
      ...projectItem({ ...row, status: nextStatus, attempts: numberValue(row.attempts) + 1, updated_at: timestamp }),
      userId: String(row.user_id),
      claimToken,
    };
  }

  async function settleRun(userId: string, runId: string, claimToken: string, input: {
    status: TransactionImportRunStatus;
    cursor: Record<string, unknown>;
    discovered?: number;
    parsed?: number;
    review?: number;
    queued?: number;
    failed?: number;
    lastError?: string | null;
  }): Promise<boolean> {
    const timestamp = now();
    const terminal = input.status === "completed" || input.status === "failed";
    const result = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_runs SET
              status = ?, cursor_json = ?, discovered_count = discovered_count + ?,
              parsed_count = parsed_count + ?, review_count = review_count + ?,
              queued_count = queued_count + ?, failed_count = failed_count + ?,
              last_error = ?, claim_token = NULL, claimed_at = NULL,
              completed_at = CASE WHEN ? THEN ? ELSE completed_at END, updated_at = ?
            WHERE user_id = ? AND id = ? AND claim_token = ?`,
      args: [
        input.status, JSON.stringify(input.cursor), input.discovered ?? 0, input.parsed ?? 0,
        input.review ?? 0, input.queued ?? 0, input.failed ?? 0, input.lastError ?? null,
        terminal ? 1 : 0, timestamp, timestamp, userId, runId, claimToken,
      ],
    });
    return Number(result.rowsAffected || 0) === 1;
  }

  async function settleItem(userId: string, itemId: string, claimToken: string, input: {
    status: TransactionImportItemStatus;
    reconciliationStatus?: TransactionImportReconciliationStatus | null;
    lastError?: string | null;
    nextAttemptAt?: number | null;
    financialPlan?: FinancialEmailPlan | null;
  }): Promise<boolean> {
    const result = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_items
            SET status = ?, reconciliation_status = COALESCE(?, reconciliation_status), last_error = ?, next_attempt_at = ?,
                financial_email_plan_json = COALESCE(?, financial_email_plan_json),
                claim_token = NULL, claimed_at = NULL, updated_at = ?
            WHERE user_id = ? AND id = ? AND claim_token = ?`,
      args: [
        input.status, input.reconciliationStatus ?? null, input.lastError ?? null,
        input.nextAttemptAt ?? null, input.financialPlan ? JSON.stringify(input.financialPlan) : null,
        now(), userId, itemId, claimToken,
      ],
    });
    return Number(result.rowsAffected || 0) === 1;
  }

  async function persistFinancialPlanForEmail(
    userId: string,
    accountId: string,
    emailId: string,
    plan: FinancialEmailPlan,
  ): Promise<boolean> {
    const result = await dbClient.execute({
      sql: `UPDATE ea_email_triage
            SET financial_email_plan_json = ?, updated_at = datetime('now')
            WHERE user_id = ? AND account_id = ? AND email_id = ?`,
      args: [JSON.stringify(plan), userId, accountId, emailId],
    });
    return Number(result.rowsAffected || 0) === 1;
  }

  async function recoverStaleClaims(staleBefore: number, maxAttempts: number): Promise<{
    runsRecovered: number;
    runsFailed: number;
    itemsRecovered: number;
    itemsFailed: number;
  }> {
    const timestamp = now();
    const failedRuns = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_runs
            SET status = 'failed', claim_token = NULL, claimed_at = NULL,
                last_error = 'Transaction import run exceeded retry limit after interruption',
                completed_at = ?, updated_at = ?
            WHERE status = 'running' AND claimed_at <= ? AND attempts >= ?`,
      args: [timestamp, timestamp, staleBefore, maxAttempts],
    });
    const recoveredRuns = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_runs
            SET status = 'retry', claim_token = NULL, claimed_at = NULL,
                last_error = 'Transaction import run interrupted before completion', updated_at = ?
            WHERE status = 'running' AND claimed_at <= ? AND attempts < ?`,
      args: [timestamp, staleBefore, maxAttempts],
    });
    const failedItems = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_items
            SET status = 'failed', reconciliation_status = 'failed', claim_token = NULL, claimed_at = NULL,
                last_error = 'Transaction import item exceeded retry limit after interruption', updated_at = ?
            WHERE status IN ('reconciling', 'importing') AND claimed_at <= ? AND attempts >= ?`,
      args: [timestamp, staleBefore, maxAttempts],
    });
    const recoveredItems = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_items
            SET status = CASE WHEN status = 'importing' THEN 'ready' ELSE 'queued' END,
                claim_token = NULL, claimed_at = NULL,
                last_error = 'Transaction import item interrupted before completion', updated_at = ?
            WHERE status IN ('reconciling', 'importing') AND claimed_at <= ? AND attempts < ?`,
      args: [timestamp, staleBefore, maxAttempts],
    });
    return {
      runsRecovered: numberValue(recoveredRuns.rowsAffected),
      runsFailed: numberValue(failedRuns.rowsAffected),
      itemsRecovered: numberValue(recoveredItems.rowsAffected),
      itemsFailed: numberValue(failedItems.rowsAffected),
    };
  }

  async function recoverAbandonedHistoricalRuns(): Promise<{ runsRecovered: number }> {
    const timestamp = now();
    const recoveredRuns = await dbClient.execute({
      sql: `UPDATE ea_transaction_import_runs
            SET status = 'retry', claim_token = NULL, claimed_at = NULL,
                last_error = 'Transaction import run resumed after server restart', updated_at = ?
            WHERE trigger = 'historical_scan' AND status = 'running'`,
      args: [timestamp],
    });
    return {
      runsRecovered: numberValue(recoveredRuns.rowsAffected),
    };
  }
  async function getNextWakeAt(): Promise<number | null> {
    const timestamp = now();
    const result = await dbClient.execute({
      sql: `SELECT MIN(wake_at) AS next_wake_at FROM (
              SELECT MIN(COALESCE(next_attempt_at, ?)) AS wake_at FROM ea_transaction_import_runs WHERE status IN ('queued', 'retry')
              UNION ALL SELECT MIN(COALESCE(next_attempt_at, ?)) AS wake_at FROM ea_transaction_import_items WHERE status IN ('queued', 'ready')
            )`,
      args: [timestamp, timestamp],
    });
    const value = result.rows[0]?.next_wake_at;
    const nextWakeAt = value == null ? Number.NaN : Number(value);
    return Number.isFinite(nextWakeAt) ? nextWakeAt : null;
  }
  return {
    listMappings,
    upsertMapping,
    createRun,
    getRun,
    listRuns,
    resumePausedRun,
    getRunDetail,
    getItem,
    listItemsForEmail,
    confirmItem,
    retryItem,
    dismissItem,
    updateRunProgress,
    incrementRunOutcomes,
    insertItem,
    claimNextRun,
    settleRun,
    claimNextItem,
    settleItem,
    persistFinancialPlanForEmail,
    recoverStaleClaims,
    recoverAbandonedHistoricalRuns,
    getNextWakeAt,
  };
}

export type TransactionImportStore = ReturnType<typeof createTransactionImportStore>;
export const transactionImportStore = createTransactionImportStore();
