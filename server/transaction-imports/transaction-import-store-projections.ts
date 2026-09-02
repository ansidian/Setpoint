import type { Row } from "@libsql/client";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import type {
  TransactionImportItem,
  TransactionImportItemStatus,
  TransactionImportExecutionMode,
  TransactionImportPlanShadow,
  TransactionImportReconciliationStatus,
  TransactionImportRunStatus,
  TransactionImportRunSummary,
  TransactionImportRunTrigger,
  TransactionImportSource,
} from "../../shared/types/transaction-imports.ts";

function numberValue(value: unknown): number {
  return Number(value || 0);
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function projectTransactionImportRun(row: Row): TransactionImportRunSummary {
  return {
    id: String(row.id),
    trigger: String(row.trigger) as TransactionImportRunTrigger,
    status: String(row.status) as TransactionImportRunStatus,
    gmailAccountIds: parseJson<string[]>(row.gmail_account_ids_json, []),
    sources: parseJson<TransactionImportSource[]>(row.sources_json, []),
    startDate: nullableString(row.start_date),
    endDate: nullableString(row.end_date),
    cursor: parseJson<Record<string, unknown>>(row.cursor_json, {}),
    counts: {
      discovered: numberValue(row.discovered_count),
      parsed: numberValue(row.parsed_count),
      review: numberValue(row.review_count),
      queued: numberValue(row.queued_count),
      added: numberValue(row.added_count),
      updated: numberValue(row.updated_count),
      duplicate: numberValue(row.duplicate_count),
      failed: numberValue(row.failed_count),
    },
    attempts: numberValue(row.attempts),
    lastError: nullableString(row.last_error),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

export function projectTransactionImportItem(row: Row): TransactionImportItem {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    gmailAccountId: String(row.gmail_account_id),
    gmailMessageId: String(row.gmail_message_id),
    emailUid: String(row.email_uid),
    emailSubject: String(row.email_subject || ""),
    internetMessageId: nullableString(row.internet_message_id),
    source: String(row.source) as TransactionImportSource,
    parserVersion: String(row.parser_version),
    externalId: nullableString(row.external_id),
    importedId: nullableString(row.imported_id),
    date: nullableString(row.transaction_date),
    amountCents: row.amount_cents == null ? null : numberValue(row.amount_cents),
    currency: nullableString(row.currency),
    payee: nullableString(row.payee),
    notes: String(row.notes || ""),
    actualAccountId: nullableString(row.actual_account_id),
    actualCategoryId: nullableString(row.actual_category_id),
    automationMode: String(row.automation_mode) as TransactionImportExecutionMode,
    automaticSafe: numberValue(row.automatic_safe) === 1,
    blockingWarnings: parseJson<unknown[]>(row.blocking_warnings_json, []),
    evidence: parseJson<unknown[]>(row.evidence_json, []),
    financialPlan: parseJson<FinancialEmailPlan | null>(row.financial_email_plan_json, null),
    planShadow: parseJson<TransactionImportPlanShadow | null>(row.financial_plan_shadow_json, null),
    status: String(row.status) as TransactionImportItemStatus,
    reconciliationStatus: nullableString(row.reconciliation_status) as TransactionImportReconciliationStatus | null,
    attempts: numberValue(row.attempts),
    lastError: nullableString(row.last_error),
    confirmedAt: row.confirmed_at == null ? null : numberValue(row.confirmed_at),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}
