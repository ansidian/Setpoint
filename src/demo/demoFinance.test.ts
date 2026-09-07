import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinancialEventCompletionEntry } from '../../shared/types/financial-operations';

async function demo() {
  vi.resetModules();
  vi.stubEnv('VITE_EA_DEMO', '1');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-07T18:00:00Z'));
  vi.stubGlobal('fetch', () => { throw new Error('Demo reached network'); });
  vi.stubGlobal('EventSource', class { constructor() { throw new Error('Demo reached SSE'); } });
  vi.stubGlobal('localStorage', { setItem() { throw new Error('Demo persisted data'); } });
  return import('../api');
}
const date = '2026-09-07';
const managed = { owner: 'event' as const, id: 'demo-event-review' };
const imported = { owner: 'import' as const, id: 'demo-transaction-item-automatic', runId: 'demo-transaction-run-1' };

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

describe('shared fictional financial settlement', () => {
  it.each(['expense', 'income', 'transfer', 'bill'] as const)('projects managed %s completion and correction through the same ledger and bills', async kind => {
    const api = await demo();
    const before = await api.getDashboardFinance();
    const entry: FinancialEventCompletionEntry = { kind, amount: 23, date, accountId: 'demo-checking', fromAccountId: 'demo-checking', toAccountId: 'demo-savings', payee: 'Fictional Market', categoryId: 'demo-utilities' };
    await api.completeFinancialEvent({ emailUid: 'demo-email-budget', documentRevision: 1, eventRevision: 1, entry });
    const original = await api.getFinancialActivity(managed);
    expect(original.actions.correct).toBe(true);
    const inspection = await api.inspectFinancialCorrection(managed);
    expect(kind === 'bill' ? inspection.snapshot.schedules[0]?.id : inspection.snapshot.transactions[0]?.id).toBe(kind === 'bill' ? 'demo-completed-schedule' : 'demo-completed-review');
    const range = await api.getCalendarBillsRange(date, date);
    if (kind === 'bill') expect(range.schedules).toEqual(expect.arrayContaining([expect.objectContaining({ scheduleId: 'demo-completed-schedule', amount: 23 })]));
    else expect(range.transactions.filter(row => row.id.startsWith('demo-completed-'))).toHaveLength(kind === 'transfer' ? 0 : 1);
    expect((await api.getDashboardFinance()).spending.current?.total).toBeCloseTo(before.spending.current!.total! + (kind === 'expense' ? 23 : 0));
    const preview = await api.previewFinancialCorrection(managed, { type: kind === 'expense' ? 'payment' : kind, amountCents: 2900, date, accountId: 'demo-checking', fromAccountId: 'demo-checking', toAccountId: 'demo-savings', categoryId: 'demo-utilities' });
    await api.confirmFinancialCorrection(preview.id, 'same-key');
    expect((await api.resolveFinancialEmailPlan({ emailId: 'demo-email-budget' })).candidate).toMatchObject({ amount: 29, type: kind });
    expect((await api.getFinancialActivity(managed)).amountCents).toBe(kind === 'income' ? 2900 : -2900);
    const settled = await api.getCalendarBillsRange(date, date);
    await api.confirmFinancialCorrection(preview.id, 'same-key');
    expect(await api.getCalendarBillsRange(date, date)).toEqual(settled);
    expect((await api.getFinancialActivity(managed)).originalReceipts).toEqual(original.originalReceipts);
    expect((await api.getTransactionImportEmailStatus('demo-email-budget')).financialEvent?.workflow?.correction?.state).toBe('completed');
    expect((await api.getDashboardFinance()).spending.current?.total).toBeCloseTo(before.spending.current!.total! + (kind === 'expense' ? 29 : 0));
    if (kind === 'bill') expect((await api.getCurrentDashboard()).bills).toEqual(expect.arrayContaining([expect.objectContaining({ scheduleId: 'demo-completed-schedule', amount: 29 })]));
  });

  it('replaces the exact imported ledger row through payment, income, transfer, bill and retained-schedule conversions', async () => {
    const api = await demo();
    const original = await api.getFinancialActivity(imported);
    const before = await api.getDashboardFinance();
    for (const type of ['payment', 'income', 'transfer', 'bill', 'payment'] as const) {
      const preview = await api.previewFinancialCorrection(imported, { type, amountCents: 5000, date, accountId: 'demo-checking', fromAccountId: 'demo-savings', toAccountId: 'demo-checking', categoryId: 'demo-utilities', scheduleTreatment: 'keep' });
      await api.confirmFinancialCorrection(preview.id, preview.id);
      const status = await api.getTransactionImportEmailStatus('demo-email-cloud-receipt');
      expect(status.items[0]).toMatchObject({ correction: { state: 'completed' }, effectiveResult: { entry: { type, amountCents: 5000 } } });
      expect((await api.getDashboardFinance()).activity.recent[0]).toMatchObject({ amountCents: type === 'income' ? 5000 : -5000, status: 'updated' });
      const range = await api.getCalendarBillsRange(date, date);
      const current = await api.inspectFinancialCorrection(imported);
      expect(current.snapshot.transactions).toHaveLength(type === 'bill' ? 0 : type === 'transfer' ? 2 : 1);
      expect(range.transactions.filter(row => current.snapshot.transactions.some(raw => raw.id === row.id))).toHaveLength(type === 'transfer' ? 0 : current.snapshot.transactions.length);
      expect((await api.getDashboardFinance()).spending.current?.total).toBeCloseTo(before.spending.current!.total! - 38.47 + (type === 'payment' ? 50 : 0));
      if (type === 'bill') expect(range.schedules).toEqual(expect.arrayContaining([expect.objectContaining({ scheduleId: current.snapshot.schedules[0]?.id, amount: 50 })]));
      expect((await api.getFinancialActivity(imported)).originalReceipts).toEqual(original.originalReceipts);
    }
    const retire = await api.previewFinancialCorrection(imported, { type: 'payment', amountCents: 5000, date, accountId: 'demo-checking', scheduleTreatment: 'retire' });
    const scheduleId = retire.snapshot.schedules[0]!.id;
    await api.confirmFinancialCorrection(retire.id, 'retire');
    expect((await api.getCalendarBillsRange(date, date)).schedules.some(row => row.scheduleId === scheduleId)).toBe(false);
    const refreshed = await demo();
    expect((await refreshed.getFinancialActivity(imported)).effectiveResult).toBeNull();
    expect((await refreshed.getDashboardFinance()).spending.current?.total).toBe(before.spending.current?.total);
  });

  it('settles historical confirmation once and corrects its exact ledger identity', async () => {
    const api = await demo();
    const before = await api.getDashboardFinance();
    const reference = { owner: 'import' as const, id: 'demo-transaction-item-1', runId: imported.runId };
    const confirmation = { itemId: reference.id, date, amountCents: -1800, actualAccountId: 'demo-checking', actualCategoryId: 'demo-utilities' };
    expect(await api.commitTransactionImportItems(reference.runId, [confirmation])).toEqual({ accepted: 1 });
    expect(await api.commitTransactionImportItems(reference.runId, [confirmation])).toEqual({ accepted: 0 });
    expect((await api.getDashboardFinance()).spending.current?.total).toBeCloseTo(before.spending.current!.total! + 18);
    expect((await api.getCalendarBillsRange(date, date)).transactions.filter(row => row.id === reference.id)).toHaveLength(1);
    const original = await api.getFinancialActivity(reference);
    const preview = await api.previewFinancialCorrection(reference, { type: 'income', amountCents: 1800, date, accountId: 'demo-checking' });
    await api.confirmFinancialCorrection(preview.id, 'refund');
    expect((await api.getDashboardFinance()).spending.current?.total).toBeCloseTo(before.spending.current!.total!);
    expect((await api.getFinancialActivity(reference)).originalReceipts).toEqual(original.originalReceipts);
  });

  it('keeps two related bill emails and the full correction chain on one demo record', async () => {
    const api = await demo();
    const reference = { owner:'event' as const,id:'demo-event-partial' };
    const original = await api.getFinancialActivity(reference);
    expect(original.history?.emails.map(email => email.uid)).toEqual(['demo-electric-original','demo-electric-revised']);
    const times = original.history!.emails.map(email => email.receivedAt!);
    expect(times[0]).toBeLessThan(original.originalReceipts[0]!.capturedAt);
    expect(original.originalReceipts[0]!.capturedAt).toBeLessThan(times[1]!);
    expect(times[1]).toBeLessThan(original.history!.corrections[0]!.updatedAt);
    expect(await api.getEmailBody('demo-electric-original')).toMatchObject({ body:expect.stringContaining('ELEC-2048') });
    expect(await api.getEmailBody('demo-electric-revised')).toMatchObject({ body:expect.stringContaining('$90.00') });
    const inspection = await api.inspectFinancialCorrection(reference);
    const preview = await api.previewFinancialCorrection(reference,inspection.correction!.preview.draft);
    await api.confirmFinancialCorrection(preview.id,'finish-chain');
    const completed = await api.getFinancialActivity(reference);
    expect(completed.id).toBe(original.id);
    expect(completed.status).toBe('completed');
    expect(completed.originalReceipts).toEqual(original.originalReceipts);
    expect(completed.history?.emails).toEqual(original.history?.emails);
    expect(completed.history?.corrections).toMatchObject([
      { id:'demo-correction-partial',state:'superseded',steps:[{state:'partial'}] },
      { id:preview.id,predecessorId:'demo-correction-partial',state:'completed',steps:[{state:'applied'}] },
    ]);
    expect((await api.listFinancialActivity({view:'completed'})).items.filter(item => item.id === original.id)).toHaveLength(1);
    expect((await api.listFinancialActivity({view:'needs_attention'})).items.some(item => item.id === original.id)).toBe(false);
  });

  it('shares current schedule state across records and rejects another record’s stale preview', async () => {
    const api = await demo();
    const reference = { owner: 'event' as const, id: 'demo-event-schedule' };
    const partial = await api.inspectFinancialCorrection({ owner: 'event', id: 'demo-event-partial' });
    const first = await api.previewFinancialCorrection(reference, { type: 'bill', amountCents: 9100, date, accountId: 'demo-checking' });
    const second = await api.previewFinancialCorrection(partial.reference, partial.correction!.preview.draft);
    await api.confirmFinancialCorrection(second.id, 'partial');
    await expect(api.confirmFinancialCorrection(first.id, 'stale')).rejects.toMatchObject({ status: 409 });
    const left = await api.inspectFinancialCorrection(reference);
    const right = await api.inspectFinancialCorrection(partial.reference);
    expect(left.snapshot.rules).toEqual(right.snapshot.rules);
    expect(left.snapshot.dates).toEqual(right.snapshot.dates);
  });
});
