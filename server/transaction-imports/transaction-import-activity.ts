import type { Client } from "@libsql/client";
import type { DashboardFinanceActivity, DashboardFinanceActivityItem } from "../../shared/types/dashboard-finance.ts";

const DASHBOARD_REVIEW_FILTER = `EXISTS (SELECT 1 FROM ea_transaction_import_runs run WHERE run.user_id = ea_transaction_import_items.user_id AND run.id = ea_transaction_import_items.run_id AND run.trigger = 'arrival') AND (status IN ('needs_review', 'failed', 'paused') OR
  (status = 'ready' AND confirmed_at IS NULL AND (automation_mode = 'observe' OR automatic_safe = 0)))`;

export function createTransactionImportActivity(dbClient: Pick<Client, "execute">) {
  /** Bounded, redacted owner-wide projection; run previews are not a reliable review count. */
  async function readDashboardActivity(userId: string): Promise<DashboardFinanceActivity> {
    const columns = `id, run_id, email_uid, payee, amount_cents, currency, status, updated_at,
      actual_account_id,
      (SELECT c.effective_result_json FROM ea_financial_effective_corrections c
        JOIN ea_financial_activity_occurrences o ON o.user_id=c.user_id AND o.activity_id=c.activity_id
        WHERE o.user_id=ea_transaction_import_items.user_id AND o.owner='import' AND o.record_id=ea_transaction_import_items.id) AS effective_result_json,
      CASE WHEN json_valid(financial_email_plan_json)
        THEN json_extract(financial_email_plan_json, '$.operation.intended') END AS operation`;
    const [count, review, recent] = await Promise.all([
      dbClient.execute({
        sql: `SELECT COUNT(*) AS total FROM ea_transaction_import_items
              WHERE user_id = ? AND ${DASHBOARD_REVIEW_FILTER}`,
        args: [userId],
      }),
      dbClient.execute({
        sql: `SELECT ${columns} FROM ea_transaction_import_items
              WHERE user_id = ? AND ${DASHBOARD_REVIEW_FILTER}
              ORDER BY updated_at DESC, id DESC LIMIT 3`,
        args: [userId],
      }),
      dbClient.execute({
        sql: `SELECT ${columns} FROM ea_transaction_import_items
              WHERE user_id = ? AND automation_mode = 'automatic' AND confirmed_at IS NULL
                AND status IN ('added', 'updated', 'already_present')
              ORDER BY updated_at DESC, id DESC LIMIT 3`,
        args: [userId],
      }),
    ]);
    function project(row: typeof review.rows[number]): DashboardFinanceActivityItem {
      const status = String(row.status) as DashboardFinanceActivityItem["status"];
      const transfer = row.operation === "create_transfer_schedule";
      const description = status === "failed" ? "Import failed · review or retry"
        : status === "paused" ? "Import paused · review or retry"
        : status === "needs_review" || status === "ready" ? (row.actual_account_id ? "Review transaction details" : "Choose an account")
        : status === "already_present" ? (transfer ? "Transfer already scheduled or recorded" : "Already recorded in Actual")
        : status === "updated" ? "Updated in Actual"
        : transfer ? "Transfer scheduled in Actual" : "Recorded in Actual";
      const effective = typeof row.effective_result_json === 'string'
        ? JSON.parse(row.effective_result_json) as { resolution?: string; entry?: { type?: string; amountCents?: number; payee?: string } } : null;
      const kept = effective?.resolution === 'kept_actual';
      return {
        id: String(row.id), runId: String(row.run_id), emailUid: String(row.email_uid),
        payee: effective?.entry?.payee ?? (row.payee == null ? null : String(row.payee)),
        amountCents: effective?.entry?.amountCents ?? (kept || row.amount_cents == null ? null : Number(row.amount_cents)),
        currency: row.currency == null ? null : String(row.currency),
        status, description: kept ? "Current Actual result kept" : effective ? effective.entry?.type === 'bill' ? "Corrected schedule in Actual" : "Corrected record in Actual" : description, updatedAt: Number(row.updated_at),
      };
    }
    return {
      status: "ready", reviewCount: Number(count.rows[0]?.total || 0),
      review: review.rows.map(project), recent: recent.rows.map(project), error: null,
    };
  }

  return { readDashboardActivity };
}
