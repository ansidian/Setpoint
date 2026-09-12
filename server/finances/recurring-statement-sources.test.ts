import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { createMigratedDb } from '../triage/triage-worker.test-utils.ts';
import { createFinancialActivityReader } from '../financial-activity/financial-activity.ts';
import { readRecurringStatements } from './recurring-statement-sources.ts';
import type { ActualMetadata, ActualSchedule } from '../../shared/types/actual.ts';
import type { BillCandidate } from '../../shared/types/bills.ts';
import type { FinancialWriteEvidence } from '../../shared/types/financial-activity.ts';
import type { FinancialProfileConfiguration } from '../../shared/types/financial-profiles.ts';

const receivedAt = '2026-09-09T12:00:00Z';
const timestamp = Date.parse(receivedAt);
const body = 'Account ending 1234. Statement balance $800.00. Payment due September 20, 2026.';
const statement: BillCandidate = {
  type: 'transfer', event_kind: 'statement_issued', document_role: 'statement', currency: 'USD',
  amount: 800, amount_kind: 'statement_balance', due_date: '2026-09-20',
  account_last4: '1234', account_last4_confidence: 1, account_last4_evidence: 'Account ending 1234',
};
const schedule = (id = 'card-schedule', card = 'card'): ActualSchedule => ({
  id, type: 'transfer', name: 'Arbitrary schedule label', transferAccountId: 'checking', next_date: '2026-09-18',
  conditions: [{ field: 'account', op: 'is', value: card }, { field: 'payee', op: 'is', value: 'transfer-from-checking' },
    { field: 'amount', op: 'is', value: 20000 }, { field: 'date', op: 'is', value: '2026-09-18' }],
});
const metadata = (): ActualMetadata => ({
  accounts: [{ id: 'checking', name: 'Funding' }, { id: 'card', name: 'First account' }, { id: 'card-2', name: 'Second account' }],
  payees: [], payeeMap: {}, categories: [], schedules: [schedule(), schedule('second-schedule', 'card-2')], recentTransactions: [],
});
const profiles = (): FinancialProfileConfiguration => ({ budgetId: 'budget', revision: 1, profiles: [{
  id: 'first-profile', name: 'First profile', enabled: true, budgetId: 'budget', senderAddresses: ['billing@issuer.test'],
  accountLast4: '1234', target: { kind: 'card_payment', fromAccountId: 'checking', toAccountId: 'card', scheduleId: 'card-schedule' },
}] });
const evidence = (scheduleId = 'card-schedule', budgetId = 'budget'): FinancialWriteEvidence => ({ budgetId, objects: [{
  kind: 'schedule', id: scheduleId, role: 'primary', provenance: 'updated', beforeState: 'unknown', before: null,
  after: { id: scheduleId, tombstone: 0 },
}] });
let db: Client;

async function event(id: string) {
  await db.execute({ sql: "INSERT INTO ea_financial_events (id,user_id,created_at,updated_at) VALUES (?,'owner',?,?)", args: [id, timestamp, timestamp] });
}

async function source(uid: string, options: { eventId?: string; candidate?: BillCandidate; body?: string; sender?: string } = {}) {
  await db.execute({ sql: `INSERT INTO ea_email_index (uid,user_id,account_id,account_label,account_email,
    from_name,from_address,subject,body_text,email_date,email_date_utc,indexed_at)
    VALUES (?,'owner','mail','Mail','owner@example.test','Issuer',?,'New statement',?,?,?,?)`,
  args: [uid, options.sender || 'billing@issuer.test', options.body ?? body, receivedAt, receivedAt, receivedAt] });
  await db.execute({ sql: "UPDATE ea_financial_documents SET event_id=?,candidate_json=?,status='associated',processed_revision=revision WHERE email_uid=?",
    args: [options.eventId || null, JSON.stringify(options.candidate || statement), uid] });
}

