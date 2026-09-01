// Pure derivation rules for the local Actual metadata cache: date coercion, rule
// JSON parsing/normalization, schedule type classification, and the metadata
// projection that maps raw db.sqlite rows into the shape readers consume. DB-free.
import { amountConditionCents } from "./actual-amount-condition.ts";
import type {
  ActualMetadata,
  ActualPayee,
  ActualSchedule,
  ActualScheduleCondition,
} from "../../shared/types/actual.ts";

type MetadataRow = Record<string, unknown>;

interface MetadataResultSets {
  rawAccounts: { rows: MetadataRow[] };
  rawPayees: { rows: MetadataRow[] };
  rawGroups: { rows: MetadataRow[] };
  rawCategories: { rows: MetadataRow[] };
  rawSchedules: { rows: MetadataRow[] };
  rawTransactions: { rows: MetadataRow[] };
}

function rowString(row: MetadataRow, key: string): string {
  return String(row[key] ?? "");
}

export function ymdFromActualDate(value: unknown): string | null {
  const raw = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw || null;
}

export function actualDateInt(value: unknown): number {
  return Number(String(value || "").replace(/-/g, ""));
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function normalizeRuleConditions(value: unknown): ActualScheduleCondition[] {
  return parseJson<ActualScheduleCondition[]>(value, []).map((condition) => {
    const field = condition?.field === "description"
      ? "payee"
      : condition?.field === "acct"
        ? "account"
        : condition?.field;
    return { ...condition, field };
  });
}

export function classifySchedules(schedules: ActualSchedule[], rawPayees: Array<Pick<ActualPayee, "id" | "transfer_acct">>): ActualSchedule[] {
  const transferAccountsByPayee = new Map(
    rawPayees
      .filter((payee) => payee.transfer_acct && payee.id)
      .map((payee) => [payee.id!, payee.transfer_acct!] as const),
  );
  return schedules.map((schedule) => {
    const payeeValue = schedule.conditions?.find((condition) => condition.field === "payee")?.value;
    const payeeId = typeof payeeValue === "string" ? payeeValue : undefined;
    const signedAmt = amountConditionCents(schedule.conditions?.find((condition) => condition.field === "amount"));
    let type: ActualSchedule["type"];
    if (payeeId && transferAccountsByPayee.has(payeeId)) type = "transfer";
    else if (signedAmt > 0) type = "income";
    else type = "bill";
    return {
      ...schedule,
      type,
      ...(type === "transfer" ? { transferAccountId: transferAccountsByPayee.get(payeeId!) || null } : {}),
    };
  });
}

// Pure projection of the six raw db.sqlite result sets into the metadata shape
// readLocalActualMetadata returns. Receives the libsql result objects verbatim so
// the row-mapping is unchanged from its in-place origin.
export function projectActualMetadata({
  rawAccounts,
  rawPayees,
  rawGroups,
  rawCategories,
  rawSchedules,
  rawTransactions,
}: MetadataResultSets): ActualMetadata {
  const accounts = rawAccounts.rows.map((account) => ({
    id: rowString(account, "id"),
    name: rowString(account, "name"),
    type: rowString(account, "type"),
  }));
  const payees = rawPayees.rows
    .filter((payee) => payee.name && !payee.transfer_acct)
    .map((payee) => ({ id: rowString(payee, "id"), name: rowString(payee, "name") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const payeeMap = Object.fromEntries(rawPayees.rows.map((payee) => [rowString(payee, "id"), rowString(payee, "name")]));
  const categoriesByGroup = new Map<string, Array<{ id: string; name: string }>>();
  for (const category of rawCategories.rows) {
    const groupId = rowString(category, "cat_group");
    if (!categoriesByGroup.has(groupId)) categoriesByGroup.set(groupId, []);
    categoriesByGroup.get(groupId)!.push({ id: rowString(category, "id"), name: rowString(category, "name") });
  }
  const categories = rawGroups.rows
    .filter((group) => group.name !== "Internal")
    .map((group) => ({
      group_name: rowString(group, "name"),
      categories: categoriesByGroup.get(rowString(group, "id")) || [],
    }));
  const schedules = classifySchedules(rawSchedules.rows.map((schedule) => ({
    id: rowString(schedule, "id"),
    name: rowString(schedule, "name"),
    rule: rowString(schedule, "rule"),
    next_date: ymdFromActualDate(schedule.next_date),
    completed: !!schedule.completed,
    conditions: normalizeRuleConditions(schedule._conditions),
  })), rawPayees.rows.map((payee) => ({
    id: rowString(payee, "id"),
    name: rowString(payee, "name"),
    transfer_acct: payee.transfer_acct ? String(payee.transfer_acct) : null,
  })));
  const recentTransactions = rawTransactions.rows.map((transaction) => ({
    payee: payeeMap[rowString(transaction, "payee")] || "",
    payeeId: rowString(transaction, "payee"),
    amount: Math.abs(Number(transaction.amount || 0)) / 100,
    date: ymdFromActualDate(transaction.date) || "",
    scheduleId: transaction.schedule ? String(transaction.schedule) : null,
  }));

  return { accounts, payees, payeeMap, categories, schedules, recentTransactions };
}
