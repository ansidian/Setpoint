import type { JournalRange, JournalTransaction, UtilityStatement } from '../../../shared/types/finances';
export const financeMoney = (cents:number|null) => cents === null ? 'Unavailable' : new Intl.NumberFormat('en-US',{ style:'currency', currency:'USD' }).format(cents / 100);
export const financeDate = (date:string|null) => date && Number.isFinite(Date.parse(date)) ? new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleDateString('en-US',{ month:'short', day:'numeric', year:'numeric' }) : 'Unavailable';
export function priorMonth(month:string):string { const date = new Date(`${month}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth()-1); return date.toISOString().slice(0,7); }
/** Only an exact reference or one source defines one obligation. Competing bills remain selectable. */
export function monthStatement(statements:UtilityStatement[], month:string):UtilityStatement|null {
  const rows = statements.filter(row => row.dueDate?.startsWith(month) && !row.issue);
  if (!rows.length) return null;
  const first = rows[0]!;
  if (rows.length > 1 && (!first.providerReference || rows.some(row => row.providerReference !== first.providerReference || row.amountCents !== first.amountCents || row.dueDate !== first.dueDate))) return null;
  return first;
}
export function statementComparison(statement:UtilityStatement|null, statements:UtilityStatement[]):string {
  if (!statement?.dueDate || statement.amountCents === null || statement.nothingDue) return 'Previous comparable bill unavailable';
  const previous = monthStatement(statements,priorMonth(statement.dueDate.slice(0,7)));
  if (!previous || previous.amountCents === null || previous.nothingDue || previous.amountKind !== statement.amountKind) return 'Previous comparable bill unavailable';
  if ((statement.carriedBalanceCents || 0) > 0 || (previous.carriedBalanceCents || 0) > 0) return 'Includes an earlier balance; new charges shown in history';
  const delta = statement.amountCents - previous.amountCents;
  const month = new Date(`${previous.dueDate!.slice(0,7)}-01T12:00:00`).toLocaleDateString('en-US',{month:'short'});
  return delta === 0 ? `Unchanged from ${month}` : `${financeMoney(Math.abs(delta))} ${delta > 0 ? 'higher' : 'lower'} than ${month}`;
}
export interface JournalEntry { id:string; transaction:JournalTransaction; children:JournalTransaction[]; counterpart:JournalTransaction|null; kind:'transaction'|'split'|'transfer'|'sent'|'received'; incomplete:boolean; ids:string[] }
export function journalEntries(range:JournalRange):JournalEntry[] {
  const all = new Map([...range.transactions,...range.relatives].map(row => [row.id,row]));
  const output:JournalEntry[] = [], consumed = new Set<string>();
  for (const seed of range.transactions) {
    const parent = seed.isChild && seed.parentId ? all.get(seed.parentId) : null;
    const row = parent?.isParent ? parent : seed;
    if (consumed.has(row.id)) continue;
    consumed.add(row.id);
    const children = row.isParent ? [...all.values()].filter(child => child.isChild && child.parentId === row.id) : [];
    children.forEach(child => consumed.add(child.id));
    const pair = row.transferId ? all.get(row.transferId) : null;
    const reciprocal = pair?.transferId === row.id && pair.amountCents === -row.amountCents && pair.accountId !== row.accountId;
    const counterpart = reciprocal ? pair! : null;
    const transfer = !!(row.transferId || row.transferAccountId);
    const sameDate = counterpart?.date === row.date;
    if (sameDate) consumed.add(counterpart!.id);
    output.push({ id:row.id, transaction:row, children, counterpart,
      kind:row.isParent ? 'split' : sameDate ? 'transfer' : transfer ? row.amountCents < 0 ? 'sent' : 'received' : 'transaction',
      incomplete:!!(row.isChild || (row.isParent && (!children.length || children.reduce((sum, child) => sum+child.amountCents,0) !== row.amountCents)) || (row.transferId && !counterpart)),
      ids:[row.id,...children.map(child => child.id),...(sameDate ? [counterpart!.id] : [])] });
  }
  return output.sort((a,b) => b.transaction.date.localeCompare(a.transaction.date) || a.id.localeCompare(b.id));
}
