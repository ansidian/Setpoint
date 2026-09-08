import { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, ArrowLeftRight, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3, History, Landmark, Layers3, StickyNote, Tag } from 'lucide-react';
import { getFinanceJournal } from '../../api';
import type { FinanceWorkspace, JournalRange } from '../../../shared/types/finances';
import type { FinanceDestination } from './financesNavigation';
import { financeDate, financeMoney, journalEntries } from './financeWorkspaceModel';
import AnimatedCollapse from '../shared/AnimatedCollapse';
import AnchoredFloatingPanel from '../shared/pickers/AnchoredFloatingPanel';
import CalendarDateTimeView from '../shared/pickers/CalendarDateTimeView';
import { DASHBOARD_TZ } from '../../lib/dashboard-helpers';
export default function FinanceJournal({ date,transactionId,data,revision,onNavigate }:{date?:string;transactionId?:string;data:FinanceWorkspace;revision:number;onNavigate:(target:FinanceDestination)=>void}) {
  const [range,setRange]=useState<JournalRange|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[expanded,setExpanded]=useState<string|null>(transactionId || null);
  const end=date || data.end;
  const startDate=new Date(`${end}T12:00:00Z`);startDate.setUTCDate(startDate.getUTCDate()-14);
  const start=date || startDate.toISOString().slice(0,10);
  useEffect(()=>{
    let active=true;
    const load=async()=>{setLoading(true);setError('');try{const result=await getFinanceJournal(start,end,transactionId);if(active)setRange(result);}catch(cause){if(active)setError(cause instanceof Error?cause.message:'Journal unavailable');}finally{if(active)setLoading(false);}};
    void load();return()=>{active=false;};
  },[start,end,transactionId,revision]);
  const entries=range?journalEntries(range):[];
  const selectedExists=entries.some(entry=>entry.ids.includes(transactionId || ''));
  const selectedElsewhere=range?.relatives.find(row=>row.id===transactionId && (row.date<start||row.date>end));
  return <section className="fin-journal"><div className="fin-between"><h2>{date?financeDate(date):'Recent activity'}</h2><span className="fin-muted">Recorded transactions</span></div>
    <div className="fin-journal-tools"><JournalDatePicker date={date} end={data.end} onSelect={value=>onNavigate({view:'journal',date:value})}/>{date&&<button className="fin-recent-days" onClick={()=>onNavigate({view:'journal'})}><History size={15} aria-hidden="true"/>Recent days</button>}</div>
    {loading&&<p role="status">Loading Journal…</p>}{error&&<p role="alert">{error}</p>}{range?.truncated&&<p>Some transactions are outside this read limit. Choose a day to narrow the range.</p>}
    {transactionId&&range&&!selectedExists&&(selectedElsewhere?<button className="fin-link" onClick={()=>onNavigate({view:'journal',date:selectedElsewhere.date,transactionId})}>View recorded transaction · {financeDate(selectedElsewhere.date)} <ArrowRight size={14}/></button>:<p role="status">This transaction is unavailable in the selected dates.</p>)}
    {range&&!entries.length&&<p className="fin-empty">No recorded transactions in these dates.</p>}
    {entries.map((entry,index)=>{
      const row=entry.transaction,open=entry.ids.includes(expanded || '');
      const source=entry.kind==='transfer'&&row.amountCents>0?entry.counterpart!:row;
      const destination=source===row?entry.counterpart:row;
      const title=entry.kind==='transfer'?`${source.account} → ${destination!.account}`:entry.kind==='sent'?`Sent to ${entry.counterpart!.account}`:entry.kind==='received'?`Received from ${entry.counterpart!.account}`:row.payee;
      const direction=entry.kind==='transfer'||entry.kind==='sent'||entry.kind==='received'?'transfer':row.amountCents>0?'income':'outflow';
      const DirectionIcon=direction==='transfer'?ArrowLeftRight:direction==='income'?ArrowDownLeft:ArrowUpRight;
      const StatusIcon=row.reconciled||row.cleared?CheckCircle2:Clock3;
      const linked=data.utilities.flatMap(utility=>utility.statements.filter(statement=>statement.paymentTransactionIds.some(id=>entry.ids.includes(id))).map(statement=>({utility,statement})));
      return <div key={entry.id}>{index===0||entries[index-1]!.transaction.date!==row.date?<h3 className="fin-datehead">{financeDate(row.date)}</h3>:null}
        <button className="fin-journal-row" data-direction={direction} aria-expanded={open} onClick={()=>setExpanded(open?null:entry.id)}><span className="fin-journal-direction" aria-hidden="true"><DirectionIcon size={16}/></span><span className="fin-journal-description"><strong>{title}</strong><small>{entry.kind==='split'?`${entry.children.length} split categories`:entry.kind==='transaction'?row.category:'Transfer'}</small></span><strong className={`fin-journal-amount ${entry.kind==='transfer'||entry.kind==='sent'||entry.kind==='received'?'fin-transfer':row.amountCents>0?'fin-income':'fin-outflow'}`}>{entry.kind==='transfer'?'':row.amountCents<0?'−':'+'}{financeMoney(Math.abs(row.amountCents))}</strong><ChevronDown size={14} className="fin-disclosure-chevron"/></button>
        <AnimatedCollapse open={open}><div className="fin-journal-detail" data-direction={direction}><div className="fin-journal-recording"><span><Check size={13} aria-hidden="true"/>Recorded in Actual</span><span className="fin-journal-status" data-settled={row.reconciled||row.cleared}><StatusIcon size={11} aria-hidden="true"/>{row.reconciled?'Reconciled':row.cleared?'Cleared':'Uncleared'}</span></div><dl className="fin-journal-facts"><div><dt><Landmark size={13} aria-hidden="true"/>Account</dt><dd>{row.account}</dd></div><div><dt><Tag size={13} aria-hidden="true"/>Category</dt><dd>{entry.kind==='split'?'Split transaction':row.category || 'Uncategorized'}</dd></div></dl>{row.notes&&<div className="fin-journal-notes"><h4><StickyNote size={13} aria-hidden="true"/>Notes</h4><p>{row.notes}</p></div>}
          {entry.incomplete&&<p>Related record unavailable. The known transaction is preserved.</p>}
          {entry.children.length>0&&<section className="fin-journal-splits" aria-label="Split categories"><h4><Layers3 size={13} aria-hidden="true"/>Split categories</h4>{entry.children.map(child=><div className="fin-split" key={child.id} data-selected={child.id===transactionId}><span>{child.category}</span><span>{financeMoney(Math.abs(child.amountCents))}</span></div>)}</section>}
          {entry.counterpart&&entry.counterpart.date!==row.date&&<button className="fin-link" onClick={()=>onNavigate({view:'journal',date:entry.counterpart!.date,transactionId:entry.counterpart!.id})}>View other side · {financeDate(entry.counterpart.date)} <ArrowRight size={14}/></button>}
          {linked.map(({utility,statement})=><button className="fin-link" key={statement.id} onClick={()=>onNavigate({view:'utilities',utilityId:utility.identity.id,month:statement.dueDate?.slice(0,7),statementId:statement.id})}>View {utility.identity.label.toLowerCase()} bill &amp; history <ArrowRight size={14}/></button>)}
        </div></AnimatedCollapse>
      </div>;
    })}
  </section>;
}

