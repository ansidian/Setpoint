import crypto from "node:crypto";
import db from "../db/connection.ts";
import type { InStatement } from "@libsql/client";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import type {
  TransactionImportItemStatus,
  TransactionImportSource,
} from "../../shared/types/transaction-imports.ts";
import {
  attachTransactionImportFinancialPlans,
  transactionImportPlannerInput,
  type TransactionImportFinancialPlanner,
} from "./transaction-import-planner-adapter.ts";
import type { InsertItemInput } from "./transaction-import-store.ts";

export interface ReplayActualTransactionState {
  importedId: string;
  tombstoned: boolean;
  accountId: string | null;
  categoryId: string | null;
}

interface ReplayDb {
  execute(statement: InStatement): Promise<{ rows: Array<Record<string, unknown>> }>;
}

interface ReplayDiscrepancy {
  key: string;
  source: TransactionImportSource;
  legacyStatus: TransactionImportItemStatus;
  codes: string[];
}

export interface TransactionImportEquivalenceReport {
  writesEnabled: false;
  sampled: number;
  bySource: Record<TransactionImportSource, number>;
  byLegacyStatus: Partial<Record<TransactionImportItemStatus, number>>;
  canonical: { plannable: number; preserved: number; containedReview: number };
  targets: {
    account: { required: number; match: number; mismatch: number; unresolved: number };
    category: { required: number; match: number; mismatch: number; unresolved: number };
  };
  reconciliation: {
    committed: number;
    current: number;
    tombstoned: number;
    missing: number;
    duplicateSuppressed: number;
    tombstonesContained: number;
    reviewItems: number;
    reviewContained: number;
  };
  automation: { observeOnly: number; contained: number; eligible: number; unsafe: number };
  discrepancies: ReplayDiscrepancy[];
  passed: boolean;
}

const COMMITTED_STATUSES = new Set<TransactionImportItemStatus>([
  "added",
  "updated",
  "already_present",
]);

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function replayItem(row: Record<string, unknown>): InsertItemInput {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    userId: String(row.user_id),
    gmailAccountId: String(row.gmail_account_id),
    gmailMessageId: String(row.gmail_message_id),
    emailUid: String(row.email_uid),
    emailSubject: String(row.email_subject || ""),
    internetMessageId: nullableString(row.internet_message_id),
    candidateKey: String(row.candidate_key),
    source: String(row.source) as TransactionImportSource,
    parserVersion: String(row.parser_version),
    externalId: nullableString(row.external_id),
    importedId: nullableString(row.imported_id),
    date: nullableString(row.transaction_date),
    amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
    currency: nullableString(row.currency),
    payee: nullableString(row.payee),
    notes: String(row.notes || ""),
    actualAccountId: nullableString(row.actual_account_id),
    actualCategoryId: nullableString(row.actual_category_id),
    automationMode: String(row.automation_mode) === "automatic" ? "automatic" : "observe",
    automaticSafe: Number(row.automatic_safe || 0) === 1,
    blockingWarnings: parseJson(row.blocking_warnings_json, []),
    evidence: parseJson(row.evidence_json, []),
    status: String(row.status) as TransactionImportItemStatus,
  };
}

function opaqueItemKey(item: InsertItemInput): string {
  return crypto.createHash("sha256")
    .update(`${item.source}:${item.importedId || item.id}`)
    .digest("hex")
    .slice(0, 12);
}

function canonicalPreserved(item: InsertItemInput, plan: FinancialEmailPlan | null): boolean {
  const input = transactionImportPlannerInput(item);
  const source = input?.candidate?.transaction_import;
  const candidate = plan?.candidate;
  const plannedSource = candidate?.transaction_import;
  return Boolean(
    input
    && plan
    && plan.identity.status === "resolved"
    && input.providerMessageId === item.importedId
    && source?.externalId === item.externalId
    && source?.importedId === item.importedId
    && source?.amountCents === item.amountCents
    && source?.currency === item.currency
    && input.candidate?.payee === item.payee
    && input.candidate?.due_date === item.date
    && input.candidate?.notes === item.notes
    && input.candidate?.amount === Math.abs(item.amountCents || 0) / 100
    && plannedSource?.externalId === item.externalId
    && plannedSource?.importedId === item.importedId
    && plannedSource?.amountCents === item.amountCents
    && plannedSource?.currency === item.currency
    && candidate?.due_date === item.date
    && candidate?.notes === item.notes
  );
}

function emptyTargetCounts() {
  return { required: 0, match: 0, mismatch: 0, unresolved: 0 };
}

