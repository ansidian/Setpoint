import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { readPaymentOrganization, savePaymentOrganization } from './payment-groups.ts';
import { buildPaymentCatalog, readRetainedPaymentSchedules } from './payment-catalog.ts';
import { initializePaymentOrganization, reconcilePaymentOrganization } from '../../shared/payment-groups.ts';
import type { FinancialProfile } from '../../shared/types/financial-profiles.ts';
import type { PaymentItem, PaymentOrganization } from '../../shared/types/payment-groups.ts';

let dbClient: Client;
const items: PaymentItem[] = [
  { id: 'utility:electricity', name: 'Electricity', provider: 'Power company', kind: 'utility', utilityId: 'electricity' },
  { id: 'schedule:card', name: 'Card', provider: 'Card issuer', kind: 'credit_card', scheduleId: 'card' },
  { id: 'schedule:retirement', name: 'Retirement', provider: '', kind: 'recurring', scheduleId: 'retirement' },
];
const read = (catalog = items, user = 'owner', budget = 'budget') => readPaymentOrganization(user, budget, catalog, { dbClient });
const save = (organization: unknown, user = 'owner') => savePaymentOrganization(user, organization, { dbClient });

beforeEach(async () => {
  dbClient = createClient({ url: 'file::memory:' });
  await dbClient.executeMultiple('CREATE TABLE ea_settings (user_id TEXT PRIMARY KEY, actual_budget_sync_id TEXT);');
  await dbClient.executeMultiple(readFileSync(new URL('../db/migrations/076_payment_groups.sql', import.meta.url), 'utf8'));
  await dbClient.execute("INSERT INTO ea_settings VALUES ('owner', 'budget'), ('second-owner', 'budget')");
});
afterEach(() => dbClient.close());

