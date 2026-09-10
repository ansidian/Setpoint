import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { createMigratedDb } from '../triage/triage-worker.test-utils.ts';
import { readUtilityStatements } from './finance-statement-sources.ts';
import type { BillCandidate } from '../../shared/types/bills.ts';

const bill: BillCandidate = { type: 'bill', event_kind: 'bill_issued', document_role: 'statement',
  currency: 'USD', amount: 58.11, amount_kind: 'total_due', due_date: '2026-09-17' };
const receivedAt = '2026-09-09T12:00:00Z';
let db: Client;
async function event(id: string) {
  await db.execute({ sql: "INSERT INTO ea_financial_events (id,user_id,created_at,updated_at) VALUES (?,'owner',1,1)", args: [id] });
}
async function source(uid: string, eventId: string | null, candidate: BillCandidate = bill, sender = 'billing@water.test') {
  await db.execute({ sql: `INSERT INTO ea_email_index (uid,user_id,account_id,account_label,account_email,
    from_name,from_address,subject,body_text,email_date,email_date_utc,indexed_at)
    VALUES (?,'owner','mail','Mail','owner@example.test','Water',?,'New statement','See attached statement.',?,?,?)`,
    args: [uid, sender, receivedAt, receivedAt, receivedAt] });
  await db.execute({ sql: `UPDATE ea_financial_documents SET event_id=?,candidate_json=?,status='associated',processed_revision=revision WHERE email_uid=?`,
    args: [eventId, JSON.stringify(candidate), uid] });
}
const read = () => readUtilityStatements('owner', 'budget', '2026-08-01', db);

beforeEach(async () => {
  db = await createMigratedDb();
  await db.execute("UPDATE ea_financial_workflow_state SET cutover_at='2026-08-01T00:00:00Z'");
  await db.execute(`INSERT INTO ea_finance_utilities VALUES ('owner','budget','water','Water','Northstar Water','payee','["schedule"]','["billing@water.test"]','')`);
});
afterEach(() => db.close());

describe('original utility statement history', () => {
  it('retains one original source per event, independent cycles, and immutable settled facts', async () => {
    await event('september'); await event('august');
    await source('original', 'september');
    await source('prior-month', 'august', { ...bill, amount: 54, due_date: '2026-08-17' });
    await db.execute(`UPDATE ea_financial_events SET outcome_json='{"outcome":"updated"}',status='settled' WHERE id='september'`);
    await source('late-copy', 'september', { ...bill, amount: 99 });
    await db.execute({ sql: 'UPDATE ea_financial_documents SET candidate_json=? WHERE email_uid=?', args: [JSON.stringify({ ...bill, amount: 111 }), 'original'] });
    const result = await read();
    expect(result.truncated).toBe(false);
    expect(result.statements.map(row => ({ uid: row.emailUid, amount: row.amountCents, due: row.dueDate }))).toEqual([
      { uid: 'prior-month', amount: 5400, due: '2026-08-17' },
      { uid: 'original', amount: 5811, due: '2026-09-17' },
    ]);
    await source('unsettled-copy', 'august', { ...bill, amount: 75, due_date: '2026-08-17' });
    expect((await read()).statements.map(row => row.emailUid)).toEqual(['prior-month', 'original']);
  });

  it('excludes follow-up notices, dismissed or stale candidates and unrelated budget/sender records', async () => {
    await event('dismissed');
    await source('dismissed', 'dismissed');
    await db.execute("UPDATE ea_financial_events SET dismissed_at=1 WHERE id='dismissed'");
    for (const kind of ['payment_due', 'payment_completed', 'payment_scheduled'] as const) await source(kind, null, { ...bill, event_kind: kind });
    await source('ignored', null); await db.execute("UPDATE ea_financial_documents SET status='ignored' WHERE email_uid='ignored'");
    await source('dismissed-document', null); await db.execute("UPDATE ea_financial_documents SET dismissed_at=1 WHERE email_uid='dismissed-document'");
    await source('stale', null); await db.execute("UPDATE ea_financial_documents SET revision=revision+1 WHERE email_uid='stale'");
    await source('other-sender', null, bill, 'someone@example.test');
    await source('payment-role', null, { ...bill, document_role: 'payment_notice' });
    await source('valid', null);
    expect((await read()).statements.map(row => row.emailUid)).toEqual(['valid']);
    expect((await readUtilityStatements('owner', 'other-budget', '2026-08-01', db)).statements).toEqual([]);
    expect((await readUtilityStatements('other-owner', 'budget', '2026-08-01', db)).statements).toEqual([]);
  });

  it('uses complete saved PDF evidence for identity and facts even without an index row', async () => {
    await db.execute("UPDATE ea_finance_utilities SET source_identity_text='account 1234'");
    await source('pdf-statement', null, { ...bill, due_date: null, statement_facts: {
      no_payment_required: true, no_payment_evidence: 'No Payment Required', account_credit: 0.29,
      account_credit_evidence: 'Total Balance $0.29 Credit',
      statement_date: null, statement_date_evidence: null, new_charges: null, new_charges_evidence: null,
      carried_balance: null, carried_balance_evidence: null,
    } });
    await db.execute({ sql: 'UPDATE ea_financial_documents SET acquired_source_json=? WHERE email_uid=?', args: [JSON.stringify({
      body: 'Account 1234\n[PDF page 1]\nNo Payment Required\nTotal Balance $0.29 Credit',
      subject: 'Original PDF statement', fromAddress: 'billing@water.test', emailDate: receivedAt,
    }), 'pdf-statement'] });
    await db.execute("DELETE FROM ea_email_index WHERE uid='pdf-statement'");
    expect((await read()).statements).toMatchObject([{ emailUid: 'pdf-statement', subject: 'Original PDF statement',
      amountCents: 0, creditCents: 29, nothingDue: true, dueDate: null, issue: null }]);
  });

  it('applies the source limit after original-record and utility filtering', async () => {
    await event('one-cycle'); await source('original', 'one-cycle');
    for (let i = 0; i < 501; i++) await source(`duplicate-${i}`, 'one-cycle');
    expect(await read()).toMatchObject({ truncated: false, statements: [{ emailUid: 'original' }] });
  });

  it('keeps older records outside the requested window even when a later copy arrives inside it', async () => {
    await event('old-cycle'); await source('old-original', 'old-cycle');
    await db.execute({ sql: 'UPDATE ea_financial_documents SET acquired_source_json=? WHERE email_uid=?',
      args: [JSON.stringify({ emailDate: '2024-09-09T12:00:00Z' }), 'old-original'] });
    await source('recent-copy', 'old-cycle');
    expect((await read()).statements).toEqual([]);
    expect((await readUtilityStatements('owner', 'budget', '2024-01-01', db)).statements.map(row => row.emailUid)).toEqual(['old-original']);
  });
});
