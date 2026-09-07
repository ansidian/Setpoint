import type { Client } from "@libsql/client";
import type { DashboardFinanceActivity, DashboardFinanceActivityItem, DashboardFinanceReviewRunsResponse } from "../../shared/types/dashboard-finance.ts";
import { projectTransactionImportRun as projectRun } from "./transaction-import-store-projections.ts";

const DASHBOARD_REVIEW_FILTER = `(status IN ('needs_review', 'failed', 'paused') OR
  (status = 'ready' AND confirmed_at IS NULL AND (automation_mode = 'observe' OR automatic_safe = 0)))`;

export function createTransactionImportActivity(dbClient: Pick<Client, "execute">) {
  /** Bounded, redacted owner-wide projection; run previews are not a reliable review count. */
  async function readDashboardActivity(userId: string): Promise<DashboardFinanceActivity> {
    const columns = `id, run_id, email_uid, payee, amount_cents, currency, status, updated_at,
      actual_account_id,
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
      return {
        id: String(row.id), runId: String(row.run_id), emailUid: String(row.email_uid),
        payee: row.payee == null ? null : String(row.payee),
        amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
        currency: row.currency == null ? null : String(row.currency),
        status, description, updatedAt: Number(row.updated_at),
      };
    }
    return {
      status: "ready", reviewCount: Number(count.rows[0]?.total || 0),
      review: review.rows.map(project), recent: recent.rows.map(project), error: null,
    };
  }

  async function listReviewRuns(userId: string, limit = 12, offset = 0): Promise<DashboardFinanceReviewRunsResponse> {
    const pageLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(50, limit)) : 12;
    const pageOffset = Number.isSafeInteger(offset) ? Math.max(0, offset) : 0;
    const hasReview = `EXISTS (SELECT 1 FROM ea_transaction_import_items
      WHERE user_id = runs.user_id AND run_id = runs.id AND ${DASHBOARD_REVIEW_FILTER})`;
    const [count, page] = await Promise.all([
      dbClient.execute({
        sql: `SELECT COUNT(*) AS total FROM ea_transaction_import_runs AS runs WHERE user_id = ? AND ${hasReview}`,
        args: [userId],
      }),
      dbClient.execute({
        sql: `SELECT * FROM ea_transaction_import_runs AS runs WHERE user_id = ? AND ${hasReview}
              ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        args: [userId, pageLimit, pageOffset],
      }),
    ]);
    return { runs: page.rows.map(projectRun), total: Number(count.rows[0]?.total || 0), offset: pageOffset };
  }

  return { readDashboardActivity, listReviewRuns };
}
