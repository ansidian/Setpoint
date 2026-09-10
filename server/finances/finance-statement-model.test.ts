import { describe, expect, it } from 'vitest';
import { projectStatement, linkStatementPayment, hydrateLegacyOccurrencePayments } from './finance-statement-model.ts';
import type { ActualBillOccurrence } from '../../shared/types/actual.ts';
import type { BillCandidate } from '../../shared/types/bills.ts';
import type { JournalTransaction, UtilityIdentity } from '../../shared/types/finances.ts';
const identity: UtilityIdentity = { id:'electricity', label:'Electricity', provider:'Southern California Edison', budgetId:'budget', payeeId:'p', scheduleIds:['s'], sourceSenders:[] };
const candidate: BillCandidate = { type:'bill', event_kind:'statement_issued', amount:100, amount_kind:'total_due', currency:'USD', due_date:'2026-09-14' };
const statement = (fields:BillCandidate = candidate, body = '') => projectStatement({ id:'source', utilityId:'electricity', emailUid:'email', subject:'Bill', receivedAt:'2026-08-26', body, candidate:fields });
const transaction = (fields:Partial<JournalTransaction> = {}):JournalTransaction => ({ id:'payment', date:'2026-09-14', amountCents:-10165, payee:'SCE', payeeId:'p', account:'Card', accountId:'a', category:'Utilities', notes:'', scheduleId:'s', transferId:null, parentId:null, isParent:false, isChild:false, cleared:false, reconciled:false, ...fields });
describe('legacy paid occurrence identity', () => {
  const occurrence: ActualBillOccurrence = { id:'s:2026-09-14', scheduleId:'s', next_date:'2026-09-14', name:'Power', payee:'SCE', amount:100, paid:true, type:'bill', openActionDisabled:true };
  it('recovers a unique exact schedule posting without changing its due date or estimate', () => {
    expect(hydrateLegacyOccurrencePayments([occurrence], [transaction()])).toEqual([{...occurrence,paymentTransactionIds:['payment']}]);
    expect(hydrateLegacyOccurrencePayments([{...occurrence,type:'transfer'}], [transaction({amountCents:10165})])[0]?.paymentTransactionIds).toEqual(['payment']);
    expect(hydrateLegacyOccurrencePayments([{...occurrence,type:'income'}], [transaction({amountCents:10165})])[0]?.paymentTransactionIds).toEqual(['payment']);
    expect(hydrateLegacyOccurrencePayments([{...occurrence,type:'income'}], [transaction()])[0]?.paymentTransactionIds).toBeUndefined();
  });
  it('does not join ambiguous, unrelated, explicit-empty, or unpaid evidence', () => {
    for (const rows of [[transaction(),transaction({id:'second'})], [transaction({scheduleId:'other'})], [transaction({date:'2026-09-13'})], [transaction({isChild:true})], [transaction({amountCents:10165})]]) {
      expect(hydrateLegacyOccurrencePayments([occurrence],rows)[0]?.paymentTransactionIds).toBeUndefined();
    }
    expect(hydrateLegacyOccurrencePayments([occurrence,{...occurrence,id:'duplicate'}],[transaction()]).every(row=>row.paymentTransactionIds===undefined)).toBe(true);
    expect(hydrateLegacyOccurrencePayments([{...occurrence,paymentTransactionIds:[]}],[transaction()])[0]?.paymentTransactionIds).toEqual([]);
    expect(hydrateLegacyOccurrencePayments([{...occurrence,paid:false}],[transaction()])[0]?.paymentTransactionIds).toBeUndefined();
  });
  it('recovers one reciprocal transfer pair while rejecting competing or inconsistent legs', () => {
    const transfer: ActualBillOccurrence = {...occurrence,type:'transfer'};
    const outgoing = transaction({id:'out',transferId:'in',accountId:'checking'});
    const incoming = transaction({id:'in',transferId:'out',accountId:'card',amountCents:10165});
    expect(hydrateLegacyOccurrencePayments([transfer],[outgoing,incoming])).toEqual([{...transfer,paymentTransactionIds:['out','in']}]);
    for (const rows of [
      [outgoing,{...incoming,transferId:'unrelated'}],
      [outgoing,{...incoming,amountCents:10000}],
      [outgoing,{...incoming,accountId:'checking'}],
      [outgoing,{...incoming,isParent:true}],
      [outgoing,incoming,transaction({id:'another'})],
    ]) expect(hydrateLegacyOccurrencePayments([transfer],rows)[0]?.paymentTransactionIds).toBeUndefined();
  });
});
describe('statement evidence projection', () => {
  it('keeps missing evidence unavailable and never converts a payment notice to a monthly bill', () => {
    expect(statement({})).toMatchObject({ amountCents:null, dueDate:null, nothingDue:false });
    expect(statement({ ...candidate, event_kind:'payment_completed', amount_kind:'payment_amount' })).toMatchObject({ amountCents:null, dueDate:null });
    expect(statement({ ...candidate, event_kind:'payment_due' })).toMatchObject({ amountCents:null, dueDate:null });
    expect(statement({ ...candidate, document_role:'payment_notice' })).toMatchObject({ amountCents:null, dueDate:null });
    expect(statement({ ...candidate, type_verification:{status:'failed'} })).toMatchObject({ amountCents:null, dueDate:null });
    expect(statement({ ...candidate, amount:0 })).toMatchObject({ amountCents:0, nothingDue:false });
  });
  it('preserves due-less explicit credit without inventing a month or payment', () => {
    const facts = { statement_date:null, statement_date_evidence:null, no_payment_required:true, no_payment_evidence:'No Payment Required (Credit Balance)', account_credit:0.29, account_credit_evidence:'Total Balance $0.29 Credit', new_charges:null, new_charges_evidence:null, carried_balance:null, carried_balance_evidence:null };
    const notice = statement({ ...candidate, due_date:null, amount:0.29, statement_facts:facts }, 'Total Balance $0.29 Credit\nNo Payment Required (Credit Balance)');
    expect(notice).toMatchObject({ nothingDue:true, creditCents:29, amountCents:0, dueDate:null, paymentTransactionIds:[], issue:null });
    expect(statement({ ...candidate, statement_facts:facts }, 'Different source')).toMatchObject({ nothingDue:false, creditCents:null });
    expect(statement({ ...candidate, statement_facts:{...facts,account_credit:29} }, 'Total Balance $0.29 Credit')).toMatchObject({creditCents:null});
  });
  it('retains exact uncleared postings and the existing fee, without payee-only or ambiguous association', () => {
    expect(linkStatementPayment({...statement(),paymentTransactionIds:['payment']}, identity, [transaction({date:'2026-09-13'})])).toMatchObject({paymentDate:'2026-09-13',recordedTotalCents:10165,feeCents:165});
    expect(linkStatementPayment(statement(), identity, [transaction()])).toMatchObject({ paymentTransactionIds:['payment'], amountCents:10000, recordedTotalCents:10165, feeCents:165 });
    for (const rows of [[transaction({ scheduleId:null })], [transaction({ date:'2026-08-14' })], [transaction(), transaction({ id:'second' })]]) {
      expect(linkStatementPayment(statement(), identity, rows).paymentTransactionIds).toEqual([]);
    }
  });
});
