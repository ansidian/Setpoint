import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOwnerStore } from "../auth/owner-store.ts";
import {
  readImportedTransactionStates,
  readTransactionsRange,
} from "../actual/actual-transactions-read.ts";
import {
  hydrateLocalActualCache,
  readLocalActualMetadata,
} from "../actual/actual-local-metadata.ts";
import { createFinancialEmailPlanner } from "../bills/financial-email-planner.ts";
import { readBillsMirrorRange } from "../bills/bills-mirror-sync.ts";
import db from "../db/connection.ts";
import { readTransactionImportEquivalenceReport } from "../transaction-imports/transaction-import-equivalence-report.ts";

async function main(): Promise<void> {
  const owner = await createOwnerStore().getOwner();
  const userId = process.argv[2] || process.env.EA_USER_ID || owner?.userId;
  if (!userId) throw new Error("No owner found. Pass a user id or set EA_USER_ID.");

  const cacheDir = await mkdtemp(path.join(tmpdir(), "setpoint-actual-replay-"));
  try {
    await hydrateLocalActualCache(userId, { dataDir: cacheDir });
    const planner = createFinancialEmailPlanner({
      metadataReader: async (id) => ({
        ...await readLocalActualMetadata(id, { dataDir: cacheDir, localOnly: true }),
        syncHealth: { state: "current", lastSuccessAt: new Date().toISOString() },
      }),
      occurrenceReader: readBillsMirrorRange,
      transactionReader: async (id, filters) => readTransactionsRange(id, filters, {
        dataDir: cacheDir,
        localOnly: true,
      }),
      targetRanker: async () => ({ status: "failed", key: null, confidence: null, evidence: null }),
    });
    const importedRows = await db.execute({
      sql: `SELECT imported_id FROM ea_transaction_import_items
            WHERE user_id = ? AND source IN ('amazon', 'paypal') AND imported_id IS NOT NULL`,
      args: [userId],
    });
    const actualStates = await readImportedTransactionStates(
      userId,
      importedRows.rows.map((row) => String(row.imported_id)),
      {
        dataDir: cacheDir,
        localOnly: true,
      },
    );
    const report = await readTransactionImportEquivalenceReport(userId, planner, { actualStates });
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 2;
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
