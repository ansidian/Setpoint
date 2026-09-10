import type { DemoSeed } from './store';
import type { FinanceWorkspace, JournalRange, JournalTransaction, UtilityStatement, UtilityMappingUpdate } from '../../shared/types/finances';
import { getDemoFinancialActivities } from './financialActivity';
import { NO_DEMO_API_RESPONSE } from './apiHandler';

const mappingOverrides = new Map<string, UtilityMappingUpdate>();
const prior = (date:string) => {const value=new Date(`${date.slice(0,7)}-01T12:00:00Z`);value.setUTCMonth(value.getUTCMonth()-1);return value.toISOString().slice(0,10);};
export function demoFinances(seed:DemoSeed):FinanceWorkspace {
  const previous=prior(seed.dateKey);
  const activities=getDemoFinancialActivities();
  const shifted=(days:number)=>{const value=new Date(`${seed.dateKey}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);};
  const billed:Record<string,{provider:string;dueDate:string;amountCents:number}>= {
    electricity:{provider:'Fictional Electric',dueDate:shifted(14),amountCents:9000},
    water:{provider:'Northstar Water',dueDate:shifted(8),amountCents:5811},
    internet:{provider:'Fiber Co-op',dueDate:shifted(-1),amountCents:7999},
  };
  const definitions=[['electricity','Electricity','demo-shared-schedule'],['water','Water','demo-water'],['internet','Internet','demo-internet'],['gas','Gas','demo-gas'],['trash','Trash','demo-trash']];
  const utilities=definitions.map(([id,label,scheduleId])=>{
    const occurrence=seed.bills.find(row=>row.scheduleId===scheduleId);
    const provider=billed[id!]?.provider || (id==='gas'?'County Gas':'Valley Collection');
    const source=(dueDate:string|null,amountCents:number,sourceId:string,nothingDue=false):UtilityStatement=>{
      const emailUid=`finance-${sourceId}`;
      seed.emailBodies[emailUid]={uid:emailUid,body:`Fictional statement from ${provider}. ${nothingDue?'No Payment Required (Credit Balance). Total Balance $0.29 Credit.':`Amount billed $${(amountCents/100).toFixed(2)}. Due ${dueDate}.`}`,attachments:[]};
      return {id:sourceId,utilityId:id!,emailUid,subject:`${provider} statement`,receivedAt:dueDate && dueDate < seed.dateKey ? dueDate : seed.dateKey,statementDate:null,dueDate,amountCents,amountKind:'total_due',nothingDue,creditCents:nothingDue?29:null,newChargesCents:null,carriedBalanceCents:null,providerReference:sourceId,activity:id==='electricity'&&sourceId.endsWith('-current')?{owner:'event',id:'demo-event-partial'}:null,paymentTransactionIds:[],paymentDate:null,recordedTotalCents:null,feeCents:null,issue:null};
    };
    const bill=billed[id!];
    const statements=id==='gas'?[source(null,0,'gas-credit',true)]:bill?[source(bill.dueDate,bill.amountCents,`${id}-current`),source(previous,({electricity:8100,water:5400,internet:7999}[id!] || 0),`${id}-previous`)]:[];
    if(id==='electricity'&&statements[0]) {
      const row=statements[0];
      const activity=activities.find(item=>item.reference.id==='demo-event-partial');
      const email=activity?.history?.emails.find(item=>item.uid==='demo-electric-revised');
      row.emailUid='demo-electric-revised'; row.subject=email?.subject || row.subject;
      row.receivedAt=email?.receivedAt ? new Date(email.receivedAt).toISOString() : row.receivedAt;
      const result=activity?.effectiveResult as {entry?:{type?:string;amountCents?:number;date?:string}} | null;
      if(activity?.correction?.state==='completed'&&result?.entry?.type==='bill') {
        row.originalStatement={amountCents:row.amountCents,dueDate:row.dueDate};
        row.amountCents=result.entry.amountCents ?? row.amountCents;row.dueDate=result.entry.date || row.dueDate;
      }
    }
    for(const statement of statements){const payment=seed.transactions.find(row=>row.scheduleId===scheduleId&&row.date===statement.dueDate);if(payment){statement.paymentRecorded=true;statement.paymentTransactionIds=[payment.id];statement.paymentDate=payment.date;statement.recordedTotalCents=Math.round(payment.amount*100);}}
    const override = mappingOverrides.get(id!);
    const mappedOccurrences = override ? seed.bills.filter(row => override.scheduleIds.includes(row.scheduleId)) : occurrence ? [occurrence] : [];
    return {identity:{id:id!,label:label!,provider,budgetId:'demo-budget',payeeId:override?.payeeId || scheduleId!,scheduleIds:override?.scheduleIds || [scheduleId!],sourceSenders:[`billing@${id}.example.test`]},statements,occurrences:mappedOccurrences.map(row => ({...row,type:row.type as "bill"|"transfer"|"income"}))};
  });
  const ids=new Set(utilities.flatMap(row=>row.identity.scheduleIds));
  const start=`${Number(seed.dateKey.slice(0,4))-1}${seed.dateKey.slice(4)}`;
  const recordedHistory=demoJournal(seed,new URL(`https://demo.invalid/api/briefing/finances/journal?start=${start}&end=${seed.dateKey}`));
  return {budgetId:'demo-budget',utilities,recurring:seed.bills.filter(row=>!ids.has(row.scheduleId)).map(row=>({...row,type:row.type as "bill"|"transfer"|"income"})),start,end:seed.dateKey,recordedHistory,updatedAt:new Date().toISOString(),issues:[],truncated:recordedHistory.truncated};
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
  if (url.pathname.startsWith('/api/briefing/finances/utility-mappings')) {
    const utilities = demoFinances(seed).utilities.map(row => row.identity);
    const schedules = seed.bills.filter(row => row.type === 'bill').map(row => ({id:row.scheduleId,name:row.name,type:'bill' as const,completed:false,conditions:[{field:'payee',op:'is',value:row.scheduleId}]}));
    const payees = schedules.map(row => ({id:row.id,name:row.name}));
    if (url.pathname === '/api/briefing/finances/utility-mappings' && method === 'GET') return {budgetId:'demo-budget',metadataAvailable:true,utilities,payees,schedules};
    const id = decodeURIComponent(url.pathname.slice('/api/briefing/finances/utility-mappings/'.length));
    if (method === 'PUT') {
      const utility = utilities.find(row => row.id === id);
      const scheduleIds = Array.isArray(body.scheduleIds) ? body.scheduleIds.filter((value):value is string => typeof value === 'string') : [];
      if (!utility || body.budgetId !== 'demo-budget' || !payees.some(row => row.id === body.payeeId) || scheduleIds.length !== 1 || utilities.some(row => row.id !== id && row.scheduleIds.some(scheduleId => scheduleIds.includes(scheduleId))) || scheduleIds.some(scheduleId => !schedules.some(row => row.id === scheduleId && row.conditions[0]?.value === body.payeeId))) throw new Error('Choose an available payee and one bill schedule.');
      const update = {budgetId:'demo-budget',payeeId:String(body.payeeId),scheduleIds:[...new Set(scheduleIds)]};
      mappingOverrides.set(id,update);
      return {...utility,...update};
    }
  }
  if(url.pathname==='/api/briefing/finances'&&method==='GET')return demoFinances(seed);
  if(url.pathname==='/api/briefing/finances/journal'&&method==='GET')return demoJournal(seed,url);
  return NO_DEMO_API_RESPONSE;
}
