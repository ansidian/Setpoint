import db from "../db/connection.ts";
import type { InStatement } from "@libsql/client";
import type {
  FinancialAutomationOperationClass,
  FinancialEmailPlan,
} from "../../shared/types/bills.ts";

interface ObserveReportDb {
  execute(statement: InStatement): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface FinancialEmailObserveCounts {
  attempted: number;
  eligible: number;
  reviewed: number;
  noWrite: number;
  added: 0;
  updated: 0;
  duplicate: 0;
  failed: 0;
  unsafe: number;
}

export interface FinancialEmailObserveReport {
  writesEnabled: false;
  sampled: number;
  invalid: number;
  truncated: boolean;
  byOperationClass: Record<FinancialAutomationOperationClass, FinancialEmailObserveCounts>;
}

const OPERATION_CLASSES: FinancialAutomationOperationClass[] = [
  "one_time_expense",
  "income",
  "utility_schedule",
  "transfer_schedule",
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
    return plan?.version === 1 && plan.identity?.version === 1 && Boolean(plan.automation) ? plan : null;
  } catch {
    return null;
  }
}

export function summarizeFinancialEmailObservePlans(plans: FinancialEmailPlan[]): FinancialEmailObserveReport {
  const report = emptyReport();
  report.sampled = plans.length;
  for (const plan of plans) {
    const counts = report.byOperationClass[plan.automation.operationClass] || report.byOperationClass.unsupported;
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

export async function readFinancialEmailObserveReport(
  userId: string,
  { dbClient = db, limit = 250 }: { dbClient?: ObserveReportDb; limit?: number } = {},
): Promise<FinancialEmailObserveReport> {
  const boundedLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
  const result = await dbClient.execute({
    sql: `SELECT financial_email_plan_json
          FROM ea_email_triage
          WHERE user_id = ? AND financial_email_plan_json IS NOT NULL
          ORDER BY updated_at DESC
          LIMIT ?`,
    args: [userId, boundedLimit + 1],
  });
  const rows = result.rows.slice(0, boundedLimit);
  const plans = rows.map((row) => parsePlan(row.financial_email_plan_json));
  const report = summarizeFinancialEmailObservePlans(plans.filter((plan): plan is FinancialEmailPlan => Boolean(plan)));
  report.invalid = plans.filter((plan) => !plan).length;
  report.truncated = result.rows.length > boundedLimit;
  return report;
}
