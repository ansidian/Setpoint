import type { Client } from '@libsql/client';
import { projectTransactionImportItem } from './transaction-import-store-projections.ts';
import type { TransactionImportStore } from './transaction-import-store.ts';

export async function readImportRun(db: Client, store: TransactionImportStore, userId: string, runId: string) {
  const run = await store.getRun(userId, runId);
  if (!run) return null;
  const rows = await db.execute({ sql: 'SELECT * FROM ea_transaction_import_items WHERE user_id = ? AND run_id = ? ORDER BY created_at, id', args: [userId, runId] });
  return { ...run, items: rows.rows.map(projectTransactionImportItem) };
}
