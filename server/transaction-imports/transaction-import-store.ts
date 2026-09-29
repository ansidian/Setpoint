import type { Client } from "@libsql/client";
import db from "../db/connection.ts";
import type { TransactionImportItem } from "../../shared/types/transaction-imports.ts";
import { createTransactionImportActivity } from "./transaction-import-activity.ts";
import { projectTransactionImportItem as projectItem } from "./transaction-import-store-projections.ts";

/** Read-only saved import history; the import queue no longer admits or executes work. */
export function createTransactionImportStore(dbClient: Pick<Client, "execute"> = db) {
  const { readDashboardActivity } = createTransactionImportActivity(dbClient);
  async function listItemsForEmail(userId: string, emailUid: string): Promise<TransactionImportItem[]> {
    const result = await dbClient.execute({
      sql: `SELECT ea_transaction_import_items.*, (SELECT run.trigger FROM ea_transaction_import_runs run WHERE run.user_id = ea_transaction_import_items.user_id AND run.id = ea_transaction_import_items.run_id) AS run_trigger, (SELECT c.effective_result_json FROM ea_financial_effective_corrections c
              JOIN ea_financial_activity_occurrences o ON o.user_id=c.user_id AND o.activity_id=c.activity_id
              WHERE o.user_id=ea_transaction_import_items.user_id AND o.owner='import' AND o.record_id=ea_transaction_import_items.id) AS effective_result_json,
            (SELECT json_object('id', c.id, 'state', c.state, 'revision', c.revision) FROM ea_financial_corrections c
              JOIN ea_financial_activity_occurrences o ON o.user_id=c.user_id AND o.activity_id=c.activity_id
              WHERE o.user_id=ea_transaction_import_items.user_id AND o.owner='import' AND o.record_id=ea_transaction_import_items.id
              ORDER BY c.rowid DESC LIMIT 1) AS correction_json
            FROM ea_transaction_import_items
            WHERE user_id = ? AND email_uid = ?
            ORDER BY updated_at DESC, created_at DESC, id DESC
            LIMIT 20`,
      args: [userId, emailUid],
    });
    return result.rows.map(row => ({ ...projectItem(row),
      ...(typeof row.correction_json === 'string' ? { correction: JSON.parse(row.correction_json) as TransactionImportItem['correction'] } : {}),
      ...(typeof row.effective_result_json === 'string' ? { effectiveResult: JSON.parse(row.effective_result_json) as TransactionImportItem['effectiveResult'] } : {}) }));
  }

  return { listItemsForEmail, readDashboardActivity };
}

export const transactionImportStore = createTransactionImportStore();