async function settle(eventId: string, savedEvidence = evidence()) {
  await db.execute({ sql: "UPDATE ea_financial_events SET status='settled',outcome_json=? WHERE id=?",
    args: [JSON.stringify({ outcome: 'updated', budgetId: savedEvidence.budgetId, scheduleId: savedEvidence.objects[0]?.id, evidence: savedEvidence }), eventId] });
}

async function correct(eventId: string, result: unknown, state = 'completed') {
  const id = `correction-${eventId}`;
  const activityId = JSON.stringify(['event', eventId]);
  await db.execute({ sql: "INSERT INTO ea_financial_correction_previews VALUES (?,'owner',?,'{}',?)", args: [id, activityId, timestamp] });
  await db.execute({ sql: `INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,effective_result_json,updated_at)
    VALUES (?,'owner',?,'budget',?,?,?,?,?)`, args: [id, activityId, id, id, state, JSON.stringify(result), timestamp] });
}

async function read(options: { metadata?: ActualMetadata | null; profiles?: FinancialProfileConfiguration; budgetId?: string; start?: string } = {}) {
  const start = options.start || '2026-08-01';
  const activities = await createFinancialActivityReader(db).forWorkspace('owner', start);
  return readRecurringStatements('owner', options.budgetId || 'budget', start, {
    activities, metadata: options.metadata === undefined ? metadata() : options.metadata, profiles: options.profiles || profiles(), dbClient: db,
  });
}

beforeEach(async () => {
  db = await createMigratedDb();
  await db.execute("UPDATE ea_financial_workflow_state SET cutover_at='2026-08-01T00:00:00Z'");
});
afterEach(() => db.close());

