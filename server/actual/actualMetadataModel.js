// Pure derivation rules for the local Actual metadata cache: date coercion, rule
// JSON parsing/normalization, schedule type classification, and the metadata
// projection that maps raw db.sqlite rows into the shape readers consume. DB-free.
import { amountConditionCents } from "./actual-amount-condition.js";

export function ymdFromActualDate(value) {
  const raw = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw || null;
}

export function actualDateInt(value) {
  return Number(String(value || "").replace(/-/g, ""));
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function normalizeRuleConditions(value) {
  return parseJson(value, []).map((condition) => {
    const field = condition?.field === "description"
      ? "payee"
      : condition?.field === "acct"
        ? "account"
        : condition?.field;
    return { ...condition, field };
  });
}

export function classifySchedules(schedules, rawPayees) {
  const transferPayeeIds = new Set(rawPayees.filter((payee) => payee.transfer_acct).map((payee) => payee.id));
  return schedules.map((schedule) => {
    const payeeId = schedule.conditions?.find((condition) => condition.field === "payee")?.value;
    const signedAmt = amountConditionCents(schedule.conditions?.find((condition) => condition.field === "amount"));
    let type;
    if (transferPayeeIds.has(payeeId)) type = "transfer";
    else if (signedAmt > 0) type = "income";
    else type = "bill";
    return { ...schedule, type };
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
}) {
  const accounts = rawAccounts.rows.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
  }));
  const payees = rawPayees.rows
    .filter((payee) => payee.name && !payee.transfer_acct)
    .map((payee) => ({ id: payee.id, name: payee.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const payeeMap = Object.fromEntries(rawPayees.rows.map((payee) => [payee.id, payee.name || ""]));
  const categoriesByGroup = new Map();
  for (const category of rawCategories.rows) {
    if (!categoriesByGroup.has(category.cat_group)) categoriesByGroup.set(category.cat_group, []);
    categoriesByGroup.get(category.cat_group).push({ id: category.id, name: category.name });
  }
  const categories = rawGroups.rows
    .filter((group) => group.name !== "Internal")
    .map((group) => ({
      group_name: group.name,
      categories: categoriesByGroup.get(group.id) || [],
    }));
  const schedules = classifySchedules(rawSchedules.rows.map((schedule) => ({
    id: schedule.id,
    name: schedule.name,
    rule: schedule.rule,
    next_date: ymdFromActualDate(schedule.next_date),
    completed: !!schedule.completed,
    conditions: normalizeRuleConditions(schedule._conditions),
  })), rawPayees.rows);
  const recentTransactions = rawTransactions.rows.map((transaction) => ({
    payee: payeeMap[transaction.payee] || "",
    payeeId: transaction.payee,
    amount: Math.abs(Number(transaction.amount || 0)) / 100,
    date: ymdFromActualDate(transaction.date),
    scheduleId: transaction.schedule || null,
  }));

  return { accounts, payees, payeeMap, categories, schedules, recentTransactions };
}
