import type { JournalRange } from '../../../shared/types/finances';
import { journalEntries } from '../../components/finances/financeWorkspaceModel';
import type { JournalEntry } from '../../components/finances/financeWorkspaceModel';

export interface FinanceActivityDay {
  date: string;
  entries: JournalEntry[];
  incomeCents: number;
  outflowCents: number;
  transfers: number;
  transferCents: number;
  complete: boolean;
}

export function shiftFinanceDate(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function shiftFinanceMonth(month: string, offset: number): string {
  const next = new Date(`${month}-01T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + offset);
  return next.toISOString().slice(0, 7);
}

export function financeMonthRange(month: string, today: string) {
  const start = `${month}-01`;
  const last = shiftFinanceDate(`${shiftFinanceMonth(month, 1)}-01`, -1);
  return { start, end: last < today ? last : today };
}

export function financeMonthCells(month: string): string[] {
  const first = `${month}-01`;
  const offset = new Date(`${first}T12:00:00Z`).getUTCDay();
  return Array.from({ length: 42 }, (_, index) => shiftFinanceDate(first, index - offset));
}

/** Calendar and rows share the same exact split/transfer topology and date coverage. */
export function financeActivityDays(range: JournalRange, transactionId?: string): FinanceActivityDay[] {
  // An exact deep link can be hydrated outside the newest-record page. Only that
  // requested in-range record is an extra seed; relatives never widen coverage.
  const requested = range.relatives.find(row => row.id === transactionId && row.date >= range.start && row.date <= range.end);
  const selectedRange = requested && !range.transactions.some(row => row.id === requested.id)
    ? { ...range, transactions: [...range.transactions, requested] }
    : range;
  const groups = new Map<string, FinanceActivityDay>();
  for (let date = range.start; date <= range.end; date = shiftFinanceDate(date, 1)) {
    groups.set(date, { date, entries: [], incomeCents: 0, outflowCents: 0, transfers: 0, transferCents: 0, complete: !range.truncated });
  }
  for (const entry of journalEntries(selectedRange)) {
    const day = groups.get(entry.transaction.date);
    if (!day) continue;
    day.entries.push(entry);
    // Mixed transfer splits cannot use the parent's whole amount as cash flow.
    // Keep the source rows, but withhold a total until that topology is supported.
    if (entry.incomplete || entry.children.some(child => child.transferId || child.transferAccountId)) day.complete = false;
    if (entry.transaction.transferId || entry.transaction.transferAccountId || ['transfer', 'sent', 'received'].includes(entry.kind)) {
      day.transfers += 1;
      day.transferCents += Math.abs(entry.transaction.amountCents);
    } else if (entry.transaction.amountCents > 0) {
      day.incomeCents += entry.transaction.amountCents;
    } else {
      day.outflowCents -= entry.transaction.amountCents;
    }
  }
  return [...groups.values()].reverse();
}
