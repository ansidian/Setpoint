import { describe, expect, it } from 'vitest';
import { hydrateLegacyOccurrencePayments } from './occurrence-payments.ts';
import type { ActualBillOccurrence } from '../../shared/types/actual.ts';
import type { JournalTransaction } from '../../shared/types/finances.ts';
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