export function summarizeTransactionImportEquivalence(
  sourceItems: InsertItemInput[],
  plannedItems: InsertItemInput[],
  actualStates: Record<string, ReplayActualTransactionState> = {},
): TransactionImportEquivalenceReport {
  const report: TransactionImportEquivalenceReport = {
    writesEnabled: false,
    sampled: sourceItems.length,
    bySource: { amazon: 0, paypal: 0 },
    byLegacyStatus: {},
    canonical: { plannable: 0, preserved: 0, containedReview: 0 },
    targets: { account: emptyTargetCounts(), category: emptyTargetCounts() },
    reconciliation: {
      committed: 0,
      current: 0,
      tombstoned: 0,
      missing: 0,
      duplicateSuppressed: 0,
      tombstonesContained: 0,
      reviewItems: 0,
      reviewContained: 0,
    },
    automation: { observeOnly: 0, contained: 0, eligible: 0, unsafe: 0 },
    discrepancies: [],
    passed: false,
  };

  sourceItems.forEach((item, index) => {
    const planned = plannedItems[index];
    const plan = planned?.financialPlan || null;
    const shadow = planned?.planShadow || null;
    const actualState = item.importedId ? actualStates[item.importedId] : undefined;
    const codes: string[] = [];
    report.bySource[item.source]++;
    report.byLegacyStatus[item.status] = (report.byLegacyStatus[item.status] || 0) + 1;

    const plannerInput = transactionImportPlannerInput(item);
    if (plannerInput) {
      report.canonical.plannable++;
      if (canonicalPreserved(item, plan)) report.canonical.preserved++;
      else codes.push("canonical_mismatch");
    } else if (item.status === "needs_review") {
      report.canonical.containedReview++;
    } else {
      codes.push("canonical_fields_missing");
    }

    for (const [kind, liveId] of [
      ["account", item.actualAccountId],
      ["category", item.actualCategoryId],
    ] as const) {
      if (!liveId || (!plannerInput && item.status === "needs_review")) continue;
      const counts = report.targets[kind];
      counts.required++;
      const historicalId = kind === "account" ? actualState?.accountId : actualState?.categoryId;
      const agreement = shadow?.[kind].agreement === "match" || historicalId === liveId
        ? "match"
        : shadow?.[kind].agreement || "unresolved";
      counts[agreement]++;
      if (agreement !== "match") codes.push(`${kind}_${agreement}`);
    }

    if (COMMITTED_STATUSES.has(item.status)) {
      report.reconciliation.committed++;
      if (!actualState) {
        report.reconciliation.missing++;
        codes.push("actual_commit_missing");
      } else if (actualState.tombstoned) {
        report.reconciliation.tombstoned++;
        if (!plan?.automation.eligible) report.reconciliation.tombstonesContained++;
        else codes.push("tombstone_not_contained");
      } else {
        report.reconciliation.current++;
      }
      if (!actualState?.tombstoned && plan?.reconciliation.status === "already_recorded" && plan.operation.kind === "no_write") {
        report.reconciliation.duplicateSuppressed++;
      } else if (!actualState?.tombstoned) {
        codes.push("duplicate_not_suppressed");
      }
    }
    if (item.status === "needs_review") {
      report.reconciliation.reviewItems++;
      if (!plannerInput || (plan && !plan.automation.eligible && plan.operation.kind !== "create_transaction")) {
        report.reconciliation.reviewContained++;
      } else {
        codes.push("review_not_contained");
      }
    }

    if (plan?.automation.rollout === "observe_only") report.automation.observeOnly++;
    if ((!plan && item.status === "needs_review") || (plan?.automation.rollout === "observe_only" && !plan.automation.eligible)) {
      report.automation.contained++;
    } else {
      codes.push("not_safely_contained");
    }
    if (plan?.automation.eligible) report.automation.eligible++;
    const unsafe = Boolean(
      plan?.automation.eligible
      || (COMMITTED_STATUSES.has(item.status) && !actualState?.tombstoned && plan?.operation.kind !== "no_write")
    );
    if (unsafe) report.automation.unsafe++;

    if (codes.length) {
      report.discrepancies.push({
        key: opaqueItemKey(item),
        source: item.source,
        legacyStatus: item.status,
        codes,
      });
    }
  });

  report.passed = report.sampled > 0
    && report.canonical.plannable + report.canonical.containedReview === report.sampled
    && report.canonical.preserved === report.canonical.plannable
    && report.targets.account.match === report.targets.account.required
    && report.targets.category.match === report.targets.category.required
    && report.reconciliation.missing === 0
    && report.reconciliation.duplicateSuppressed === report.reconciliation.current
    && report.reconciliation.tombstonesContained === report.reconciliation.tombstoned
    && report.reconciliation.reviewContained === report.reconciliation.reviewItems
    && report.automation.contained === report.sampled
    && report.automation.eligible === 0
    && report.automation.unsafe === 0
    && report.discrepancies.length === 0;
  return report;
}

export async function readTransactionImportEquivalenceReport(
  userId: string,
  planner: TransactionImportFinancialPlanner,
  {
    dbClient = db,
    actualStates = {},
  }: { dbClient?: ReplayDb; actualStates?: Record<string, ReplayActualTransactionState> } = {},
): Promise<TransactionImportEquivalenceReport> {
  const result = await dbClient.execute({
    sql: `SELECT id, run_id, user_id, gmail_account_id, gmail_message_id, email_uid,
                 email_subject, internet_message_id, candidate_key, source, parser_version,
                 external_id, imported_id, transaction_date, amount_cents, currency, payee,
                 notes, actual_account_id, actual_category_id, automation_mode, automatic_safe,
                 blocking_warnings_json, evidence_json, status
          FROM ea_transaction_import_items
          WHERE user_id = ? AND source IN ('amazon', 'paypal')
          ORDER BY created_at ASC, id ASC`,
    args: [userId],
  });
  const items = result.rows.map(replayItem);
  const planned = await attachTransactionImportFinancialPlans(userId, items, planner);
  return summarizeTransactionImportEquivalence(items, planned, actualStates);
}
