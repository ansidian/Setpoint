import type { ActualScheduleCondition } from '../../shared/types/actual.ts';
import type { CorrectionRow, CorrectionSnapshot, CorrectionTargets } from '../../shared/types/financial-corrections.ts';
import type { ActualEvidencePort } from './actualOriginalEvidence.ts';

export function correctionJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(correctionJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${correctionJson(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function decodeCorrectionJson(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Invalid Actual rule graph');
  return parsed;
}
export async function readCorrectionSnapshot(sdk: ActualEvidencePort, budgetId: string, targets: CorrectionTargets): Promise<CorrectionSnapshot> {
  if (!sdk.internal.db) throw new Error('Exact Actual graph reads are unavailable');
  const all = async (sql: string, args: unknown[] = []) => await sdk.internal.db!.all(sql, args) as CorrectionRow[];
  const select = async (table: string, field: string, ids: string[]) => ids.length
    ? all(`SELECT * FROM ${table} WHERE ${field} IN (${ids.map(() => '?').join(',')})`, ids) : [];
  const primary = await select('transactions', 'id', targets.transactionIds);
  const scheduleIds = [...new Set([...targets.scheduleIds, ...primary.flatMap(row => row.schedule ? [String(row.schedule)] : [])])];
  const schedules = [...await select('schedules', 'id', scheduleIds), ...await select('schedules', 'rule', targets.ruleIds)];
  const rawRules = await all('SELECT * FROM rules');
  // Orphan link rules are evidence even when their parent was never committed.
  const rules = rawRules.filter(row => targets.ruleIds.includes(row.id) || schedules.some(s => s.rule === row.id)
    || decodeCorrectionJson(row.actions).some(action => action && typeof action === 'object'
      && 'op' in action && action.op === 'link-schedule' && 'value' in action && scheduleIds.includes(String(action.value))));
  const dates = await select('schedules_next_date', 'schedule_id', scheduleIds);
  const linked = await select('transactions', 'schedule', scheduleIds);
  const ids = [...new Set([...primary, ...linked].flatMap(row => [row.id, ...(row.transferred_id ? [String(row.transferred_id)] : [])]))];
  const transactions = [...await select('transactions', 'id', ids), ...await select('transactions', 'parent_id', ids)];
  const unique = (rows: CorrectionRow[]) => [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => a.id.localeCompare(b.id));
  return { budgetId, transactions: unique(transactions), schedules: unique(schedules), rules: unique(rules), dates: unique(dates),
    accounts: unique(await all('SELECT * FROM accounts')), payees: unique(await all('SELECT * FROM payees')),
    categories: unique(await all('SELECT * FROM categories')), scheduleNames: unique(await all('SELECT id, name FROM schedules WHERE tombstone = 0')) };
}

export function correctionConditions(value: unknown): ActualScheduleCondition[] {
  const fields: Record<string, string> = { acct: 'account', description: 'payee' };
  return decodeCorrectionJson(value).map(condition => {
    const row = condition as Record<string, unknown>;
    return { ...row, field: fields[String(row.field)] || row.field };
  }) as ActualScheduleCondition[];
}
