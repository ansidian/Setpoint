import actualApi from '@actual-app/api';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { createTestTempDir, removeTempDir } from '../test-utils/temp-dir.ts';
import { createFinancialActivityReader } from '../financial-activity/financial-activity.ts';
import { createFinancialEventStore } from '../financial-events/financial-event-store.ts';
import { createFinancialCorrectionStore } from './financial-correction-store.ts';
import { createFinancialCorrections } from './financial-corrections.ts';
import { correctionConditions, readCorrectionSnapshot } from '../actual/actualCorrectionEvidence.ts';
import { executeCorrectionStep, type ActualCorrectionPort } from '../actual/actualCorrectionExecutor.ts';
import type { FinancialWriteEvidence } from '../../shared/types/financial-activity.ts';

let directory: string;
let db: Client;
let sdk: ActualCorrectionPort;
let account: string;
let destination: string;
let transaction: string;
let loseReply = false;
let partialCreate: 'rule' | 'date' | false = false;
let rejectLedger = false;
let unavailableDispatch = false;
const migrations = ['001_ea_tables.sql','013_email_index_normalized_date.sql','025_email_thread_identity.sql','030_owner_bootstrap.sql','041_email_transaction_imports.sql','042_transaction_import_item_subject.sql','053_transaction_import_financial_plans.sql','054_email_sender_authentication.sql','055_generic_financial_email_imports.sql','056_generic_financial_email_automation.sql','058_generic_financial_email_income_automation.sql','059_generic_financial_email_transfer_automation.sql','062_financial_events.sql','063_financial_activity.sql','064_financial_corrections.sql'];
const facade = (changed: () => Promise<void> = async () => undefined) => createFinancialCorrections({ store: createFinancialCorrectionStore(db), reader: createFinancialActivityReader(db),
  inspect: async (_owner, budgetId, targets) => { await sdk.sync(); return readCorrectionSnapshot(sdk, budgetId, targets); },
  dispatch: async (_owner, budgetId, step, expected) => {
    if (unavailableDispatch) throw new Error('Provider dispatch outcome unavailable');
    const result = await executeCorrectionStep(sdk, budgetId, step, expected);
    if (loseReply) { loseReply = false; throw new Error('Lost provider reply'); }
    return result;
  }, changed });
