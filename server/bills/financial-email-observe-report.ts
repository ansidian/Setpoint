import db from "../db/connection.ts";
import type { InStatement } from "@libsql/client";
import type {
  FinancialAutomationOperationClass,
  FinancialEmailObserveCounts,
  FinancialEmailObserveReport,
  FinancialEmailPlan,
  FinancialWorkflowObserveSummary,
} from "../../shared/types/bills.ts";

export type { FinancialEmailObserveCounts, FinancialEmailObserveReport } from "../../shared/types/bills.ts";

interface ObserveReportDb {
  execute(statement: InStatement): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const OPERATION_CLASSES: FinancialAutomationOperationClass[] = [
  "one_time_expense",
  "income",
  "utility_schedule",
  "transfer_schedule",
  "completed_transfer",
  "no_write",
  "unsupported",
];

function emptyCounts(): FinancialEmailObserveCounts {
  return {
    attempted: 0,
    eligible: 0,
    reviewed: 0,
    noWrite: 0,
    added: 0,
    updated: 0,
    duplicate: 0,
    failed: 0,
    unsafe: 0,
  };
}

function emptyReport(): FinancialEmailObserveReport {
  return {
    writesEnabled: false,
    sampled: 0,
    invalid: 0,
    truncated: false,
    byOperationClass: Object.fromEntries(OPERATION_CLASSES.map((key) => [key, emptyCounts()])) as FinancialEmailObserveReport["byOperationClass"],
  };
}

function parsePlan(value: unknown): FinancialEmailPlan | null {
  if (typeof value !== "string") return null;
  try {
    const plan = JSON.parse(value) as FinancialEmailPlan;
    return plan?.version === 1 && plan.identity?.version === 1
      && typeof plan.operation?.kind === "string"
      && typeof plan.automation?.eligible === "boolean"
      && typeof plan.automation?.operationClass === "string"
      && Array.isArray(plan.automation.gates)
      && plan.automation.gates.every((gate) => typeof gate?.status === "string") ? plan : null;
  } catch {
    return null;
  }
}

export function summarizeFinancialEmailObservePlans(plans: FinancialEmailPlan[]): FinancialEmailObserveReport {
  const report = emptyReport();
  report.sampled = plans.length;
  for (const plan of plans) {
    const operationClass = OPERATION_CLASSES.includes(plan.automation.operationClass) ? plan.automation.operationClass : "unsupported";
    const counts = report.byOperationClass[operationClass];
    counts.attempted++;
    if (plan.automation.eligible) counts.eligible++;
    if (plan.operation.kind === "review") counts.reviewed++;
    if (plan.operation.kind === "no_write") counts.noWrite++;
    if (plan.automation.eligible && plan.automation.gates.some((gate) => gate.status !== "pass" && gate.status !== "not_applicable")) {
      counts.unsafe++;
    }
  }
  return report;
}

async function readWorkflowSummary(dbClient: ObserveReportDb, userId: string, start: number, end: number): Promise<FinancialWorkflowObserveSummary> {
  // Aggregate durable rows directly. A missing plan or multiple supporting emails
  // must neither hide a failure nor inflate a ledger outcome.
  const result = await dbClient.execute({
    sql: `WITH documents AS (
            SELECT d.*, e.plan_json AS event_plan_json
            FROM ea_financial_documents d LEFT JOIN ea_financial_events e
              ON e.user_id = d.user_id AND e.id = d.event_id
            WHERE d.user_id = ? AND d.created_at >= ? AND d.created_at < ?
          ), document_counts AS (
            SELECT COUNT(*) AS documents_indexed,
              SUM(processed_revision > 0 OR json_type(candidate_json) = 'object') AS documents_assessed,
              SUM(json_type(candidate_json) = 'object') AS documents_financial,
              SUM(status = 'ignored') AS documents_ignored,
              SUM(status = 'pending') AS documents_pending,
              SUM(status = 'processing') AS documents_processing,
              SUM(status = 'retry') AS documents_retry,
              SUM(NULLIF(TRIM(last_error), '') IS NOT NULL) AS documents_failed,
              SUM(NULLIF(TRIM(last_error), '') IS NOT NULL AND COALESCE(json_type(event_plan_json), '') <> 'object') AS documents_unplannedFailures
            FROM documents
          ), events AS (
            SELECT *, json_extract(outcome_json, '$.outcome') AS outcome,
              json_type(plan_json) = 'object' AS has_plan,
              json_type(outcome_json, '$.transactionId') = 'text'
                AND NULLIF(TRIM(json_extract(outcome_json, '$.transactionId')), '') IS NOT NULL AS has_transaction,
              json_type(outcome_json, '$.scheduleId') = 'text'
                AND NULLIF(TRIM(json_extract(outcome_json, '$.scheduleId')), '') IS NOT NULL AS has_schedule
            FROM ea_financial_events WHERE user_id = ? AND created_at >= ? AND created_at < ?
          ), event_counts AS (
            SELECT COUNT(*) AS events_total,
              SUM(status = 'pending') AS events_pending,
              SUM(status = 'processing') AS events_processing,
              SUM(status = 'waiting') AS events_waiting,
              SUM(status = 'needs_review') AS events_needsReview,
              SUM(status = 'settled') AS events_settled,
              SUM(COALESCE(has_plan, 0)) AS events_planned,
              SUM(NOT COALESCE(has_plan, 0)) AS events_unplanned,
              SUM(NOT COALESCE(has_plan, 0) AND status IN ('waiting', 'needs_review')) AS events_unplannedFailures,
              SUM(attempted_at IS NOT NULL) AS events_attempted,
              SUM(outcome = 'added') AS events_added,
              SUM(outcome = 'updated') AS events_updated,
              SUM(outcome = 'already_present') AS events_alreadyPresent,
              SUM(outcome IN ('added', 'updated', 'already_present') AND has_transaction) AS events_recorded,
              SUM(outcome IN ('added', 'updated', 'already_present') AND has_schedule AND NOT COALESCE(has_transaction, 0)) AS events_scheduled,
              SUM(status = 'settled' AND outcome_json IS NULL AND operation_json IS NULL) AS events_noWrite
            FROM events
          ) SELECT document_counts.*, event_counts.* FROM document_counts, event_counts`,
    args: [userId, start, end, userId, start, end],
  });
  const row = result.rows[0] || {};
  const counts = <T extends Record<string, number>>(prefix: string, keys: string[]): T => Object.fromEntries(
    keys.map((key) => [key, Number(row[`${prefix}_${key}`] || 0)]),
  ) as T;
  return {
    window: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    documents: counts("documents", ["indexed", "assessed", "financial", "ignored", "pending", "processing", "retry", "failed", "unplannedFailures"]),
    events: counts("events", ["total", "pending", "processing", "waiting", "needsReview", "settled", "planned", "unplanned",
      "unplannedFailures", "attempted", "added", "updated", "alreadyPresent", "recorded", "scheduled", "noWrite"]),
  };
}

export async function readFinancialEmailObserveReport(
  userId: string,
  { dbClient = db, limit = 250, start, end }: { dbClient?: ObserveReportDb; limit?: number; start?: string | number; end?: string | number } = {},
): Promise<FinancialEmailObserveReport> {
  const endMs = end === undefined ? Date.now() : new Date(end).getTime();
  const startMs = start === undefined ? endMs - 30 * 86_400_000 : new Date(start).getTime();
  if (!userId.trim() || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    throw new TypeError("An owner and valid financial report window are required.");
  }
  const boundedLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
  const [result, workflow] = await Promise.all([dbClient.execute({
    sql: `SELECT financial_email_plan_json
          FROM ea_email_triage
          WHERE user_id = ? AND financial_email_plan_json IS NOT NULL
          ORDER BY updated_at DESC
          LIMIT ?`,
    args: [userId, boundedLimit + 1],
  }), readWorkflowSummary(dbClient, userId, startMs, endMs)]);
  const rows = result.rows.slice(0, boundedLimit);
  const plans = rows.map((row) => parsePlan(row.financial_email_plan_json));
  const report = summarizeFinancialEmailObservePlans(plans.filter((plan): plan is FinancialEmailPlan => Boolean(plan)));
  report.invalid = plans.filter((plan) => !plan).length;
  report.truncated = result.rows.length > boundedLimit;
  report.workflow = workflow;
  return report;
}
