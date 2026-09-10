import { expect,it } from 'vitest';
import { paymentRowDate, sortPaymentRows } from './paymentLedgerSort';
import type { PaymentPresentationRow } from './paymentPresentationModel';
const row=(id:string,dueDate:string|null,amountCents:number|null)=>({id,name:id,dueDate,paymentDate:dueDate,amountCents}) as PaymentPresentationRow;
it('sorts dates and amounts in either direction with unknowns always last without mutating input',()=>{
 const rows=[row('unknown',null,null),row('later','2026-09-20',200),row('earlier','2026-09-01',100)];
 expect(sortPaymentRows(rows,{column:'date',direction:'asc'},'2026-08-01').map(r=>r.id)).toEqual(['earlier','later','unknown']);
 expect(sortPaymentRows(rows,{column:'date',direction:'desc'},'2026-08-01').map(r=>r.id)).toEqual(['later','earlier','unknown']);
 expect(sortPaymentRows(rows,{column:'amountCents',direction:'asc'},'2026-08-01').map(r=>r.id)).toEqual(['earlier','later','unknown']);
 expect(rows[0]?.id).toBe('unknown');
});

it('keeps today and upcoming dates first, past dates next and undated rows last',()=>{
 const rows=[row('past','2026-09-01',1),row('undated',null,null),row('future','2026-09-20',2),row('today','2026-09-09',3)];
 expect(sortPaymentRows(rows,{column:'date',direction:'asc'},'2026-09-09').map(r=>r.id)).toEqual(['today','future','past','undated']);
 expect(sortPaymentRows(rows,{column:'date',direction:'asc'},'2026-09-09').map(r=>r.id)).toEqual(['today','future','past','undated']);
});

it('uses the recorded date for paid rows and the due date for upcoming rows',()=>{
 const payment={...row('paid','2026-09-14',100),status:'paid',paymentDate:'2026-09-09'} as PaymentPresentationRow;
 expect(paymentRowDate(payment)).toBe('2026-09-09');
 expect(paymentRowDate({...payment,status:'scheduled'})).toBe('2026-09-14');
});
