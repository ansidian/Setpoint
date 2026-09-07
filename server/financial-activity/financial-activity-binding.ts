import type { Client } from "@libsql/client";
import db from "../db/connection.ts";
import { inspectOriginalImportBinding } from "../actual/actual.ts";
import type { FinancialBindingInspection, FinancialActivityReference } from "../../shared/types/financial-activity.ts";

/** Explicit inspection may bind an old exact imported identity; history reads never do this. */
export function createFinancialActivityBinding({ dbClient = db, inspect = inspectOriginalImportBinding }:
  { dbClient?: Pick<Client, "execute" | "batch">; inspect?: typeof inspectOriginalImportBinding } = {}) {
  return async (userId: string, reference: FinancialActivityReference, budgetId: string): Promise<FinancialBindingInspection> => {
    if (!userId || reference?.owner !== "import" || !reference.id || !reference.runId || typeof budgetId !== "string" || !budgetId.trim()) {
      throw Object.assign(new Error("An exact import record and selected budget are required"), { status: 400 });
    }
    const result = await dbClient.execute({ sql: `SELECT * FROM ea_financial_activity_occurrences
      WHERE user_id = ? AND owner = 'import' AND record_id = ? AND run_id = ?`, args: [userId, reference.id, reference.runId] });
    const occurrence = result.rows[0];
    if (!occurrence) throw Object.assign(new Error("Financial activity not found"), { status: 404 });
    const existing = await dbClient.execute({ sql: "SELECT * FROM ea_financial_actual_bindings WHERE user_id = ? AND activity_id = ?", args: [userId, occurrence.activity_id!] });
    if (existing.rows.some((row) => row.budget_id !== budgetId)) return { status: "wrong_budget", evidence: null };
    const budgets = await dbClient.execute({ sql: `SELECT COALESCE(json_extract(receipt.result_json, '$.budgetId'), json_extract(receipt.result_json, '$.evidence.budgetId')) AS budget_id
      FROM ea_financial_original_receipts receipt JOIN ea_financial_activity_occurrences source
        ON source.user_id = receipt.user_id AND source.owner = receipt.owner AND source.record_id = receipt.record_id
      WHERE source.user_id = ? AND source.activity_id = ?`, args: [userId, occurrence.activity_id!] });
    if (budgets.rows.some((row) => row.budget_id != null && row.budget_id !== budgetId)) return { status: "wrong_budget", evidence: null };
    const primary = existing.rows.filter((row) => row.kind === "transaction" && row.role === "primary");
    if (primary.length > 1) return { status: "ambiguous", evidence: null };
    const source = JSON.parse(String(occurrence.source_snapshot_json)) as { accountId?: string };
    if (!occurrence.original_imported_id || !source.accountId) return { status: "missing", evidence: null };
    let inspection: FinancialBindingInspection;
    try { inspection = await inspect(userId, budgetId, source.accountId, String(occurrence.original_imported_id), primary[0] ? String(primary[0].object_id) : undefined); }
    catch { return { status: "unavailable", evidence: null }; }
    if (inspection.status !== "resolved" || !inspection.evidence) return inspection;
    if (inspection.evidence.budgetId !== budgetId) return { status: "wrong_budget", evidence: null };
    const resolvedPrimary = inspection.evidence.objects.filter((object) => object.kind === "transaction" && object.role === "primary");
    if (resolvedPrimary.length !== 1 || (primary[0] && resolvedPrimary[0]!.id !== primary[0].object_id)) return { status: "ambiguous", evidence: null };
    const targetId = resolvedPrimary[0]!.id;
    const saved = await dbClient.batch([...inspection.evidence.objects.map((object) => ({
      sql: `INSERT OR IGNORE INTO ea_financial_actual_bindings (user_id, activity_id, budget_id, kind, object_id, role, evidence_json)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ea_financial_actual_bindings
          WHERE user_id = ? AND activity_id = ? AND (budget_id <> ? OR (kind = 'transaction' AND role = 'primary' AND object_id <> ?)))`,
      args: [userId, occurrence.activity_id!, budgetId, object.kind, object.id, object.role, JSON.stringify(object), userId, occurrence.activity_id!, budgetId, targetId],
    })), { sql: "SELECT budget_id, object_id FROM ea_financial_actual_bindings WHERE user_id = ? AND activity_id = ? AND kind = 'transaction' AND role = 'primary'",
      args: [userId, occurrence.activity_id!] }], "write");
    const persisted = saved.at(-1)!.rows;
    if (persisted.some((row) => row.budget_id !== budgetId)) return { status: "wrong_budget", evidence: null };
    if (persisted.length !== 1 || persisted[0]!.object_id !== targetId) return { status: "ambiguous", evidence: null };
    return inspection;
  };
}
export const resolveFinancialActivityBinding = createFinancialActivityBinding();