function JournalDatePicker({date,end,onSelect}:{date?:string;end:string;onSelect:(date:string)=>void}) {
  const [open,setOpen]=useState(false);
  const [nowTick]=useState(()=>Date.now());
  const anchorRef=useRef<HTMLButtonElement>(null);
  const close=()=>{setOpen(false);anchorRef.current?.focus();};
  return <>
    <button ref={anchorRef} className="fin-date-trigger" aria-label={date ? `Go to a day, ${financeDate(date)}` : 'Go to a day'} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><CalendarDays size={15}/>{date ? financeDate(date) : 'Go to a day'}<ChevronDown size={13}/></button>
    {open&&<AnchoredFloatingPanel anchorRef={anchorRef} onClose={close} width={300} height={386} mobileHeight={null} role="dialog" ariaLabel="Journal date" style={{overflow:'hidden',padding:8}}>
      <CalendarDateTimeView nowTick={nowTick} initialEpoch={new Date(`${date || end}T12:00:00Z`).getTime()} onSelect={epoch=>{close();onSelect(new Intl.DateTimeFormat('en-CA',{timeZone:DASHBOARD_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(epoch));}} onBack={close} accent="var(--ea-accent)" confirmLabel="View day" mode="date-only" allowPastDates submitOnDateSelect/>
    </AnchoredFloatingPanel>}
  </>;
}
