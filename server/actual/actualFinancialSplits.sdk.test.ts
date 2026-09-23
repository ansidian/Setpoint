import actualApi from '@actual-app/api';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestTempDir, removeTempDir } from '../test-utils/temp-dir.ts';
import { bindFinancialEventOperation, createFinancialEventExecutor } from '../financial-events/financial-event-operation.ts';
import { reconcileActualFinancialOperation, type ActualFinancialSdk } from './actualFinancialOperations.ts';

let dataDir: string | null = null;
let started = false;
afterEach(async () => {
  if (started) await actualApi.shutdown();
  started = false;
  await removeTempDir(dataDir);
  dataDir = null;
});
async function setup() {
  dataDir = await createTestTempDir('actual-financial-splits-');
  const internal = await actualApi.init({ dataDir, verbose: false });
  started = true;
  await internal.send('create-budget', { budgetName: 'Fictional split review', avoidUpload: true });
  const accountId = await actualApi.createAccount({ name: 'Fictional card', offbudget: false });
  const payeeId = await actualApi.createPayee({ name: 'Fictional store' });
  const categoryId = (await actualApi.getCategories()).find(category => 'group_id' in category)!.id;
  const sdk = { ...actualApi, sync: async () => undefined } as unknown as ActualFinancialSdk;
  const execute = createFinancialEventExecutor({ financial: (_user, input, mode) => reconcileActualFinancialOperation(sdk, 'isolated', input, mode) });
  const operation = { executor: 'financial' as const, input: {
    kind: 'transaction' as const, identityKey: 'financial-event:split', accountId, payee: 'Fictional store', payeeId,
    amountCents: -13893, date: '2026-09-20', notes: 'Three orders', splits: [
      { amountCents: -1097, categoryId, notes: 'Order one' },
      { amountCents: -11361, notes: 'Order two' },
      { amountCents: -1435, notes: 'Order three' },
    ],
  } };
  const read = () => actualApi.getTransactions(accountId, operation.input.date, operation.input.date);
  return { execute, operation, read, accountId, payeeId, categoryId };
}

it('imports one parent and all children, recovers without duplication, and detects changed split amounts', async () => {
  const { execute, operation, read, categoryId } = await setup();
  const preview = await execute('owner', operation, 'preview');
  expect(preview.outcome).toBe('would_add');
  expect(await read()).toEqual([]);
  const bound = bindFinancialEventOperation(operation, preview);
  const written = await execute('owner', bound, 'write_once');
  expect(written.outcome, JSON.stringify({ written, rows: await read() })).toBe('added');
  const rows = await read();
  const parent = rows.find(row => row.is_parent)!;
  expect(parent).toMatchObject({ amount: -13893, imported_id: operation.input.identityKey });
  const children = parent.subtransactions || [];
  expect(children).toHaveLength(3);
  expect(children).toEqual(expect.arrayContaining([
    expect.objectContaining({ parent_id: parent.id, amount: -1097, category: categoryId, notes: 'Order one' }),
    expect.objectContaining({ parent_id: parent.id, amount: -11361, notes: 'Order two' }),
    expect.objectContaining({ parent_id: parent.id, amount: -1435, notes: 'Order three' }),
  ]));
  expect(written.evidence?.objects.filter(object => object.kind === 'transaction')).toHaveLength(4);
  expect(await execute('owner', bound, 'recover')).toMatchObject({ outcome: 'already_present', transactionId: parent.id });
  expect(await execute('owner', bound, 'write_once')).toMatchObject({ outcome: 'already_present' });
  expect(await read()).toEqual(rows);
  await actualApi.updateTransaction(children[0]!.id, { amount: -999 });
  await vi.waitFor(async () => expect((await read()).flatMap(row => row.subtransactions || []).find(row => row.id === children[0]!.id)?.amount).toBe(-999));
  const secondAmount = children[1]!.amount + children[0]!.amount + 999;
  await actualApi.updateTransaction(children[1]!.id, { amount: secondAmount });
  await vi.waitFor(async () => expect((await read()).flatMap(row => row.subtransactions || []).find(row => row.id === children[1]!.id)?.amount).toBe(secondAmount));
  expect((await read())[0]?.amount).toBe(operation.input.amountCents);
  expect(await execute('owner', bound, 'recover')).toMatchObject({ outcome: 'needs_review' });
}, 30_000);

it('does not accept or alter an existing unsplit payment as the requested split', async () => {
  const { execute, operation, read, accountId, payeeId } = await setup();
  await actualApi.addTransactions(accountId, [{ date: operation.input.date, amount: operation.input.amountCents, payee: payeeId }]);
  const before = await read();
  expect(await execute('owner', operation, 'preview')).toMatchObject({ outcome: 'needs_review' });
  expect(await execute('owner', { ...operation, input: { ...operation.input, budgetId: 'isolated' } }, 'recover')).toMatchObject({ outcome: 'needs_review' });
  expect(await read()).toEqual(before);
}, 30_000);

it('rejects inconsistent totals and unavailable split categories before writing', async () => {
  const { execute, operation, read } = await setup();
  expect(await execute('owner', { ...operation, input: { ...operation.input, amountCents: -13894 } }, 'preview')).toMatchObject({ outcome: 'needs_review' });
  expect(await execute('owner', { ...operation, input: { ...operation.input, splits: operation.input.splits.map(split => ({ ...split, categoryId: 'missing-category' })) } }, 'preview')).toMatchObject({ outcome: 'needs_review' });
  expect(await read()).toEqual([]);
}, 30_000);