describe('recurring card statement source projection', () => {
  it('retains the original full balance and deadline independently of later transfer values or source reassessment', async () => {
    await event('september');
    await source('original', { eventId: 'september' });
    await settle('september');
    await source('later-copy', { eventId: 'september', candidate: { ...statement, amount: 999 } });
    await db.execute({ sql: 'UPDATE ea_financial_documents SET candidate_json=? WHERE email_uid=?',
      args: [JSON.stringify({ ...statement, amount: 111, due_date: '2026-09-18' }), 'original'] });
    expect(await read({ profiles: { budgetId: 'budget', revision: 2, profiles: [] } })).toMatchObject({
      truncated: false, cardScheduleIds: ['card-schedule'], statements: [{ emailUid: 'original', scheduleId: 'card-schedule',
        amountCents: 80000, amountKind: 'statement_balance', dueDate: '2026-09-20', activity: { owner: 'event', id: 'september' },
        paymentTransactionIds: [], paymentDate: null, recordedTotalCents: null, feeCents: null, issue: null }],
    });
    expect((await read()).statements[0]?.paymentRecorded).toBeUndefined();
  });

  it('uses exact sender and grounded card suffix profiles, without schedule-name or account-name inference', async () => {
    const configuration = profiles();
    configuration.profiles.push({ ...configuration.profiles[0]!, id: 'second-profile', accountLast4: '5678',
      target: { kind: 'card_payment', fromAccountId: 'checking', toAccountId: 'card-2', scheduleId: 'second-schedule' } });
    await source('first');
    await source('second', { candidate: { ...statement, account_last4: '5678', account_last4_evidence: 'Account ending 5678' }, body: body.replace('1234', '5678') });
    await source('unknown-card', { candidate: { ...statement, account_last4: undefined, account_last4_evidence: undefined } });
    await source('wrong-sender', { sender: 'someone@example.test' });
    expect((await read({ profiles: configuration })).statements.map(row => [row.emailUid, row.scheduleId])).toEqual([
      ['second', 'second-schedule'], ['first', 'card-schedule'],
    ]);
    configuration.profiles.push({ ...configuration.profiles[0]!, id: 'overlap' });
    expect((await read({ profiles: configuration })).statements.map(row => row.emailUid)).toEqual(['second']);
  });

  it('requires an explicit current-budget profile schedule with matching transfer direction', async () => {
    await source('unbound');
    const noSchedule = profiles();
    noSchedule.profiles[0]!.target = { kind: 'card_payment', fromAccountId: 'checking', toAccountId: 'card' };
    const reversed = profiles();
    reversed.profiles[0]!.target = { kind: 'card_payment', fromAccountId: 'card', toAccountId: 'checking', scheduleId: 'card-schedule' };
    for (const configuration of [noSchedule, reversed, { ...profiles(), budgetId: 'other-budget' },
      { ...profiles(), profiles: [{ ...profiles().profiles[0]!, enabled: false }] }]) {
      expect((await read({ profiles: configuration })).statements).toEqual([]);
    }
    expect((await read({ metadata: null })).statements).toEqual([]);
  });

  it('preserves saved budget isolation without remapping settled history through a current profile', async () => {
    await event('old-budget'); await source('bound', { eventId: 'old-budget' });
    await settle('old-budget', evidence('card-schedule', 'old-budget'));
    expect((await read()).statements).toEqual([]);
    expect((await read({ budgetId: 'old-budget', metadata: null })).statements).toMatchObject([{ scheduleId: 'card-schedule', budgetId: 'old-budget' }]);
    const contradictory = metadata(); contradictory.schedules[0]!.type = 'bill';
    expect((await read({ budgetId: 'old-budget', metadata: contradictory })).statements).toEqual([]);
  });

  it('follows a corrected schedule identity while preserving the source statement amount and due date', async () => {
    await event('changed'); await source('statement', { eventId: 'changed' }); await settle('changed');
    await correct('changed', { scheduleId: 'replacement', entry: { type: 'transfer_schedule', amountCents: 20000, date: '2026-09-18' },
      evidence: evidence('replacement') });
    const current = metadata(); current.schedules.push(schedule('replacement'));
    expect((await read({ metadata: current })).statements).toMatchObject([{ scheduleId: 'replacement', amountCents: 80000, dueDate: '2026-09-20' }]);
  });

  it.each(['removed', 'ambiguous', 'transaction', 'wrong-budget', 'recovering'])(
    'does not resurrect an original schedule after a %s correction', async kind => {
      await event(kind); await source('statement', { eventId: kind }); await settle(kind);
      const changed = evidence();
      if (kind === 'removed') changed.objects[0]!.after = null;
      if (kind === 'ambiguous') changed.objects.push({ ...changed.objects[0]!, id: 'competing', after: { id: 'competing' } });
      if (kind === 'transaction') changed.objects[0]!.kind = 'transaction';
      if (kind === 'wrong-budget') changed.budgetId = 'other-budget';
      await correct(kind, { evidence: changed, resolution: 'kept_actual' }, kind === 'recovering' ? 'recovering' : 'completed');
      expect((await read()).statements).toEqual([]);
    },
  );

  it('selects only full statement balances and keeps minimum-only or failed amount evidence unavailable', async () => {
    await source('minimum-only', { candidate: { ...statement, amount: 30, amount_kind: 'minimum_due' } });
    await source('failed-amount', { candidate: { ...statement, amount_verification: { status: 'failed', source_value_count: 2, initial_covered_count: 1 } } });
    await source('full-and-minimum', { candidate: { ...statement, amount_candidates: [
      { kind: 'minimum_due', value: 30 }, { kind: 'statement_balance', value: 800 },
    ] } });
    await source('competing-balances', { candidate: { ...statement, amount: null, amount_candidates: [
      { kind: 'statement_balance', value: 800 }, { kind: 'statement_balance', value: 900 },
    ] } });
    expect((await read()).statements.map(row => [row.emailUid, row.amountCents])).toEqual([
      ['competing-balances', null], ['full-and-minimum', 80000], ['failed-amount', null], ['minimum-only', null],
    ]);
  });

  it('excludes payment notices, noncard statements, dismissed sources and unfinished reassessments', async () => {
    for (const kind of ['payment_scheduled', 'payment_due', 'card_payment_completed', 'account_transfer_completed'] as const) {
      await source(kind, { candidate: { ...statement, event_kind: kind, amount: 200, amount_kind: 'payment_amount', due_date: '2026-09-18' } });
    }
    await source('bill', { candidate: { ...statement, type: 'bill' } });
    await source('payment-role', { candidate: { ...statement, document_role: 'payment_notice' } });
    await source('failed-type', { candidate: { ...statement, type_verification: { status: 'failed' } } });
    await source('failed-event', { candidate: { ...statement, event_verification: { status: 'failed' } } });
    await source('ignored'); await db.execute("UPDATE ea_financial_documents SET status='ignored' WHERE email_uid='ignored'");
    await source('stale'); await db.execute("UPDATE ea_financial_documents SET revision=revision+1 WHERE email_uid='stale'");
    await source('dismissed'); await db.execute("UPDATE ea_financial_documents SET dismissed_at=1 WHERE email_uid='dismissed'");
    await event('dismissed-event'); await source('event-source', { eventId: 'dismissed-event' });
    await db.execute("UPDATE ea_financial_events SET dismissed_at=1 WHERE id='dismissed-event'");
    expect((await read()).statements).toEqual([]);
  });

  it('reads complete saved PDF facts without an index row, keeping no-payment credit statements due-less', async () => {
    await source('pdf', { candidate: { ...statement, amount: null, due_date: null, statement_facts: {
      statement_date: '2026-09-08', statement_date_evidence: 'Statement date September 8, 2026',
      no_payment_required: true, no_payment_evidence: 'No Payment Required', account_credit: 0.29, account_credit_evidence: 'Credit balance $0.29',
      new_charges: null, new_charges_evidence: null, carried_balance: null, carried_balance_evidence: null,
    } } });
    await db.execute({ sql: 'UPDATE ea_financial_documents SET acquired_source_json=? WHERE email_uid=?', args: [JSON.stringify({
      fromAddress: 'billing@issuer.test', subject: 'Original PDF statement', emailDate: receivedAt,
      body: 'Account ending 1234\n[PDF page 1]\nStatement date September 8, 2026\nNo Payment Required\nCredit balance $0.29',
    }), 'pdf'] });
    await db.execute("DELETE FROM ea_email_index WHERE uid='pdf'");
    expect((await read()).statements).toMatchObject([{ emailUid: 'pdf', subject: 'Original PDF statement',
      amountCents: 0, nothingDue: true, dueDate: null, statementDate: '2026-09-08', creditCents: 29, issue: null }]);
  });

  it('does not invent an unsupported due date or a balance in a different currency', async () => {
    await source('missing-date', { body: 'Account ending 1234. Statement balance $800.00.' });
    await source('foreign-currency', { candidate: { ...statement, currency: 'EUR' } });
    expect((await read()).statements).toMatchObject([
      { emailUid: 'foreign-currency', amountCents: null, issue: 'A verified USD statement balance is unavailable.' },
      { emailUid: 'missing-date', dueDate: null, issue: 'Statement due date is unavailable.' },
    ]);
  });

  it('deduplicates original event sources before applying the bounded source limit', async () => {
    await event('one-cycle'); await source('original', { eventId: 'one-cycle' });
    for (let i = 0; i < 501; i++) await source(`duplicate-${i}`, { eventId: 'one-cycle' });
    expect(await read()).toMatchObject({ truncated: false, statements: [{ emailUid: 'original' }] });
    await db.execute({ sql: 'UPDATE ea_financial_documents SET acquired_source_json=? WHERE email_uid=?',
      args: [JSON.stringify({ emailDate: '2024-09-09T12:00:00Z' }), 'original'] });
    expect((await read()).statements).toEqual([]);
  });
});
