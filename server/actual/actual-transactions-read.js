import {
  openLocalBudgetClient,
  ymdFromActualDate,
  actualDateInt,
} from "./actual-local-metadata.js";

const DEFAULT_LIMIT = 50;

function nameMap(rows) {
  return Object.fromEntries((rows || []).map((r) => [r.id, r.name || ""]));
}

function resolveName(value, rows) {
  if (value == null || value === "") return { ok: true, id: null };
  const target = String(value).toLowerCase();
  const match = (rows || []).find((r) => String(r.name || "").toLowerCase() === target);
  return match ? { ok: true, id: match.id } : { ok: false };
}

// Reads expense transactions from the on-disk budget copy (no SDK). "Spending" =
// outflows (amount < 0) that are not transfers; income (amount > 0) is excluded
// by the sign filter. Names are resolved from the same connection. Returns
// { unknownFilter } when a provided filter name does not exist, else
// { transactions, truncated }. Throws { status: 503 } when the copy is missing.
export async function readTransactionsRange(userId, filters = {}, options = {}) {
  const start = filters.start;
  const end = filters.end;
  const limit = Number.isFinite(filters.limit) ? filters.limit : DEFAULT_LIMIT;
  const minAmount = filters.minAmount ?? filters.min_amount;
  const maxAmount = filters.maxAmount ?? filters.max_amount;

  const client = await openLocalBudgetClient(userId, options);
  try {
    const [accountsR, payeesR, categoriesR] = await Promise.all([
      client.execute("SELECT id, name FROM accounts WHERE COALESCE(tombstone,0)=0"),
      client.execute("SELECT id, name, transfer_acct FROM payees WHERE COALESCE(tombstone,0)=0"),
      client.execute("SELECT id, name FROM categories WHERE COALESCE(tombstone,0)=0"),
    ]);
    const accountName = nameMap(accountsR.rows);
    const payeeName = nameMap(payeesR.rows);
    const categoryName = nameMap(categoriesR.rows);

    const checks = [
      ["payee", resolveName(filters.payee, payeesR.rows), filters.payee],
      ["category", resolveName(filters.category, categoriesR.rows), filters.category],
      ["account", resolveName(filters.account, accountsR.rows), filters.account],
    ];
    for (const [label, res, raw] of checks) {
      if (!res.ok) return { unknownFilter: `${label} '${raw}' not found` };
    }
    const [payeeF, categoryF, accountF] = checks.map(([, res]) => res.id);

    const clauses = [
      "COALESCE(t.tombstone,0)=0",
      "t.amount < 0",
      "t.date >= ?",
      "t.date <= ?",
      "t.payee NOT IN (SELECT id FROM payees WHERE transfer_acct IS NOT NULL AND COALESCE(tombstone,0)=0)",
    ];
    const args = [actualDateInt(start), actualDateInt(end)];
    if (payeeF) { clauses.push("t.payee = ?"); args.push(payeeF); }
    if (categoryF) { clauses.push("t.category = ?"); args.push(categoryF); }
    if (accountF) { clauses.push("t.account = ?"); args.push(accountF); }
    if (Number.isFinite(minAmount)) { clauses.push("ABS(t.amount) >= ?"); args.push(Math.round(minAmount * 100)); }
    if (Number.isFinite(maxAmount)) { clauses.push("ABS(t.amount) <= ?"); args.push(Math.round(maxAmount * 100)); }
    args.push(limit + 1);

    const result = await client.execute({
      sql: `SELECT t.id, t.date, t.amount, t.payee, t.category, t.account
            FROM v_transactions t
            WHERE ${clauses.join(" AND ")}
            ORDER BY t.date DESC
            LIMIT ?`,
      args,
    });
    const all = result.rows.map((r) => ({
      id: r.id,
      date: ymdFromActualDate(r.date),
      amount: Math.abs(Number(r.amount || 0)) / 100,
      payee: payeeName[r.payee] || "Unknown",
      category: categoryName[r.category] || "Uncategorized",
      account: accountName[r.account] || "",
    }));
    const truncated = all.length > limit;
    return { transactions: truncated ? all.slice(0, limit) : all, truncated };
  } finally {
    await client.close();
  }
}
