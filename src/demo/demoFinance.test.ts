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
    await api.completeFinancialEvent({ emailUid: 'demo-email-market-receipt', documentRevision: 1, eventRevision: 1, entry });
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
    expect((await api.resolveFinancialEmailPlan({ emailId: 'demo-email-market-receipt' })).candidate).toMatchObject({ amount: 29, type: kind });
    expect((await api.getFinancialActivity(managed)).amountCents).toBe(kind === 'income' ? 2900 : -2900);
    if (kind === 'expense') {
      const recorded = (await api.getFinances()).recordedHistory?.transactions.filter(row => row.id.startsWith('demo-completed-'));
      expect(recorded).toEqual([expect.objectContaining({ date, amountCents: -2900 })]);
    }
    const settled = await api.getCalendarBillsRange(date, date);
    await api.confirmFinancialCorrection(preview.id, 'same-key');
    expect(await api.getCalendarBillsRange(date, date)).toEqual(settled);
    expect((await api.getFinancialActivity(managed)).originalReceipts).toEqual(original.originalReceipts);
    expect((await api.getTransactionImportEmailStatus('demo-email-market-receipt')).financialEvent?.workflow?.correction?.state).toBe('completed');
    expect((await api.getDashboardFinance()).spending.current?.total).toBeCloseTo(before.spending.current!.total! + (kind === 'expense' ? 29 : 0));
    if (kind === 'bill') expect((await api.getCurrentDashboard()).bills).toEqual(expect.arrayContaining([expect.objectContaining({ scheduleId: 'demo-completed-schedule', amount: 29 })]));
  });

  it('creates a future transfer schedule without posting ledger activity or disguising it as a bill', async () => {
    const api = await demo();
    const before = await api.getDashboardFinance();
    const entry: FinancialEventCompletionEntry = { kind: 'transfer_schedule', amount: 250, date: '2026-09-14', fromAccountId: 'demo-checking', toAccountId: 'demo-savings', scheduleName: 'Savings transfer' };
    const plan = await api.completeFinancialEvent({ emailUid: 'demo-email-market-receipt', documentRevision: 1, eventRevision: 1, entry });
    expect(plan).toMatchObject({ candidate: { type: 'transfer', event_kind: 'payment_scheduled', amount: 250 }, operation: { intended: 'create_transfer_schedule' }, reconciliation: { status: 'already_scheduled' }, targets: { fromAccount: { id: 'demo-checking' }, toAccount: { id: 'demo-savings' }, schedule: { id: 'demo-completed-schedule' } } });
    const activity = await api.getFinancialActivity(managed);
    expect(activity).toMatchObject({ status: 'completed', originalReceipts: [{ input: entry, result: { scheduleId: 'demo-completed-schedule' } }] });
    const inspection = await api.inspectFinancialCorrection(managed);
    expect(inspection.snapshot.transactions).toHaveLength(0);
    expect(inspection.snapshot.schedules).toEqual([expect.objectContaining({ id: 'demo-completed-schedule', posts_transaction: false })]);
    const conditions = inspection.snapshot.rules[0]!.conditions as Array<{ field: string; value: unknown }>;
    expect(conditions).toEqual(expect.arrayContaining([{ field: 'amount', op: 'is', value: 25000 }, { field: 'account', op: 'is', value: 'demo-savings' }, { field: 'date', op: 'is', value: entry.date }]));
    const payeeId = conditions.find(condition => condition.field === 'payee')!.value;
    expect(inspection.snapshot.payees.find(payee => payee.id === payeeId)).toMatchObject({ transfer_acct: 'demo-checking' });
    const range = await api.getCalendarBillsRange(date, entry.date);
    expect(range.schedules).toEqual(expect.arrayContaining([expect.objectContaining({ scheduleId: 'demo-completed-schedule', type: 'transfer', amount: 250, next_date: entry.date })]));
    expect(range.transactions.some(row => row.id.startsWith('demo-completed-'))).toBe(false);
    expect((await api.getDashboardFinance()).spending.current?.total).toBe(before.spending.current?.total);
  });

  it.each([1, -1])('edits an exact scheduled transfer while preserving its %s direction and recurrence', async sign => {
    const api = await demo();
    const entry: FinancialEventCompletionEntry = { kind: 'transfer_schedule', amount: 250, date: '2026-09-14', fromAccountId: 'demo-checking', toAccountId: 'demo-savings', scheduleName: 'Savings transfer' };
    await api.completeFinancialEvent({ emailUid: 'demo-email-market-receipt', documentRevision: 1, eventRevision: 1, entry });
    const original = await api.getFinancialActivity(managed);
    const before = await api.inspectFinancialCorrection(managed);
    const recurring = structuredClone(before.snapshot);
    const recurrence = { frequency: 'monthly', interval: 1, patterns: [{ type: 'day', value: 14 }], start: entry.date };
    const conditions = recurring.rules[0]!.conditions as Array<{ field: string; value: unknown }>;
    const destinationPayee = recurring.payees.find(payee => payee.transfer_acct === 'demo-savings')!;
    recurring.rules[0]!.conditions = conditions.map(condition => condition.field === 'date' ? { ...condition, value: recurrence } : sign < 0 && condition.field === 'amount' ? { ...condition, value: -25000 } : sign < 0 && condition.field === 'account' ? { ...condition, value: 'demo-checking' } : sign < 0 && condition.field === 'payee' ? { ...condition, value: destinationPayee.id } : condition);
    recurring.rules[0]!.actions = [{ op: 'set', field: 'notes', value: 'Keep this note' }];
    const { publishDemoFinanceSnapshot } = await import('./financeProjection');
    publishDemoFinanceSnapshot(before.snapshot, recurring);
    const preview = await api.previewFinancialCorrection(managed, { type: 'transfer_schedule', amountCents: 31000, date: '2026-09-21', fromAccountId: 'demo-savings', toAccountId: 'demo-credit', targetScheduleId: 'demo-completed-schedule' });
    expect(preview.steps).toHaveLength(1);
    await api.confirmFinancialCorrection(preview.id, `edit-schedule-${sign}`);
    const after = await api.inspectFinancialCorrection(managed);
    expect(after.snapshot.transactions).toHaveLength(0);
    expect(after.snapshot.schedules[0]).toMatchObject({ id: 'demo-completed-schedule', rule: recurring.rules[0]!.id, posts_transaction: false });
    expect(after.snapshot.rules[0]!.actions).toEqual(recurring.rules[0]!.actions);
    const nextConditions = after.snapshot.rules[0]!.conditions as Array<{ field: string; value: unknown }>;
    expect(nextConditions).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'amount', value: sign * 31000 }), expect.objectContaining({ field: 'date', value: { ...recurrence, start: '2026-09-21' } }), expect.objectContaining({ field: 'account', value: sign > 0 ? 'demo-credit' : 'demo-savings' })]));
    const transferPayee = after.snapshot.payees.find(payee => payee.id === nextConditions.find(condition => condition.field === 'payee')!.value);
    expect(transferPayee).toMatchObject({ transfer_acct: sign > 0 ? 'demo-savings' : 'demo-credit' });
    expect((await api.getCalendarBillsRange(date, '2026-09-30')).schedules).toEqual(expect.arrayContaining([expect.objectContaining({ scheduleId: 'demo-completed-schedule', amount: 310, type: 'transfer', next_date: '2026-09-21' })]));
    expect((await api.resolveFinancialEmailPlan({ emailId: 'demo-email-market-receipt' })).candidate).toMatchObject({ type: 'transfer', event_kind: 'payment_scheduled', amount: 310 });
    expect((await api.getFinancialActivity(managed)).originalReceipts).toEqual(original.originalReceipts);
  });

  it('preserves linked historical payments when editing a transfer schedule and keeps schedule-only result identity', async () => {
    const api = await demo();
    await api.completeFinancialEvent({ emailUid: 'demo-email-market-receipt', documentRevision: 1, eventRevision: 1, entry: { kind: 'transfer_schedule', amount: 250, date: '2026-09-14', fromAccountId: 'demo-checking', toAccountId: 'demo-savings', scheduleName: 'Savings transfer' } });
    const before = await api.inspectFinancialCorrection(managed);
    const history = structuredClone(before.snapshot);
    history.transactions = [
      { id: 'linked-transfer-from', acct: 'demo-checking', description: 'demo-transfer-payee-demo-savings', amount: -25000, date: 20260901, transferred_id: 'linked-transfer-to', schedule: null, notes: 'Prior transfer', cleared: true, reconciled: true },
      { id: 'linked-transfer-to', acct: 'demo-savings', description: 'demo-transfer-payee-demo-checking', amount: 25000, date: 20260901, transferred_id: 'linked-transfer-from', schedule: 'demo-completed-schedule', notes: 'Prior transfer', cleared: true, reconciled: true },
    ];
    const { publishDemoFinanceSnapshot } = await import('./financeProjection');
    publishDemoFinanceSnapshot(before.snapshot, history);
    const journalBefore = await api.getFinanceJournal('2026-09-01', '2026-09-01');
    expect((await api.inspectFinancialCorrection(managed)).snapshot.transactions).toEqual(history.transactions);
    const draft = { type: 'transfer_schedule' as const, amountCents: 31000, date: '2026-09-21', fromAccountId: 'demo-checking', toAccountId: 'demo-savings', targetScheduleId: 'demo-completed-schedule' };
    const preview = await api.previewFinancialCorrection(managed, draft);
    await api.confirmFinancialCorrection(preview.id, 'edit-with-history');
    const after = await api.inspectFinancialCorrection(managed);
    expect(after.snapshot.transactions).toEqual(history.transactions);
    expect(await api.getFinanceJournal('2026-09-01', '2026-09-01')).toEqual(journalBefore);
    expect(after.evidence.objects.filter(object => object.role === 'primary')).toEqual([expect.objectContaining({ kind: 'schedule', id: 'demo-completed-schedule' })]);
    expect(after.evidence.objects.some(object => object.kind === 'transaction')).toBe(false);
    expect(after.correction?.effectiveResult).toMatchObject({ scheduleId: 'demo-completed-schedule', transactionId: undefined });
    const next = await api.previewFinancialCorrection(managed, { ...draft, amountCents: 32000 });
    expect(next.snapshot.transactions).toEqual(history.transactions);
    expect(next.steps).toHaveLength(1);
  });

  it('rejects scheduled-transfer corrections without an existing exact transfer schedule or future date', async () => {
    const api = await demo();
    const draft = { type: 'transfer_schedule' as const, amountCents: 25000, date: '2026-09-14', fromAccountId: 'demo-checking', toAccountId: 'demo-savings' };
    await expect(api.previewFinancialCorrection(imported, draft)).rejects.toThrow('exact existing transfer schedule');
    await api.completeFinancialEvent({ emailUid: 'demo-email-market-receipt', documentRevision: 1, eventRevision: 1, entry: { ...draft, kind: 'transfer_schedule', amount: 250 } });
    await expect(api.previewFinancialCorrection(managed, { ...draft, date })).rejects.toThrow('future date');
    await expect(api.previewFinancialCorrection(managed, { ...draft, categoryId: 'demo-utilities' })).rejects.toThrow('transfer accounts');
    await expect(api.previewFinancialCorrection(managed, { ...draft, targetScheduleId: 'some-other-schedule' })).rejects.toThrow('exact bound schedule');
  });

  it('does not turn an arrived transfer notice into a recorded payment', async () => {
    const api = await demo();
    await expect(api.completeFinancialEvent({ emailUid: 'demo-email-market-receipt', documentRevision: 1, eventRevision: 1, entry: { kind: 'transfer_schedule', amount: 250, date, fromAccountId: 'demo-checking', toAccountId: 'demo-savings' } })).rejects.toThrow('does not confirm a completed transfer');
    expect((await api.getFinancialActivity(managed)).status).toBe('needs_attention');
    expect((await api.getCalendarBillsRange(date, date)).schedules.some(row => row.scheduleId === 'demo-completed-schedule')).toBe(false);
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
    const source = (await api.getFinances()).utilities.find(utility => utility.identity.id === 'electricity')!.statements[0]!;
    expect(source).toMatchObject({ emailUid:'demo-electric-original', amountCents:8200, activity:reference });
    const inspection = await api.inspectFinancialCorrection(reference);
    const seeded = inspection.correction!;
    expect(seeded).toMatchObject({ state: 'attention', executionStopped: true, steps: [{ state: 'applied' }, { state: 'no_write' }] });
    expect(inspection.snapshot.rules[0]!.conditions).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'amount', value: -9000 })]));
    expect(inspection.snapshot.dates[0]!.local_next_date).toBe(20260921);
    expect(inspection.snapshot.schedules[0]!.rule).toBe(inspection.snapshot.rules[0]!.id);
    expect(inspection.snapshot.rules[0]!.actions).toEqual(expect.arrayContaining([{ op: 'link-schedule', value: inspection.snapshot.schedules[0]!.id }]));
    expect(inspection.snapshot.payees.some(payee => payee.id === seeded.preview.draft.payeeId)).toBe(true);
    expect(inspection.snapshot.rules[0]!.actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ field: 'notes' })]));
    const preview = await api.previewFinancialCorrection(reference,seeded.preview.draft);
    await api.confirmFinancialCorrection(preview.id,'finish-chain');
    const completed = await api.getFinancialActivity(reference);
    expect((await api.inspectFinancialCorrection(reference)).snapshot.rules[0]!.actions).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'notes', value: 'Revised bill ELEC-2048.' })]));
    expect(completed.id).toBe(original.id);
    expect(completed.status).toBe('completed');
    expect(completed.originalReceipts).toEqual(original.originalReceipts);
    expect(completed.history?.emails).toEqual(original.history?.emails);
    expect(completed.history?.corrections).toMatchObject([
      { id:'demo-correction-partial',state:'superseded',steps:[{state:'applied'},{state:'no_write'}] },
      { id:preview.id,predecessorId:'demo-correction-partial',state:'completed',steps:[{state:'applied'},{state:'applied'}] },
    ]);
    expect((await api.listFinancialActivity({view:'completed'})).items.filter(item => item.id === original.id)).toHaveLength(1);
    expect((await api.listFinancialActivity({view:'needs_attention'})).items.some(item => item.id === original.id)).toBe(false);
  });

  it('keeps the reviewed Actual result over plain HTTP without saving the failed note and permits a later explicit edit', async () => {
    // LAN HTTP exposes random bytes but not the secure-context randomUUID API.
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const api = await demo();
    const reference = { owner: 'event' as const, id: 'demo-event-partial' };
    const before = await api.inspectFinancialCorrection(reference);
    const journalBefore = await api.getFinanceJournal('2026-09-01', '2026-09-30');
    const preview = await api.previewKeepFinancialResult(reference, before.correction!.id);
    const kept = await api.confirmKeepFinancialResult(preview.id);
    expect(kept).toMatchObject({ state: 'completed', executionStopped: true, effectiveResult: { resolution: 'kept_actual', keepPreviewId: preview.id, entry: { type: 'bill', amountCents: 9000, date: '2026-09-21' } } });
    expect(kept.steps).toEqual(before.correction!.steps);
    expect(await api.confirmKeepFinancialResult(preview.id)).toEqual(kept);
    const after = await api.inspectFinancialCorrection(reference);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.snapshot.rules[0]!.actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ field: 'notes' })]));
    expect(await api.getFinanceJournal('2026-09-01', '2026-09-30')).toEqual(journalBefore);
    const activity = await api.getFinancialActivity(reference);
    expect(activity).toMatchObject({ status: 'completed', amountCents: -9000, correction: { resolution: 'kept_actual' }, history: { corrections: [expect.objectContaining({ resolution: 'kept_actual' })] } });
    expect(activity.originalReceipts).toEqual(before.originalReceipts);
    expect((await api.listFinancialActivity({ view: 'needs_attention' })).items.some(item => item.reference.id === reference.id)).toBe(false);
    const edit = await api.previewFinancialCorrection(reference, before.correction!.preview.draft);
    await api.confirmFinancialCorrection(edit.id, 'explicit-note-after-keep');
    expect((await api.inspectFinancialCorrection(reference)).snapshot.rules[0]!.actions).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'notes', value: 'Revised bill ELEC-2048.' })]));
  });

  it('rejects a stale keep snapshot without clearing attention and keeps ambiguous observed values without draft fallbacks', async () => {
    const api = await demo();
    const reference = { owner: 'event' as const, id: 'demo-event-partial' };
    const before = await api.inspectFinancialCorrection(reference);
    const preview = await api.previewKeepFinancialResult(reference, before.correction!.id);
    const changed = structuredClone(preview.snapshot);
    changed.rules[0]!.conditions = (changed.rules[0]!.conditions as Array<{ field: string; value: unknown }>).map(condition => condition.field === 'amount' ? { ...condition, op: 'isbetween', value: { num1: -9500, num2: -8500 } } : condition);
    const { publishDemoFinanceSnapshot } = await import('./financeProjection');
    publishDemoFinanceSnapshot(preview.snapshot, changed);
    await expect(api.confirmKeepFinancialResult(preview.id)).rejects.toThrow('Actual changed after this preview');
    expect((await api.getFinancialActivity(reference)).status).toBe('needs_attention');
    expect((await api.inspectFinancialCorrection(reference)).correction!.steps).toEqual(before.correction!.steps);
    const fresh = await api.previewKeepFinancialResult(reference, before.correction!.id);
    expect(fresh.id).not.toBe(preview.id);
    const kept = await api.confirmKeepFinancialResult(fresh.id);
    expect(kept.effectiveResult).toMatchObject({ resolution: 'kept_actual', snapshot: changed, entry: undefined });
    expect((await api.getFinancialActivity(reference)).amountCents).toBeNull();
  });

  it('rejects keeping a recovering or superseded correction', async () => {
    const api = await demo();
    const recovering = await api.inspectFinancialCorrection({ owner: 'event', id: 'demo-event-uncertain' });
    await expect(api.previewKeepFinancialResult(recovering.reference, recovering.correction!.id)).rejects.toThrow('has not stopped');
    const reference = { owner: 'event' as const, id: 'demo-event-partial' };
    const before = await api.inspectFinancialCorrection(reference);
    const keep = await api.previewKeepFinancialResult(reference, before.correction!.id);
    const successor = await api.previewFinancialCorrection(reference, before.correction!.preview.draft);
    await api.confirmFinancialCorrection(successor.id, 'new-correction');
    await expect(api.confirmKeepFinancialResult(keep.id)).rejects.toThrow('correction changed');
    expect((await api.getFinancialActivity(reference)).correction!.id).toBe(successor.id);
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
