import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, ArrowLeftRight, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3, History, Landmark, Layers3, StickyNote, Tag } from 'lucide-react';
import { getFinanceJournal } from '../../api';
import type { FinanceWorkspace, JournalRange } from '../../../shared/types/finances';
import type { FinanceDestination } from './financesNavigation';
import { financeDate, financeMoney } from './financeWorkspaceModel';
import { financeActivityDays, financeMonthRange } from '../../hooks/calendar/financeActivityModel';
import FinanceActivityCalendar from '../calendar/FinanceActivityCalendar';
import WorkspaceLoading from '../shared/WorkspaceLoading';
import AnimatedCollapse from '../shared/AnimatedCollapse';
import AnchoredFloatingPanel from '../shared/pickers/AnchoredFloatingPanel';
import CalendarDateTimeView from '../shared/pickers/CalendarDateTimeView';
import { DASHBOARD_TZ } from '../../lib/dashboard-helpers';

function scrollToJournalDay(element: HTMLElement) {
  if (window.matchMedia('(max-width: 767px)').matches) return;
  element.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}

export default function FinanceJournal({ date,transactionId,data,revision,onNavigate }:{date?:string;transactionId?:string;data:FinanceWorkspace;revision:number;onNavigate:(target:FinanceDestination)=>void}) {
  const [range,setRange]=useState<JournalRange|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[expanded,setExpanded]=useState<string|null>(transactionId || null);
  const initialDate=date && date<=data.end ? date : data.end;
  const [month,setMonth]=useState(initialDate.slice(0,7));
  const [selectedDate,setSelectedDate]=useState<string|null>(date ? initialDate : null);
  const [previewDate,setPreviewDate]=useState<string|null>(null);
  const dayRefs=useRef(new Map<string,HTMLElement>());
  const pendingScroll=useRef<string|null>(date ? initialDate : null);
  const {start,end}=financeMonthRange(month,data.end);
  useEffect(()=>{
    let active=true;
    const load=async()=>{setLoading(true);setError('');try{const result=await getFinanceJournal(start,end,transactionId);if(active)setRange(result);}catch(cause){if(active)setError(cause instanceof Error?cause.message:'Journal unavailable');}finally{if(active)setLoading(false);}};
    void load();return()=>{active=false;};
  },[start,end,transactionId,revision]);
  const visibleRange=range?.start===start && range.end===end ? range : null;
  const days=useMemo(()=>visibleRange ? financeActivityDays(visibleRange,transactionId) : [],[visibleRange,transactionId]);
  const entries=days.flatMap(day=>day.entries);
  useEffect(()=>{
    const target=pendingScroll.current;
    if(!target || !visibleRange)return;
    const frame=requestAnimationFrame(()=>{
      const element=dayRefs.current.get(target);
      if(element){scrollToJournalDay(element);pendingScroll.current=null;}
    });
    return()=>cancelAnimationFrame(frame);
  },[selectedDate,visibleRange]);
  const selectDay=(value:string)=>{
    pendingScroll.current=value;
    setSelectedDate(value);
    if(value===selectedDate){const element=dayRefs.current.get(value);if(element)scrollToJournalDay(element);pendingScroll.current=null;}
  };
  const changeMonth=(value:string)=>{setMonth(value);setSelectedDate(null);setPreviewDate(null);pendingScroll.current=null;};
  const selectedExists=entries.some(entry=>entry.ids.includes(transactionId || ''));
  const selectedElsewhere=visibleRange?.relatives.find(row=>row.id===transactionId && (row.date<start||row.date>end));
  if (!range && !error) return <WorkspaceLoading surface="finances" />;
  return <section className="fin-journal"><div className="fin-journal-layout">
    <FinanceActivityCalendar month={month} today={data.end} days={days} selectedDate={selectedDate} previewDate={previewDate} loading={loading||(!visibleRange&&!error)} unavailable={!!error} onSelect={selectDay} onMonth={changeMonth}/>
    <div className="fin-journal-ledger"><div className="fin-between fin-journal-title"><h2>Recent activity</h2><span className="fin-muted">Recorded transactions</span></div>
    <div className="fin-journal-tools"><JournalDatePicker date={selectedDate || undefined} end={end} onSelect={value=>onNavigate({view:'journal',date:value})}/>{(date||month!==data.end.slice(0,7))&&<button className="fin-recent-days" onClick={()=>{changeMonth(data.end.slice(0,7));onNavigate({view:'journal'});}}><History size={15} aria-hidden="true"/>This month</button>}<span className="fin-journal-period">{financeDate(start)} – {financeDate(end)}</span></div>
    {loading&&<p role="status">Loading Journal…</p>}{error&&<p role="alert">{error}</p>}{visibleRange?.truncated&&<p className="fin-notice">Showing the newest available records. Daily totals are unavailable because this month’s history is incomplete.</p>}
    {transactionId&&visibleRange&&!selectedExists&&(selectedElsewhere?<button className="fin-link" onClick={()=>onNavigate({view:'journal',date:selectedElsewhere.date,transactionId})}>View recorded transaction · {financeDate(selectedElsewhere.date)} <ArrowRight size={14}/></button>:<p role="status">This transaction is unavailable in the selected dates.</p>)}
    {visibleRange&&!entries.length&&!selectedDate&&<p className="fin-empty">No recorded transactions in these dates.</p>}
    {days.filter(day=>day.entries.length||day.date===selectedDate).map(day=><section className="fin-journal-day" key={day.date} data-selected={day.date===selectedDate} aria-label={financeDate(day.date)} ref={element=>{if(element)dayRefs.current.set(day.date,element);else dayRefs.current.delete(day.date);}}>
      <h3 className="fin-datehead">{financeDate(day.date)}{day.date===selectedDate&&<span>Selected day</span>}</h3>
      {!day.entries.length&&<p className="fin-empty">{day.complete?'No recorded transactions on this day.':'No loaded records on this day. History is incomplete.'}</p>}
      {day.entries.map(entry=>{
      const row=entry.transaction,open=entry.ids.includes(expanded || '');
      const source=entry.kind==='transfer'&&row.amountCents>0?entry.counterpart!:row;
      const destination=source===row?entry.counterpart:row;
      const otherAccount=entry.counterpart?.account || row.transferAccount || 'another account';
      const title=entry.kind==='transfer'?`${source.account} → ${destination!.account}`:entry.kind==='sent'?`Sent to ${otherAccount}`:entry.kind==='received'?`Received from ${otherAccount}`:row.payee;
      const direction=entry.kind==='transfer'||entry.kind==='sent'||entry.kind==='received'?'transfer':row.amountCents>0?'income':'outflow';
      const DirectionIcon=direction==='transfer'?ArrowLeftRight:direction==='income'?ArrowDownLeft:ArrowUpRight;
      const StatusIcon=row.reconciled||row.cleared?CheckCircle2:Clock3;
      const linked=data.utilities.flatMap(utility=>utility.statements.filter(statement=>statement.paymentTransactionIds.some(id=>entry.ids.includes(id))).map(statement=>({utility,statement})));
      return <div key={entry.id} onMouseEnter={()=>setPreviewDate(row.date)} onMouseLeave={()=>setPreviewDate(null)} onFocus={()=>setPreviewDate(row.date)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setPreviewDate(null);}}>
        <button className="fin-journal-row" data-direction={direction} aria-expanded={open} onClick={()=>setExpanded(open?null:entry.id)}><span className="fin-journal-direction" aria-hidden="true"><DirectionIcon size={16}/></span><span className="fin-journal-description"><strong>{title}</strong><small>{entry.kind==='split'?`${entry.children.length} split categories`:entry.kind==='transaction'?row.category:'Transfer'}</small></span><strong className={`fin-journal-amount ${entry.kind==='transfer'||entry.kind==='sent'||entry.kind==='received'?'fin-transfer':row.amountCents>0?'fin-income':'fin-outflow'}`}>{entry.kind==='transfer'?'':row.amountCents<0?'−':'+'}{financeMoney(Math.abs(row.amountCents))}</strong><ChevronDown size={14} className="fin-disclosure-chevron"/></button>
        <AnimatedCollapse open={open}><div className="fin-journal-detail" data-direction={direction}><div className="fin-journal-recording"><span><Check size={13} aria-hidden="true"/>Recorded in Actual</span><span className="fin-journal-status" data-settled={row.reconciled||row.cleared}><StatusIcon size={11} aria-hidden="true"/>{row.reconciled?'Reconciled':row.cleared?'Cleared':'Uncleared'}</span></div><dl className="fin-journal-facts"><div><dt><Landmark size={13} aria-hidden="true"/>Account</dt><dd>{row.account}</dd></div><div><dt><Tag size={13} aria-hidden="true"/>Category</dt><dd>{entry.kind==='split'?'Split transaction':row.category || 'Uncategorized'}</dd></div></dl>{row.notes&&<div className="fin-journal-notes"><h4><StickyNote size={13} aria-hidden="true"/>Notes</h4><p>{row.notes}</p></div>}
          {entry.incomplete&&<p>Related record unavailable. The known transaction is preserved.</p>}
          {!entry.incomplete&&row.transferAccountId&&!entry.counterpart&&<p>The other side of this transfer is not linked in Actual.</p>}
          {entry.children.length>0&&<section className="fin-journal-splits" aria-label="Split categories"><h4><Layers3 size={13} aria-hidden="true"/>Split categories</h4>{entry.children.map(child=><div className="fin-split" key={child.id} data-selected={child.id===transactionId}><span>{child.category}</span><span>{financeMoney(Math.abs(child.amountCents))}</span></div>)}</section>}
          {entry.counterpart&&entry.counterpart.date!==row.date&&<button className="fin-link" onClick={()=>onNavigate({view:'journal',date:entry.counterpart!.date,transactionId:entry.counterpart!.id})}>View other side · {financeDate(entry.counterpart.date)} <ArrowRight size={14}/></button>}
          {linked.map(({utility,statement})=><button className="fin-link" key={statement.id} onClick={()=>onNavigate({view:'utilities',utilityId:utility.identity.id,month:statement.dueDate?.slice(0,7),statementId:statement.id})}>View {utility.identity.label.toLowerCase()} bill &amp; history <ArrowRight size={14}/></button>)}
        </div></AnimatedCollapse>
      </div>;
    })}</section>)}
    </div></div>
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
