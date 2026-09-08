import { expect,it } from 'vitest';
import type { JournalTransaction,UtilityStatement } from '../../../shared/types/finances';
import { journalEntries,monthStatement,statementComparison } from './financeWorkspaceModel';
const row=(id:string,fields:Partial<JournalTransaction>={}):JournalTransaction=>({id,date:'2026-07-23',amountCents:-100,payee:'Market',payeeId:'p',account:'Checking',accountId:'a',category:'Groceries',notes:'',scheduleId:null,transferId:null,parentId:null,isParent:false,isChild:false,cleared:false,reconciled:false,...fields});
it('shows one split purchase, one same-date reciprocal transfer, and both cross-date sides',()=>{
 const transactions=[row('parent',{isParent:true,amountCents:-300}),row('c1',{isChild:true,parentId:'parent',amountCents:-100}),row('c2',{isChild:true,parentId:'parent',amountCents:-200}),row('from',{transferId:'to'}),row('to',{transferId:'from',amountCents:100,accountId:'b',account:'Savings'}),row('sent',{transferId:'received',date:'2026-07-31'}),row('received',{transferId:'sent',date:'2026-08-03',amountCents:100,accountId:'b'})];
 const entries=journalEntries({start:'2026-07-01',end:'2026-08-31',transactions,relatives:[],truncated:false});
 expect(entries.map(entry=>entry.kind).sort()).toEqual(['received','sent','split','transfer']);
 expect(entries.find(entry=>entry.kind==='split')).toMatchObject({ids:['parent','c1','c2'],incomplete:false});
 expect(entries.find(entry=>entry.kind==='transfer')?.ids.sort()).toEqual(['from','to']);
});
it('preserves missing relatives and refuses guessed transfer pairs',()=>{
 const transactions=[row('child',{isChild:true,parentId:'missing'}),row('from',{transferId:'to'}),row('to',{transferId:null,amountCents:100,accountId:'b'})];
 const entries=journalEntries({start:'2026-07-01',end:'2026-07-31',transactions,relatives:[],truncated:false});
 expect(entries).toHaveLength(3);expect(entries.find(entry=>entry.id==='child')?.incomplete).toBe(true);expect(entries.find(entry=>entry.id==='from')?.incomplete).toBe(true);
});
const statement=(id:string,fields:Partial<UtilityStatement>={}):UtilityStatement=>({id,utilityId:'electric',emailUid:id,subject:'Bill',receivedAt:'2026-08-01',statementDate:null,dueDate:'2026-09-14',amountCents:10000,amountKind:'total_due',nothingDue:false,creditCents:null,newChargesCents:null,carriedBalanceCents:null,providerReference:null,activity:null,paymentTransactionIds:[],paymentDate:null,recordedTotalCents:null,feeCents:null,issue:null,...fields});
it('does not sum distinct monthly statements, fabricate sparse months, or compare carried balances',()=>{
 const current=statement('a');expect(monthStatement([current],'2026-08')).toBeNull();
 expect(monthStatement([current,statement('b')],'2026-09')).toBeNull();
 expect(monthStatement([statement('a',{providerReference:'invoice'}),statement('b',{providerReference:'invoice'})],'2026-09')?.id).toBe('a');
 expect(statementComparison(current,[current])).toBe('Previous comparable bill unavailable');
 const previous=statement('previous',{dueDate:'2026-08-14',amountCents:9000});
 expect(statementComparison(current,[previous])).toBe('$10.00 higher than Aug');
 expect(statementComparison({...current,carriedBalanceCents:2000},[previous])).toContain('earlier balance');
});