describe('saved payment organization', () => {
  it('derives starters without writing, and persists only the complete saved draft', async () => {
    const initial = await read();
    expect(initial).toMatchObject({ revision: 0, groups: [
      { id: 'utilities', itemIds: ['utility:electricity'] },
      { id: 'credit-cards', itemIds: ['schedule:card'] },
      { id: 'subscriptions', itemIds: [] },
      { id: 'ungrouped', itemIds: ['schedule:retirement'] },
    ] });
    expect((await dbClient.execute('SELECT * FROM ea_payment_organizations')).rows).toEqual([]);
    initial.groups[3]!.name = 'Investments';
    initial.groups.reverse();
    initial.groups[0]!.itemIds.push(initial.groups[2]!.itemIds.pop()!);
    expect((await read()).groups[0]!.name).toBe('Utilities');
    const saved = await save(initial);
    expect(saved).toEqual({ ...initial, revision: 1 });
    expect(await read()).toEqual(saved);
  });

  it('keeps assignments across months and degraded metadata, adding only new identities to the renamed default', async () => {
    const original = await read();
    original.groups.find(group => group.id === 'ungrouped')!.name = 'Later';
    const saved = await save(original);
    expect(await read([])).toEqual(saved);
    const incoming: PaymentItem = { id: 'schedule:insurance', name: 'Annual insurance', provider: '', kind: 'recurring', scheduleId: 'insurance' };
    const discovered = await read([incoming]);
    expect(discovered.groups.find(group => group.id === 'ungrouped')).toEqual({
      id: 'ungrouped', name: 'Later', itemIds: ['schedule:retirement', 'schedule:insurance'],
    });
    expect(discovered.groups.find(group => group.id === 'credit-cards')!.itemIds).toEqual(['schedule:card']);
    expect(await read()).toEqual(saved);
    expect(reconcilePaymentOrganization(saved, [incoming, incoming])).toEqual(discovered);
  });

  it('allows only one competing save at each revision', async () => {
    const initial = await read();
    const firstAttempts = await Promise.allSettled([save(initial), save(initial)]);
    expect(firstAttempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(firstAttempts.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    const revisionOne = await read();
    const left = structuredClone(revisionOne); left.groups[0]!.name = 'Household';
    const right = structuredClone(revisionOne); right.groups[0]!.name = 'Home';
    const nextAttempts = await Promise.allSettled([save(left), save(right)]);
    const winner = nextAttempts.find(result => result.status === 'fulfilled');
    expect(nextAttempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(nextAttempts.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect(await read()).toEqual(winner?.status === 'fulfilled' ? winner.value : null);
    expect((await read()).revision).toBe(2);
    await expect(save({ ...initial, revision: 99 })).rejects.toMatchObject({ status: 409 });
  });

  it('isolates owners and budgets and rejects a save after the active budget changes', async () => {
    const saved = await save(await read());
    expect((await read(items, 'second-owner')).revision).toBe(0);
    await dbClient.execute("UPDATE ea_settings SET actual_budget_sync_id='replacement' WHERE user_id='owner'");
    await expect(save(saved)).rejects.toMatchObject({ status: 409 });
    const replacement = await read(items, 'owner', 'replacement');
    expect(replacement.revision).toBe(0);
    expect(await save(replacement)).toMatchObject({ budgetId: 'replacement', revision: 1 });
    expect(await read()).toEqual(saved);
    await expect(save({ ...replacement, revision: 4 }, 'second-owner')).rejects.toMatchObject({ status: 409 });
  });

  it('cannot save if the budget switches after the preflight read', async () => {
    const original = await save(await read());
    let switched = false;
    // A real database supplies all state; this boundary schedules the competing settings write between requests.
    const racingDatabase = {
      execute: async (...args: Parameters<Client['execute']>) => {
        const result = await dbClient.execute(...args);
        if (!switched) {
          switched = true;
          await dbClient.execute("UPDATE ea_settings SET actual_budget_sync_id='replacement' WHERE user_id='owner'");
        }
        return result;
      },
    };
    const edited = structuredClone(original); edited.groups[0]!.name = 'Changed';
    await expect(savePaymentOrganization('owner', edited, { dbClient: racingDatabase })).rejects.toMatchObject({ status: 409 });
    expect(await read()).toEqual(original);
  });

  it('rejects invalid drafts without changing the saved organization and trims accepted names', async () => {
    const original = await save(await read());
    const change = (mutate: (draft: PaymentOrganization) => void) => {
      const draft = structuredClone(original); mutate(draft); return draft;
    };
    const invalid = [
      { ...original, revision: -1 }, { ...original, revision: 1.5 }, { ...original, unexpected: true },
      change(draft => { draft.groups[0]!.name = ''; }),
      change(draft => { draft.groups[0]!.name = 'x'.repeat(61); }),
      change(draft => { draft.groups[0]!.name = ' CREDIT CARDS '; }),
      change(draft => { draft.groups[0]!.id = 'credit-cards'; }),
      change(draft => { draft.groups[0]!.itemIds.push('schedule:card'); }),
      change(draft => { draft.groups[0]!.itemIds.push('occurrence:card:2026-10-01'); }),
      change(draft => { draft.groups = draft.groups.filter(group => group.id !== 'ungrouped'); }),
    ];
    for (const draft of invalid) await expect(save(draft)).rejects.toMatchObject({ status: 400 });
    expect(await read()).toEqual(original);
    const renamed = change(draft => { draft.groups[0]!.name = ' Home '; });
    expect((await save(renamed)).groups[0]!.name).toBe('Home');
  });
});

describe('stable payment catalog', () => {
  it('retains one exact schedule identity outside the monthly history window', async () => {
    await dbClient.executeMultiple(readFileSync(new URL('../db/migrations/002_bills_mirror.sql', import.meta.url), 'utf8'));
    for (const [owner, occurrence, schedule, date, name] of [
      ['owner', 'old', 'annual', '2023-04-01', 'Old annual name'],
      ['owner', 'newer', 'annual', '2024-04-01', 'Annual renewal'],
      ['second-owner', 'other', 'private', '2026-04-01', 'Other owner'],
    ]) {
      await dbClient.execute({
        sql: 'INSERT INTO ea_bill_occurrence_mirror (user_id, occurrence_id, schedule_id, occurrence_date, name) VALUES (?, ?, ?, ?, ?)',
        args: [owner!, occurrence!, schedule!, date!, name!],
      });
    }
    expect(await readRetainedPaymentSchedules('owner', { dbClient })).toEqual([
      { scheduleId: 'annual', name: 'Annual renewal', payee: '', next_date: '2024-04-01' },
    ]);
  });

  it('includes off-month and retained schedules, aggregates utility membership, and requires exact evidence for starter cards', () => {
    const profile = (id: string, overrides: Partial<FinancialProfile> = {}): FinancialProfile => ({
      id, name: id, enabled: true, budgetId: 'budget', senderAddresses: ['billing@example.test'],
      target: { kind: 'card_payment', fromAccountId: 'checking', toAccountId: 'card-account', scheduleId: id }, ...overrides,
    });
    const catalog = buildPaymentCatalog({
      budgetId: 'budget',
      utilities: [{ id: 'electricity', label: 'Electricity', provider: 'Power company', budgetId: 'budget', payeeId: 'power', scheduleIds: ['power-1', 'power-2'], sourceSenders: [] }],
      schedules: [
        { id: 'power-1', name: 'Power' }, { id: 'power-2', name: 'Replacement power' },
        { id: 'annual', name: 'Annual insurance', next_date: '2027-04-01' },
        { id: 'card', name: 'Card payment', type: 'transfer' },
        { id: 'retirement', name: 'Credit card sounding transfer', type: 'transfer' },
        { id: 'disabled', type: 'transfer' }, { id: 'wrong-budget', type: 'transfer' },
        { id: 'repurposed', type: 'bill' },
        { id: 'retired', completed: true },
      ],
      occurrences: [{ scheduleId: 'old', name: 'Past payment', payee: 'Past provider', next_date: '2025-01-01' }],
      profiles: [profile('card'), profile('disabled', { enabled: false }), profile('wrong-budget', { budgetId: 'other' }), profile('repurposed')],
    });
    expect(catalog.map(item => item.id)).toEqual([
      'utility:electricity', 'schedule:annual', 'schedule:card', 'schedule:retirement', 'schedule:disabled', 'schedule:wrong-budget', 'schedule:repurposed', 'schedule:old',
    ]);
    const organization = initializePaymentOrganization('budget', catalog);
    expect(organization.groups.find(group => group.id === 'credit-cards')!.itemIds).toEqual(['schedule:card']);
    expect(organization.groups.find(group => group.id === 'ungrouped')!.itemIds).toEqual([
      'schedule:annual', 'schedule:retirement', 'schedule:disabled', 'schedule:wrong-budget', 'schedule:repurposed', 'schedule:old',
    ]);
  });
});
