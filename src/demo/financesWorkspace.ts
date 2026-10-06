import type { DemoSeed } from './store';
import type { FinanceWorkspace, JournalRange, JournalTransaction } from '../../shared/types/finances';
import type { PaymentItem, PaymentOrganization } from '../../shared/types/payment-groups';
import { initializePaymentOrganization, reconcilePaymentOrganization, validatePaymentOrganization } from '../../shared/payment-groups';
import { NO_DEMO_API_RESPONSE } from './apiHandler';

let savedOrganization: PaymentOrganization | null = null;

/** Read-only Actual projection: fictional schedules, their occurrences and the shared ledger. */
export function demoFinances(seed:DemoSeed):FinanceWorkspace {
  const start=`${Number(seed.dateKey.slice(0,4))-1}${seed.dateKey.slice(4)}`;
  const recordedHistory=demoJournal(seed,new URL(`https://demo.invalid/api/briefing/finances/journal?start=${start}&end=${seed.dateKey}`));
  const recurring = seed.bills.map(row => ({ ...row, type: row.type as 'bill' | 'transfer' | 'income' }));
  const items = new Map<string, PaymentItem>();
  for (const row of seed.actualSchedules) if (!row.completed) items.set(row.id, { id: `schedule:${row.id}`, name: row.name, provider: '', scheduleId: row.id });
  for (const row of recurring) items.set(row.scheduleId, { id: `schedule:${row.scheduleId}`, name: row.name, provider: row.payee, scheduleId: row.scheduleId });
  const paymentItems = [...items.values()];
  const paymentOrganization = savedOrganization
    ? reconcilePaymentOrganization(savedOrganization, paymentItems)
    : initializePaymentOrganization('demo-budget', paymentItems);
  return {budgetId:'demo-budget',recurring,paymentItems,paymentOrganization,start,end:seed.dateKey,recordedHistory,updatedAt:new Date().toISOString(),issues:[],truncated:recordedHistory.truncated};
}
export function demoJournal(seed:DemoSeed,url:URL):JournalRange {
  const start=url.searchParams.get('start') || seed.dateKey,end=url.searchParams.get('end') || seed.dateKey;
  const transactions:JournalTransaction[]=seed.transactions.map(row=>({id:row.id,date:row.date,amountCents:Math.round(row.amount*100)*(row.direction==='income'?1:-1),payee:row.payee,payeeId:row.payeeId || null,account:row.account,accountId:row.accountId || row.account,category:row.category,notes:row.notes,scheduleId:row.scheduleId || null,transferId:row.transferId || (row.id==='demo-transfer-from'?'demo-transfer-to':row.id==='demo-transfer-to'?'demo-transfer-from':null),parentId:row.parentId || null,isParent:!!row.isParent,isChild:!!row.isChild,cleared:!!row.cleared,reconciled:!!row.reconciled}));
  const selected=transactions.filter(row=>row.date>=start&&row.date<=end).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  const visible=selected.slice(0,500),all=new Map(visible.map(row=>[row.id,row]));
  for(let pass=0;pass<3;pass++) {
    const ids=new Set([...all.values()].flatMap(row=>[row.parentId,row.transferId]).concat(url.searchParams.get('transactionId')));
    const parents=new Set([...all.values()].filter(row=>row.isParent).map(row=>row.id));
    for(const row of transactions) if(ids.has(row.id)||(row.parentId&&parents.has(row.parentId))) all.set(row.id,row);
  }
  const visibleIds=new Set(visible.map(row=>row.id));
  return {start,end,transactions:visible,relatives:[...all.values()].filter(row=>!visibleIds.has(row.id)),truncated:selected.length>500};
}
export function handleDemoFinances(url:URL,method:string,seed:DemoSeed,body:Record<string,unknown>={}):unknown {
  if (url.pathname === '/api/briefing/finances/payment-groups' && method === 'PUT') {
    const parsed = validatePaymentOrganization(body);
    if (!parsed.valid) throw Object.assign(new Error(parsed.message), { status: 400 });
    const current = demoFinances(seed);
    if (parsed.value.budgetId !== current.budgetId || parsed.value.revision !== current.paymentOrganization!.revision) {
      throw Object.assign(new Error('Payments changed. Reload Payments before saving.'), { status: 409 });
    }
    savedOrganization = { ...reconcilePaymentOrganization(parsed.value, current.paymentItems!), revision: parsed.value.revision + 1 };
    return structuredClone(savedOrganization);
  }
  if(url.pathname==='/api/briefing/finances'&&method==='GET')return demoFinances(seed);
  if(url.pathname==='/api/briefing/finances/journal'&&method==='GET')return demoJournal(seed,url);
  return NO_DEMO_API_RESPONSE;
}
