import type { FinancialObjectEvidence, FinancialWriteEvidence } from "../../shared/types/financial-activity.ts";

export interface ActualEvidencePort {
  internal: { db?: { all(sql: string, parameters?: unknown[]): Promise<Array<Record<string, unknown>>> } };
}

export function objectEvidence(kind: FinancialObjectEvidence["kind"], row: Record<string, unknown>,
  role: FinancialObjectEvidence["role"] = "primary"): FinancialObjectEvidence {
  return { kind, id: String(row.id), role, provenance: "matched", beforeState: "captured", before: structuredClone(row), after: structuredClone(row) };
}

/** Raw SDK database values: never the import preview's display-unit amount. */
export async function readOriginalTransactions(sdk: ActualEvidencePort, accountId: string): Promise<Array<Record<string, unknown>>> {
  if (!sdk.internal.db) throw new Error("Actual exact transaction evidence is unavailable");
  return sdk.internal.db.all("SELECT * FROM transactions WHERE acct = ? OR id IN (SELECT transferred_id FROM transactions WHERE acct = ?)", [accountId, accountId]);
}

export function transactionEvidence(rows: Array<Record<string, unknown>>, primary: Record<string, unknown>): FinancialObjectEvidence[] {
  const own = [primary, ...rows.filter((row) => row.parent_id === primary.id && row.isChild)];
  const paired = rows.filter((row) => own.some((entry) => entry.transferred_id === row.id));
  return [...own.map((row) => objectEvidence("transaction", row, row.id === primary.id ? "primary" : "split_child")),
    ...paired.map((row) => objectEvidence("transaction", row, "counterpart"))];
}

/** Parent and generated children are retained as independent exact resources. */
export async function readOriginalSchedule(sdk: ActualEvidencePort, budgetId: string, scheduleId: string): Promise<FinancialWriteEvidence | null> {
  if (!sdk.internal.db) return null;
  const parents = await sdk.internal.db.all("SELECT * FROM schedules WHERE id = ?", [scheduleId]);
  const parent = parents[0];
  if (!parent) return { budgetId, objects: [] };
  const rules = await sdk.internal.db.all("SELECT * FROM rules WHERE id = ?", [parent.rule]);
  const dates = await sdk.internal.db.all("SELECT * FROM schedules_next_date WHERE schedule_id = ?", [scheduleId]);
  return { budgetId, objects: [objectEvidence("schedule", parent),
    ...rules.map((row) => objectEvidence("rule", row, "schedule_rule")),
    ...dates.map((row) => objectEvidence("schedule_next_date", row, "next_date"))] };
}

export async function readOriginalResult(sdk: ActualEvidencePort, budgetId: string,
  result: { transactionId?: string; scheduleId?: string }): Promise<FinancialWriteEvidence | null> {
  if (!sdk.internal.db) return null;
  if (result.scheduleId) return readOriginalSchedule(sdk, budgetId, result.scheduleId);
  if (!result.transactionId) return { budgetId, objects: [] };
  const rows = await sdk.internal.db.all("SELECT * FROM transactions WHERE id = ?", [result.transactionId]);
  const row = rows[0];
  if (!row) return null;
  const graph = await readOriginalTransactions(sdk, String(row.acct));
  return { budgetId, objects: transactionEvidence(graph, row) };
}

/** Join only durable pre-dispatch evidence; recovery never invents a before-image. */
export function settleOriginalEvidence(observed: FinancialWriteEvidence | null | undefined,
  prepared: FinancialWriteEvidence | null | undefined, provenance: "created" | "updated" | "matched" | "unknown"): FinancialWriteEvidence | undefined {
  if (!observed) return undefined;
  return { budgetId: observed.budgetId, objects: observed.objects.map((object) => {
    const before = prepared?.budgetId === observed.budgetId
      ? prepared.objects.find((entry) => entry.kind === object.kind && entry.id === object.id) : undefined;
    return { ...object, provenance: before ? provenance === "created" ? "updated" : provenance : provenance,
      beforeState: before ? "captured" : prepared && (provenance === "created" || provenance === "updated") ? "confirmed_absent" : "unknown",
      before: before?.before || null };
  }) };
}
