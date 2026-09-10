import { expect,it } from 'vitest';
import type { JournalTransaction } from '../../../shared/types/finances';
import { journalEntries } from './financeWorkspaceModel';
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
