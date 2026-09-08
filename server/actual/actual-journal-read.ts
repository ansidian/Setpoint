import type { Row } from '@libsql/client';
import { openLocalBudgetClient, actualDateInt, ymdFromActualDate } from './actual-local-metadata.ts';
import type { JournalRange, JournalTransaction } from '../../shared/types/finances.ts';

const columns = `t.id, t.date, t.amount, t.payee, t.account, t.category, t.notes,
  t.schedule, t.transfer_id, t.parent_id, t.is_parent, t.is_child, t.cleared, t.reconciled`;
const nullable = (value: unknown) => value == null || value === '' ? null : String(value);

/** Read the selected dates and exact relatives without syncing or mutating Actual. */
export async function readJournalRange(userId: string, range: { start: string; end: string; transactionId?: string; limit?: number },
  options: Parameters<typeof openLocalBudgetClient>[1] = {}): Promise<JournalRange> {
  const { start, end } = range;
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!valid(start) || !valid(end) || start > end || Date.parse(end) - Date.parse(start) > 366 * 86400000) {
    throw Object.assign(new Error('Choose a valid Journal range of at most twelve months.'), { status: 400 });
  }
  const limit = Math.max(1, Math.min(2000, Math.floor(range.limit || 500)));
  const client = await openLocalBudgetClient(userId, options);
  try {
    const [accounts, payees, categories, selected] = await Promise.all([
      client.execute('SELECT id, name FROM accounts'), client.execute('SELECT id, name FROM payees'),
      client.execute('SELECT id, name FROM categories'),
      client.execute({ sql: `SELECT ${columns} FROM v_transactions t WHERE COALESCE(t.tombstone,0)=0
        AND t.date >= ? AND t.date <= ? ORDER BY t.date DESC, t.id LIMIT ?`, args: [actualDateInt(start), actualDateInt(end), limit + 1] }),
    ]);
    const names = (rows: Row[]) => new Map(rows.map(row => [String(row.id), String(row.name || '')]));
    const accountNames = names(accounts.rows), payeeNames = names(payees.rows), categoryNames = names(categories.rows);
    const project = (row: Row): JournalTransaction => ({
      id: String(row.id), date: ymdFromActualDate(row.date) || '', amountCents: Number(row.amount),
      payee: payeeNames.get(String(row.payee)) || 'Unknown payee', payeeId: nullable(row.payee),
      account: accountNames.get(String(row.account)) || 'Unavailable account', accountId: String(row.account || ''),
      category: categoryNames.get(String(row.category)) || 'Uncategorized', notes: String(row.notes || ''),
      scheduleId: nullable(row.schedule), transferId: nullable(row.transfer_id), parentId: nullable(row.parent_id),
      isParent: Number(row.is_parent) === 1, isChild: Number(row.is_child) === 1,
      cleared: Number(row.cleared) === 1, reconciled: Number(row.reconciled) === 1,
    });
    const transactions = selected.rows.slice(0, limit).map(project);
    const all = new Map(transactions.map(row => [row.id, row]));
    // Three bounded passes hydrate a selected child’s parent/siblings and transfer counterparts.
    for (let pass = 0; pass < 3; pass++) {
      const ids = [...new Set([...all.values()].flatMap(row => [row.parentId, row.transferId]).concat(range.transactionId || null))]
        .filter((id): id is string => !!id && !all.has(id));
      const parents = [...all.values()].filter(row => row.isParent).map(row => row.id);
      for (let offset = 0; offset < Math.max(ids.length, parents.length); offset += 250) {
        const idChunk = ids.slice(offset, offset + 250), parentChunk = parents.slice(offset, offset + 250);
        const clauses: string[] = [], args: string[] = [];
        if (idChunk.length) { clauses.push(`t.id IN (${idChunk.map(() => '?').join(',')})`); args.push(...idChunk); }
        if (parentChunk.length) { clauses.push(`t.parent_id IN (${parentChunk.map(() => '?').join(',')})`); args.push(...parentChunk); }
        const relatives = await client.execute({ sql: `SELECT ${columns} FROM v_transactions t WHERE COALESCE(t.tombstone,0)=0 AND (${clauses.join(' OR ')}) LIMIT 4001`, args });
        if (relatives.rows.length > 4000) throw Object.assign(new Error('Journal relationships exceed the read limit.'), { status: 422 });
        for (const row of relatives.rows) { const item = project(row); all.set(item.id, item); }
      }
    }
    const seedIds = new Set(transactions.map(row => row.id));
    return { start, end, transactions, relatives: [...all.values()].filter(row => !seedIds.has(row.id)), truncated: selected.rows.length > limit };
  } finally { await client.close(); }
}