const reference = { owner: 'event' as const, id: 'event' };
beforeEach(async () => {
  directory = await createTestTempDir('actual-correction-');
  db = createClient({ url: `file:${directory}/application.db` });
  for (const migration of migrations) await db.executeMultiple(readFileSync(new URL(`../db/migrations/${migration}`, import.meta.url), 'utf8'));
  const internal = await actualApi.init({ dataDir: directory, verbose: false });
  await internal.send('create-budget', { budgetName: 'Disposable correction', avoidUpload: true });
  partialCreate = false; loseReply = false; rejectLedger = false; unavailableDispatch = false;
  const realSdk = actualApi as unknown as ActualCorrectionPort;
  sdk = { ...realSdk, sync: async () => undefined, internal: { ...realSdk.internal, send: async (command, payload) => {
    if (command === 'transactions-batch-update' && rejectLedger) { rejectLedger = false; throw new Error('Provider rejected the ledger command'); }
    if (command === 'schedule/create' && partialCreate) {
      const prefix = partialCreate; partialCreate = false;
      const input = payload as { schedule: { id: string }; conditions: unknown[] };
      if (prefix === 'date') return realSdk.internal.send('schedule/create', { ...input, schedule: { ...input.schedule, injectedParentFailure: true } });
      await realSdk.internal.send('rule-add', { stage: null, conditionsOp: 'and', conditions: input.conditions, actions: [{ op: 'link-schedule', value: input.schedule.id }] });
      throw new Error('Schedule creation stopped after its rule commit');
    }
    return realSdk.internal.send(command, payload);
  } } };
  account = await actualApi.createAccount({ name: 'Checking', offbudget: false });
  destination = await actualApi.createAccount({ name: 'Savings', offbudget: false });
  await actualApi.addTransactions(account, [{ date: '2026-09-01', amount: -1000, imported_id: 'original-source', notes: 'Preserved' }]);
  transaction = (await actualApi.getTransactions(account, '2026-09-01', '2026-09-01'))[0]!.id;
  const snapshot = await readCorrectionSnapshot(sdk, 'budget', { transactionIds: [transaction], scheduleIds: [], ruleIds: [] });
  const evidence: FinancialWriteEvidence = { budgetId: 'budget', objects: snapshot.transactions.map(row => ({ kind: 'transaction', id: row.id, role: 'primary', provenance: 'created', beforeState: 'confirmed_absent', before: null, after: row })) };
  await db.execute("INSERT INTO ea_financial_events(id,user_id,status,created_at,updated_at) VALUES('event','owner','pending',1,1)");
  await db.execute({ sql: "UPDATE ea_financial_events SET status='settled',outcome_json=? WHERE id='event'", args: [JSON.stringify({ outcome: 'added', evidence })] });
});
afterEach(async () => { await actualApi.shutdown(); db.close(); await removeTempDir(directory); });
describe('durable correction facade with an offline Actual budget', () => {
  it('corrects signed amount on the same row, preserves original identity, and confirms idempotently', async () => {
    const service = facade();
    const preview = await service.preview('owner', reference, { type: 'income', amountCents: 1700, date: '2026-09-02', accountId: account });
    const admitted = await service.confirm('owner', preview.id, 'one');
    expect((await service.confirm('owner', preview.id, 'one')).id).toBe(admitted.id);
    const result = await service.apply('owner', admitted.id);
    expect(result?.state).toBe('completed');
    expect(await actualApi.getTransactions(account, '2026-09-02', '2026-09-02')).toEqual([expect.objectContaining({ id: transaction, amount: 1700, imported_id: 'original-source', notes: 'Preserved' })]);
    expect((await createFinancialActivityReader(db).detail('owner', reference))?.originalReceipts[0]?.evidence?.objects[0]?.after?.amount).toBe(-1000);
  });
  it('recovers a committed lost reply after rebuilding the facade without redispatch', async () => {
    const service = facade();
    const preview = await service.preview('owner', reference, { type: 'transfer', amountCents: 2100, date: '2026-09-03', fromAccountId: account, toAccountId: destination });
    await service.confirm('owner', preview.id, 'transfer');
    loseReply = true;
    await expect(service.apply('owner', preview.id)).rejects.toThrow('Lost provider reply');
    const recovered = await facade().apply('owner', preview.id);
    expect(recovered?.state).toBe('completed');
    const negative = await actualApi.getTransactions(account, '2026-09-03', '2026-09-03');
    const positive = await actualApi.getTransactions(destination, '2026-09-03', '2026-09-03');
    expect(negative).toHaveLength(1); expect(positive).toHaveLength(1);
    expect(negative[0]).toMatchObject({ id: transaction, amount: -2100, transfer_id: positive[0]!.id });
    expect(positive[0]).toMatchObject({ amount: 2100, transfer_id: transaction });
  });
  it('replaces a created ledger entry with a bill through two verified steps', async () => {
    const service = facade();
    const preview = await service.preview('owner', reference, { type: 'bill', amountCents: 2700, date: '2090-09-03', accountId: account, name: 'Replacement bill' });
    await service.confirm('owner', preview.id, 'bill');
    const result = await service.apply('owner', preview.id);
    expect(result?.steps.map(step => step.state)).toEqual(['applied', 'applied']);
    expect(result?.state).toBe('completed');
    expect(await actualApi.getTransactions(account, '2026-09-01', '2026-09-01')).toHaveLength(0);
    expect(await actualApi.getSchedules()).toEqual([expect.objectContaining({ name: 'Replacement bill', amount: -2700, date: '2090-09-03' })]);
  });
  it('edits a corrected schedule and records a linked payment while preserving the schedule', async () => {
    const service = facade();
    let preview = await service.preview('owner', reference, { type: 'bill', amountCents: 2700, date: '2090-09-03', accountId: account, name: 'Replacement bill' });
    await service.confirm('owner', preview.id, 'bill');
    expect((await service.apply('owner', preview.id))?.state).toBe('completed');
    const scheduleId = (await actualApi.getSchedules())[0]!.id;
    const categoryId = (await actualApi.getCategories())[0]!.id;
    preview = await service.preview('owner', reference, { type: 'bill', amountCents: 2900, date: '2090-10-03', accountId: account, notes: 'Corrected note', categoryId });
    await service.confirm('owner', preview.id, 'bill-edit');
    const edited = await service.apply('owner', preview.id);
    expect(edited?.state).toBe('completed');
    expect(await actualApi.getSchedules()).toEqual([expect.objectContaining({ id: scheduleId, amount: -2900, date: '2090-10-03' })]);
    await expect(service.preview('owner', reference, { type: 'payment', amountCents: 2900, date: '2026-09-03', accountId: account })).rejects.toThrow('Choose explicitly');
    preview = await service.preview('owner', reference, { type: 'payment', amountCents: 2900, date: '2026-09-03', accountId: account, scheduleTreatment: 'keep' });
    await service.confirm('owner', preview.id, 'payment');
    expect((await service.apply('owner', preview.id))?.state).toBe('completed');
    expect(await actualApi.getTransactions(account, '2026-09-03', '2026-09-03')).toEqual([expect.objectContaining({ amount: -2900, schedule: scheduleId })]);
    expect(await actualApi.getSchedules()).toHaveLength(1);
  });
  it.each(['rule', 'date'] as const)('settles a lost-reply %s prefix and explicitly supersedes it with a fresh parent', async prefix => {
    const service = facade();
    const draft = { type: 'bill' as const, amountCents: 3100, date: '2090-09-03', accountId: account, name: 'Partial bill' };
    const first = await service.preview('owner', reference, draft);
    await service.confirm('owner', first.id, 'partial');
    partialCreate = prefix; loseReply = true;
    await expect(service.apply('owner', first.id)).rejects.toThrow('Lost provider reply');
    await expect(service.preview('owner', reference, draft)).rejects.toThrow('uncertain');
    const recovered = await facade().apply('owner', first.id);
    expect(recovered?.state).toBe('attention');
    expect(recovered?.steps[0]?.state).toBe('partial');
    expect(recovered?.steps[0]?.observed?.rules).toHaveLength(1);
    expect(recovered?.steps[0]?.observed?.dates).toHaveLength(prefix === 'date' ? 1 : 0);
    const next = await service.preview('owner', reference, draft);
    expect(next.predecessorId).toBe(first.id);
    expect(next.steps[0]?.command).toBe('rule-delete');
    expect(next.steps.find(step => step.command === 'schedule/create')?.after.schedule?.id).not.toBe(first.steps[0]?.after.schedule?.id);
    await service.confirm('owner', next.id, 'successor');
    expect((await service.apply('owner', next.id))?.state).toBe('completed');
    expect((await service.read('owner', first.id))?.state).toBe('superseded');
    expect(await actualApi.getSchedules()).toHaveLength(1);
    expect((await actualApi.getRules()).filter(rule => rule.actions.some(action => action.op === 'link-schedule'))).toHaveLength(1);
  });
  it('preserves an income-side original through transfer creation and removal', async () => {
    const service = facade();
    let preview = await service.preview('owner', reference, { type: 'income', amountCents: 1800, date: '2026-09-02', accountId: destination });
    await service.confirm('owner', preview.id, 'income'); await service.apply('owner', preview.id);
    preview = await service.preview('owner', reference, { type: 'transfer', amountCents: 1900, date: '2026-09-03', fromAccountId: account, toAccountId: destination });
    await service.confirm('owner', preview.id, 'pair');
    expect((await service.apply('owner', preview.id))?.state).toBe('completed');
    expect(await actualApi.getTransactions(destination, '2026-09-03', '2026-09-03')).toEqual([expect.objectContaining({ id: transaction, amount: 1900 })]);
    preview = await service.preview('owner', reference, { type: 'income', amountCents: 2000, date: '2026-09-04', accountId: destination, retainTransactionId: transaction });
    await service.confirm('owner', preview.id, 'ordinary');
    expect((await service.apply('owner', preview.id))?.state).toBe('completed');
    expect(await actualApi.getTransactions(account, '2026-09-01', '2026-09-04')).toHaveLength(0);
    expect(await actualApi.getTransactions(destination, '2026-09-04', '2026-09-04')).toEqual([expect.objectContaining({ id: transaction, amount: 2000, transfer_id: null, imported_id: 'original-source' })]);
  });
  it('stops an unattempted correction when source evidence changes after confirmation', async () => {
    const service = facade();
    const preview = await service.preview('owner', reference, { type: 'payment', amountCents: 2300, date: '2026-09-02', accountId: account });
    await service.confirm('owner', preview.id, 'source-after-admission');
    await db.execute("UPDATE ea_financial_events SET revision=revision+1 WHERE id='event'");
    await expect(service.apply('owner', preview.id)).rejects.toThrow('Source evidence changed');
    expect((await service.read('owner', preview.id))?.steps[0]?.attemptedAt).toBeNull();
    expect(await actualApi.getTransactions(account, '2026-09-01', '2026-09-02')).toEqual([expect.objectContaining({ id: transaction, amount: -1000 })]);
  });
  it('does not redispatch or supersede an uncertain attempt that still looks unchanged', async () => {
    const service = facade();
    const preview = await service.preview('owner', reference, { type: 'income', amountCents: 2300, date: '2026-09-02', accountId: account });
    await service.confirm('owner', preview.id, 'unknown');
    unavailableDispatch = true;
    await expect(service.apply('owner', preview.id)).rejects.toThrow('unavailable');
    unavailableDispatch = false;
    expect((await facade().apply('owner', preview.id))?.state).toBe('recovering');
    await expect(service.preview('owner', reference, preview.draft)).rejects.toThrow('uncertain');
    expect(await actualApi.getTransactions(account, '2026-09-01', '2026-09-02')).toEqual([expect.objectContaining({ id: transaction, amount: -1000 })]);
  });
  it('allows an explicit successor after a confirmed no-write failure', async () => {
    const service = facade();
    const first = await service.preview('owner', reference, { type: 'income', amountCents: 2300, date: '2026-09-02', accountId: account });
    await service.confirm('owner', first.id, 'failed'); rejectLedger = true;
    expect((await service.apply('owner', first.id))?.steps[0]?.state).toBe('no_write');
    const next = await service.preview('owner', reference, first.draft);
    await service.confirm('owner', next.id, 'retry-explicit');
    expect((await service.apply('owner', next.id))?.state).toBe('completed');
    expect((await service.read('owner', first.id))?.state).toBe('superseded');
  });
  it('rejects reconciled balance changes while allowing a notes correction', async () => {
    await sdk.internal.send('transactions-batch-update', { updated: [{ id: transaction, reconciled: true }], runTransfers: false, learnCategories: false });
    const service = facade();
    await expect(service.preview('owner', reference, { type: 'payment', amountCents: 2300, date: '2026-09-01', accountId: account })).rejects.toThrow('reconciled');
    const preview = await service.preview('owner', reference, { type: 'payment', amountCents: 1000, date: '2026-09-01', accountId: account, notes: 'Owner note' });
    await service.confirm('owner', preview.id, 'notes');
    expect((await service.apply('owner', preview.id))?.state).toBe('completed');
    expect(await actualApi.getTransactions(account, '2026-09-01', '2026-09-01')).toEqual([expect.objectContaining({ reconciled: true, amount: -1000, notes: 'Owner note' })]);
  });
  it('reuses a verified replacement schedule after the ledger-removal step fails', async () => {
    const service = facade();
    const draft = { type: 'bill' as const, amountCents: 2300, date: '2090-09-02', accountId: account, name: 'Partly converted' };
    const first = await service.preview('owner', reference, draft);
    await service.confirm('owner', first.id, 'first'); rejectLedger = true;
    expect((await service.apply('owner', first.id))?.steps.map(step => step.state)).toEqual(['applied', 'no_write']);
    const scheduleId = (await actualApi.getSchedules())[0]!.id;
    const successor = await service.preview('owner', reference, draft);
    expect(successor.steps.some(step => step.command === 'schedule/create')).toBe(false);
    await service.confirm('owner', successor.id, 'resolve');
    expect((await service.apply('owner', successor.id))?.state).toBe('completed');
    expect(await actualApi.getSchedules()).toEqual([expect.objectContaining({ id: scheduleId })]);
    expect(await actualApi.getTransactions(account, '2026-09-01', '2026-09-02')).toHaveLength(0);
  });
  it('can explicitly finish a conversion after the mistaken schedule was retired', async () => {
    const service = facade();
    let preview = await service.preview('owner', reference, { type: 'bill', amountCents: 2300, date: '2090-09-02', accountId: account });
    await service.confirm('owner', preview.id, 'bill'); await service.apply('owner', preview.id);
    const draft = { type: 'income' as const, amountCents: 2400, date: '2026-09-02', accountId: account, scheduleTreatment: 'retire' as const };
    preview = await service.preview('owner', reference, draft);
    await service.confirm('owner', preview.id, 'convert'); rejectLedger = true;
    expect((await service.apply('owner', preview.id))?.steps.map(step => step.state)).toEqual(['applied', 'no_write']);
    const successor = await service.preview('owner', reference, draft);
    await service.confirm('owner', successor.id, 'finish');
    expect((await service.apply('owner', successor.id))?.state).toBe('completed');
    expect(await actualApi.getSchedules()).toHaveLength(0);
    expect(await actualApi.getTransactions(account, '2026-09-02', '2026-09-02')).toEqual([expect.objectContaining({ amount: 2400 })]);
  });
  it('recovers an unsynced local commit after SDK shutdown and reload', async () => {
    const service = facade();
    const preview = await service.preview('owner', reference, { type: 'income', amountCents: 4200, date: '2026-09-04', accountId: account });
    await service.confirm('owner', preview.id, 'reload');
    loseReply = true;
    await expect(service.apply('owner', preview.id)).rejects.toThrow('Lost provider reply');
    const budget = (await actualApi.getBudgets())[0]!;
    await actualApi.shutdown();
    await actualApi.init({ dataDir: directory, verbose: false });
    await actualApi.loadBudget(budget.id!);
    sdk = { ...actualApi as unknown as ActualCorrectionPort, sync: async () => undefined };
    expect((await facade().apply('owner', preview.id))?.state).toBe('completed');
    expect(await actualApi.getTransactions(account, '2026-09-04', '2026-09-04')).toEqual([expect.objectContaining({ id: transaction, amount: 4200 })]);
  });
  it('keeps a locally applied effect recovering until synchronization succeeds', async () => {
    const service = facade();
    const preview = await service.preview('owner', reference, { type: 'income', amountCents: 4300, date: '2026-09-04', accountId: account });
    await service.confirm('owner', preview.id, 'sync');
    const send = sdk.internal.send;
    sdk.internal.send = async (command, payload) => {
      const result = await send(command, payload);
      sdk.sync = async () => { throw new Error('Sync unavailable'); };
      return result;
    };
    const pending = await service.apply('owner', preview.id);
    expect(pending?.state).toBe('recovering');
    expect(pending?.steps[0]?.observed?.transactions[0]?.amount).toBe(4300);
    sdk.sync = async () => undefined;
    expect((await facade().apply('owner', preview.id))?.state).toBe('completed');
  });
  it('corrects both transfer halves and on/off-budget categories together', async () => {
    const offbudget = await actualApi.createAccount({ name: 'External', offbudget: true });
    const category = (await actualApi.getCategories())[0]!.id;
    const service = facade();
    let preview = await service.preview('owner', reference, { type: 'transfer', amountCents: 4400, date: '2026-09-04', fromAccountId: account, toAccountId: offbudget, categoryId: category });
    await service.confirm('owner', preview.id, 'offbudget');
    expect((await service.apply('owner', preview.id))?.state).toBe('completed');
    const first = (await actualApi.getTransactions(account, '2026-09-04', '2026-09-04'))[0]!;
    const peer = (await actualApi.getTransactions(offbudget, '2026-09-04', '2026-09-04'))[0]!;
    expect(first).toMatchObject({ id: transaction, category, amount: -4400, transfer_id: peer.id });
    expect(peer).toMatchObject({ category: null, amount: 4400, transfer_id: transaction });
    preview = await service.preview('owner', reference, { type: 'transfer', amountCents: 4500, date: '2026-09-05', fromAccountId: destination, toAccountId: account });
    await service.confirm('owner', preview.id, 'paired-edit');
    expect((await service.apply('owner', preview.id))?.state).toBe('completed');
    expect(await actualApi.getTransactions(destination, '2026-09-05', '2026-09-05')).toEqual([expect.objectContaining({ id: transaction, category: null, amount: -4500, transfer_id: peer.id })]);
    expect(await actualApi.getTransactions(account, '2026-09-05', '2026-09-05')).toEqual([expect.objectContaining({ id: peer.id, category: null, amount: 4500, transfer_id: transaction })]);
  });
  it('preserves the new posting amount when a later notes step edits an action with empty options', async () => {
    const service = facade();
    let preview = await service.preview('owner', reference, { type: 'bill', amountCents: 2700, date: '2090-09-03', accountId: account });
    await service.confirm('owner', preview.id, 'bill'); await service.apply('owner', preview.id);
    const schedule = (await actualApi.getSchedules())[0]!;
    const snapshot = await readCorrectionSnapshot(sdk, 'budget', { transactionIds: [], scheduleIds: [schedule.id], ruleIds: [] });
    const rule = snapshot.rules[0]!;
    await sdk.internal.send('rule-update', { id: rule.id, stage: null, conditionsOp: 'and', conditions: correctionConditions(rule.conditions), actions: [{ op: 'link-schedule', value: schedule.id }, { op: 'set', field: 'amount', value: -2700, options: {} }] });
    preview = await service.preview('owner', reference, { type: 'bill', amountCents: 4700, date: '2090-09-04', accountId: account, notes: 'Updated note' });
    await service.confirm('owner', preview.id, 'actions');
    expect((await service.apply('owner', preview.id))?.state).toBe('completed');
    const result = await readCorrectionSnapshot(sdk, 'budget', preview.targets);
    expect(JSON.parse(String(result.rules[0]!.actions))).toContainEqual(expect.objectContaining({ field: 'amount', value: -4700 }));
  });
  it('stops when synchronization changes earlier schedule effects during the notes step', async () => {
    const service = facade();
    let preview = await service.preview('owner', reference, { type: 'bill', amountCents: 2700, date: '2090-09-03', accountId: account });
    await service.confirm('owner', preview.id, 'bill'); await service.apply('owner', preview.id);
    const schedule = (await actualApi.getSchedules())[0]!;
    preview = await service.preview('owner', reference, { type: 'bill', amountCents: 4900, date: '2090-09-04', accountId: account, notes: 'Updated note' });
    await service.confirm('owner', preview.id, 'conflict');
    const send = sdk.internal.send;
    sdk.internal.send = async (command, payload) => {
      const result = await send(command, payload);
      if (command === 'rule-update') sdk.sync = async () => {
        sdk.sync = async () => undefined;
        await send('schedule/update', { schedule: { id: schedule.id, name: 'External edit' } });
      };
      return result;
    };
    const stopped = await service.apply('owner', preview.id);
    expect(stopped?.state).toBe('attention');
    expect(stopped?.steps.at(-1)?.state).toBe('conflict');
    expect(stopped?.effectiveResult).toBeNull();
    expect((await actualApi.getSchedules())[0]!.name).toBe('External edit');
  });
  it('blocks original recovery and settlement for a completed source without an admitted operation', async () => {
    const service = facade();
    const preview = await service.preview('owner', reference, { type: 'income', amountCents: 5100, date: '2026-09-04', accountId: account });
    await service.confirm('owner', preview.id, 'source'); await service.apply('owner', preview.id);
    await db.execute("UPDATE ea_financial_events SET revision=revision+1,status='pending' WHERE id='event'");
    const managed = createFinancialEventStore(db);
    expect(await managed.claimEvent('reopened')).toBeNull();
    await expect(db.execute("UPDATE ea_financial_events SET operation_json='{}' WHERE id='event'")).rejects.toThrow('Corrected source');
    const activity = await createFinancialActivityReader(db).detail('owner', reference);
    expect(activity?.effectiveResult).toMatchObject({ entry: { type: 'income', amountCents: 5100 } });
    expect(activity?.originalReceipts).toHaveLength(1);
  });
  it('links only the matching half when a bill becomes a completed transfer', async () => {
    const service = facade();
    let preview = await service.preview('owner', reference, { type: 'bill', amountCents: 2700, date: '2090-09-03', accountId: account });
    await service.confirm('owner', preview.id, 'bill'); await service.apply('owner', preview.id);
    const schedule = (await actualApi.getSchedules())[0]!;
    preview = await service.preview('owner', reference, { type: 'transfer', amountCents: 2700, date: '2026-09-04', fromAccountId: account, toAccountId: destination, scheduleTreatment: 'keep' });
    await service.confirm('owner', preview.id, 'bill-transfer');
    expect((await service.apply('owner', preview.id))?.state).toBe('completed');
    expect((await actualApi.getTransactions(account, '2026-09-04', '2026-09-04'))[0]).toMatchObject({ schedule: schedule.id, amount: -2700 });
    expect((await actualApi.getTransactions(destination, '2026-09-04', '2026-09-04'))[0]).toMatchObject({ schedule: null, amount: 2700 });
  });
  it('retries failed result publication without reapplying the completed ledger effect', async () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const service = facade(async () => { throw new Error('Publication unavailable'); });
      const preview = await service.preview('owner', reference, { type: 'income', amountCents: 5300, date: '2026-09-04', accountId: account });
      await service.confirm('owner', preview.id, 'publication');
      expect((await service.apply('owner', preview.id))?.state).toBe('completed');
      expect(await createFinancialCorrectionStore(db).pending()).toEqual([{ userId: 'owner', id: preview.id }]);
      await facade().recoverPending();
      expect(await createFinancialCorrectionStore(db).pending()).toEqual([]);
      expect(await actualApi.getTransactions(account, '2026-09-04', '2026-09-04')).toEqual([expect.objectContaining({ id: transaction, amount: 5300 })]);
    } finally { output.mockRestore(); }
  });
  it('does not retire an orphan rule that acquired additional actions after its partial receipt', async () => {
    const service = facade();
    const draft = { type: 'bill' as const, amountCents: 5400, date: '2090-09-04', accountId: account };
    const preview = await service.preview('owner', reference, draft);
    await service.confirm('owner', preview.id, 'orphan');
    partialCreate = 'rule';
    const partial = await service.apply('owner', preview.id);
    expect(partial?.steps[0]?.state).toBe('partial');
    const rule = partial!.steps[0]!.observed!.rules[0]!;
    await sdk.internal.send('rule-update', { id: rule.id, stage: null, conditionsOp: 'and', conditions: correctionConditions(rule.conditions), actions: [...JSON.parse(String(rule.actions)), { op: 'set', field: 'notes', value: 'External rule use' }] });
    await expect(service.preview('owner', reference, draft)).rejects.toThrow('orphan rule changed');
    const graph = await readCorrectionSnapshot(sdk, 'budget', preview.targets);
    expect(graph.rules[0]?.tombstone).toBe(0);
    expect(graph.schedules).toHaveLength(0);
  });
  it('restores a captured one-time schedule and its exact saved next occurrence', async () => {
    const scheduleId = 'restore-schedule';
    const conditions = [{ field: 'date', op: 'is', value: '2090-09-03' }, { field: 'account', op: 'is', value: account }, { field: 'amount', op: 'is', value: -1000 }];
    await sdk.internal.send('schedule/create', { schedule: { id: scheduleId, name: 'Before' }, conditions });
    const targets = { transactionIds: [], scheduleIds: [scheduleId], ruleIds: [] };
    const before = await readCorrectionSnapshot(sdk, 'budget', targets);
    await sdk.internal.send('schedule/update', { schedule: { id: scheduleId, name: 'Mistaken' }, conditions: conditions.map(condition => condition.field === 'date' ? { ...condition, value: '2090-10-03' } : condition) });
    const after = await readCorrectionSnapshot(sdk, 'budget', targets);
    const evidence: FinancialWriteEvidence = { budgetId: 'budget', objects: [] };
    for (const [kind, key, role] of [['schedule', 'schedules', 'primary'], ['rule', 'rules', 'schedule_rule'], ['schedule_next_date', 'dates', 'next_date']] as const) {
      evidence.objects.push({ kind, id: before[key][0]!.id, role, provenance: 'updated', beforeState: 'captured', before: before[key][0]!, after: after[key][0]! });
    }
    await db.execute("INSERT INTO ea_financial_events(id,user_id,status,created_at,updated_at) VALUES('restore','owner','pending',1,1)");
    await db.execute({ sql: "UPDATE ea_financial_events SET status='settled',outcome_json=? WHERE id='restore'", args: [JSON.stringify({ outcome: 'updated', evidence })] });
    const service = facade();
    const preview = await service.preview('owner', { owner: 'event', id: 'restore' }, { type: 'payment', amountCents: 1000, date: '2026-09-04', accountId: account, scheduleTreatment: 'restore' });
    await service.confirm('owner', preview.id, 'restore');
    expect((await service.apply('owner', preview.id))?.state).toBe('completed');
    expect(await actualApi.getSchedules()).toEqual([expect.objectContaining({ id: scheduleId, name: 'Before', date: '2090-09-03' })]);
  });
  it('requires explicit treatment for an older recurring schedule and rejects guessed restoration or unsupported date moves', async () => {
    await sdk.internal.send('schedule/create', { schedule: { id: 'older-schedule', posts_transaction: 0 }, conditions: [
      { field: 'date', op: 'is', value: { frequency: 'monthly', interval: 2, start: '2090-09-03', patterns: [], endMode: 'never', skipWeekend: false } },
      { field: 'account', op: 'is', value: account }, { field: 'amount', op: 'is', value: -1000 },
    ] });
    const snapshot = await readCorrectionSnapshot(sdk, 'budget', { transactionIds: [], scheduleIds: ['older-schedule'], ruleIds: [] });
    const evidence: FinancialWriteEvidence = { budgetId: 'budget', objects: [{ kind: 'schedule', id: 'older-schedule', role: 'primary', provenance: 'updated', beforeState: 'unknown', before: null, after: snapshot.schedules[0]! }] };
    await db.execute("INSERT INTO ea_financial_events(id,user_id,status,created_at,updated_at) VALUES('older','owner','pending',1,1)");
    await db.execute({ sql: "UPDATE ea_financial_events SET status='settled',outcome_json=? WHERE id='older'", args: [JSON.stringify({ outcome: 'updated', evidence })] });
    const service = facade(), source = { owner: 'event' as const, id: 'older' };
    const draft = { type: 'payment' as const, amountCents: 1000, date: '2026-09-04', accountId: account };
    await expect(service.preview('owner', source, draft)).rejects.toThrow('Choose explicitly');
    await expect(service.preview('owner', source, { ...draft, scheduleTreatment: 'restore' })).rejects.toThrow('before-image');
    await expect(service.preview('owner', source, { ...draft, type: 'bill', date: '2090-10-03' })).rejects.toThrow('recurrence interval');
    const preview = await service.preview('owner', source, { ...draft, scheduleTreatment: 'keep' });
    await service.confirm('owner', preview.id, 'keep-old');
    expect((await service.apply('owner', preview.id))?.state).toBe('completed');
    expect((await actualApi.getSchedules())[0]!.date).toMatchObject({ interval: 2, start: '2090-09-03' });
  });
  it('rejects a due occurrence edit when the existing schedule posts automatically', async () => {
    const service = facade();
    const preview = await service.preview('owner', reference, { type: 'bill', amountCents: 2700, date: '2090-09-03', accountId: account });
    await service.confirm('owner', preview.id, 'bill'); await service.apply('owner', preview.id);
    const schedule = (await actualApi.getSchedules())[0]!;
    await sdk.internal.send('schedule/update', { schedule: { id: schedule.id, posts_transaction: 1 } });
    await expect(service.preview('owner', reference, { type: 'bill', amountCents: 2700, date: '2020-09-03', accountId: account })).rejects.toThrow('posts automatically');
    expect(await actualApi.getTransactions(account, '2020-09-03', '2020-09-03')).toHaveLength(0);
  });
  it('rejects structural corrections of split allocations', async () => {
    await sdk.internal.send('transactions-batch-update', { added: [
      { id: 'split-one', account, date: '2026-09-01', amount: -400, is_child: true, parent_id: transaction },
      { id: 'split-two', account, date: '2026-09-01', amount: -600, is_child: true, parent_id: transaction },
    ], updated: [{ id: transaction, is_parent: true }], deleted: [], runTransfers: false, learnCategories: false });
    await expect(facade().preview('owner', reference, { type: 'income', amountCents: 1000, date: '2026-09-01', accountId: account })).rejects.toThrow('split');
    const rows = await readCorrectionSnapshot(sdk, 'budget', { transactionIds: [transaction], scheduleIds: [], ruleIds: [] });
    expect(rows.transactions.filter(row => row.parent_id === transaction)).toHaveLength(2);
  });
  it('admits only one of two independently previewed corrections', async () => {
    const service = facade();
    const draft = { type: 'income' as const, amountCents: 5200, date: '2026-09-04', accountId: account };
    const first = await service.preview('owner', reference, draft), second = await service.preview('owner', reference, draft);
    const results = await Promise.allSettled([service.confirm('owner', first.id, 'first'), service.confirm('owner', second.id, 'second')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await actualApi.getTransactions(account, '2026-09-01', '2026-09-01')).toEqual([expect.objectContaining({ amount: -1000 })]);
  });
  it('rejects changed source and changed Actual state before admission', async () => {
    const service = facade();
    const preview = await service.preview('owner', reference, { type: 'payment', amountCents: 1500, date: '2026-09-02', accountId: account });
    await db.execute("UPDATE ea_financial_events SET revision=revision+1 WHERE id='event'");
    await expect(service.confirm('owner', preview.id, 'source-race')).rejects.toThrow('source changed');
    const fresh = await service.preview('owner', reference, preview.draft);
    await sdk.internal.send('transactions-batch-update', { updated: [{ id: transaction, notes: 'External change' }], runTransfers: false, learnCategories: false });
    await expect(service.confirm('owner', fresh.id, 'target-race')).rejects.toThrow('Actual changed');
    expect((await db.execute('SELECT * FROM ea_financial_corrections')).rows).toHaveLength(0);
  });
});
