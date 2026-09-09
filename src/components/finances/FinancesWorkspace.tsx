import { getScheduleUrl } from './recurringPaymentModel';
import { useEffect,useState,useCallback,useRef } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { ArrowUpRight,Search } from 'lucide-react';
import { getFinances } from '../../api';
import type { FinanceWorkspace as WorkspaceData } from '../../../shared/types/finances';
import { financeDestination,financesHref } from './financesNavigation';
import type { FinanceDestination } from './financesNavigation';
import { financeDate,financeMoney,statementComparison,utilityOverview } from './financeWorkspaceModel';
import FinancialAttentionBadge from '../financial/FinancialAttentionBadge';
import useFinancialAttentionCount from '../financial/useFinancialAttentionCount';
import { financialHref } from '../financial/financialNavigation';
import { useUtilityPayLinks } from '../../hooks/useUtilityPayLinks';
import { isDemoMode } from '../../demo/config';
import UtilityDetail from './UtilityDetail';
import FinanceJournal from './FinanceJournal';
import RecurringPayments from './RecurringPayments';
import FinanceActivityCalendar from '../calendar/FinanceActivityCalendar';
import useFinancePaymentCalendar from '../../hooks/calendar/useFinancePaymentCalendar';
import WorkspaceLoading from '../shared/WorkspaceLoading';
import RecurringPaymentDetail from './RecurringPaymentDetail';
import FinanceDetailDrawer from './FinanceDetailDrawer';
import RecordedPaymentDetail from './RecordedPaymentDetail';
import type { FinancePayment } from '../../hooks/calendar/financePaymentsModel';
import './finances.css';

export default function FinancesWorkspace({search,active}:{search:string;active:boolean}) {
  const navigate=useNavigate();
  const destination=financeDestination(search);
  const [data,setData]=useState<WorkspaceData|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[query,setQuery]=useState('');
  const paymentCalendar=useFinancePaymentCalendar(data,revision,active&&destination.view!=='journal');
  const overviewRef=useRef<HTMLElement>(null);
  const triggerRef=useRef<HTMLElement>(null);
  const [recordedPayment,setRecordedPayment]=useState<FinancePayment|null>(null);
  const selectPaymentDay=(date:string)=>{
    paymentCalendar.setSelectedDate(date);
    if(!window.matchMedia('(max-width: 767px)').matches)overviewRef.current?.querySelector<HTMLElement>(`[data-payment-date="${date}"]`)?.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  };
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  const payLinks=useUtilityPayLinks();
  const attentionCount=useFinancialAttentionCount(active,revision);
  useEffect(()=>{
    if(!active)return;let live=true;
    const load=async()=>{setError('');try{const next=await getFinances();if(live)setData(next);}catch(cause){if(live)setError(cause instanceof Error?cause.message:'Finances unavailable');}};
    void load();return()=>{live=false;};
  },[active,revision]);
  useEffect(()=>{window.addEventListener('ea-demo-financial-changed',refresh);window.addEventListener('focus',refresh);window.addEventListener('ea-financial-event-changed',refresh);window.addEventListener('ea-actual-metadata-invalidated',refresh);return()=>{window.removeEventListener('ea-demo-financial-changed',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('ea-financial-event-changed',refresh);window.removeEventListener('ea-actual-metadata-invalidated',refresh);};},[refresh]);
  const go=(target:FinanceDestination)=>{setRecordedPayment(null);navigate(financesHref(target));};
  const rememberTrigger=()=>{const element=document.activeElement;if(element instanceof HTMLElement && element.matches('[data-finance-detail-trigger]'))triggerRef.current=element;};
  const closeDetail=()=>{setRecordedPayment(null);if(destination.view==='schedule'||destination.view==='utilities'&&destination.utilityId)navigate(financesHref({view:'utilities'}));};
  const openDetail=(target:FinanceDestination)=>{
    rememberTrigger();
    const sameUtility=target.view==='utilities'&&destination.view==='utilities'&&!!target.utilityId&&target.utilityId===destination.utilityId;
    const sameSchedule=target.view==='schedule'&&destination.view==='schedule'&&target.scheduleId===destination.scheduleId&&target.date===destination.date;
    if(!recordedPayment&&(sameUtility||sameSchedule))closeDetail();else go(target);
  };
  const openPayment=(payment:FinancePayment)=>{
    rememberTrigger();
    if(payment.status==='recorded'&&payment.target.view==='journal'){
      if(recordedPayment?.id===payment.id)closeDetail();else setRecordedPayment(payment);
    }else openDetail(payment.target);
  };
  const utility=data?.utilities.find(item=>destination.view==='utilities'?item.identity.id===destination.utilityId:destination.view==='schedule'?item.identity.scheduleIds.includes(destination.scheduleId):false);
  const month=destination.view==='utilities'?destination.month || data?.end.slice(0,7):destination.view==='schedule'?destination.date?.slice(0,7) || data?.end.slice(0,7):undefined;
  const visible=data?.utilities.filter(item=>`${item.identity.label} ${item.identity.provider}`.toLowerCase().includes(query.toLowerCase())) || [];
  const overview=visible.map(item=>({item,...utilityOverview(item,paymentCalendar.month===data!.end.slice(0,7)?data!.end:`${paymentCalendar.month}-01`)}));
  const payments=paymentCalendar.payments?.filter(item=>`${item.name} ${item.payee || ''}`.toLowerCase().includes(query.toLowerCase())) || [];
  const schedule=destination.view==='schedule'?data?.recurring.find(item=>item.scheduleId===destination.scheduleId&&(!destination.date||item.next_date===destination.date)):null;
  const actualUrl=getScheduleUrl({scheduleId:utility?.identity.scheduleIds[0] || schedule?.scheduleId},data?.actualBudgetUrl);
  const paymentScheduleIds=(utility?.identity.scheduleIds || (schedule?[schedule.scheduleId]:[])).filter(id=>payLinks[id]);
  return <main className="fin-workspace" data-view={destination.view}><header className="fin-heading"><h1>Finances</h1><div className="fin-foreground-links"><button className="relative" onClick={()=>navigate(financialHref({view:'all'}))}>Activity<ArrowUpRight size={14} aria-hidden="true"/><FinancialAttentionBadge count={attentionCount} floating/></button></div></header>
    <nav className="fin-view-nav" aria-label="Finance view"><button aria-current={destination.view!=='journal'?'page':undefined} onClick={()=>go({view:'utilities'})}>Utilities</button><button aria-current={destination.view==='journal'?'page':undefined} onClick={()=>go({view:'journal'})}>Journal</button><span>{data?.updatedAt?`Actual synced ${financeDate(data.updatedAt)}`:data?'Sync time unavailable':''}</span></nav>
    {!data&&!error&&<WorkspaceLoading surface="finances" />} {error&&<p role="alert">{error}</p>}{data?.issues.map(issue=><p className="fin-notice" key={issue}>{issue}</p>)}{data?.truncated&&<p className="fin-notice">Available history is incomplete. Missing months are not zero spending.</p>}
    {data&&(destination.view==='journal'?<FinanceJournal key={`${destination.date || "recent"}:${destination.transactionId || ""}`} date={destination.date} transactionId={destination.transactionId} data={data} revision={revision} onNavigate={go}/>:<>
      <div className="fin-grid"><section className="fin-overview" ref={overviewRef}><div className="fin-between"><h2>{new Date(`${paymentCalendar.month}-01T12:00:00`).toLocaleDateString('en-US',{month:'long'})} utilities</h2></div><label className="fin-search"><Search size={16} aria-hidden="true"/><span className="sr-only">Find utility or recurring payment</span><input type="search" placeholder="Find a utility or recurring payment" value={query} onChange={event=>setQuery(event.target.value)}/></label>
        {(['due','paid','nothing','unknown'] as const).map(status=>{const rows=overview.filter(row=>row.status===status);return rows.length?<section className="fin-utility-group" key={status}><h3>{status==='due'?'Coming due':status==='paid'?'Recorded this month':status==='nothing'?'Nothing due':'History & unavailable statements'}</h3>{rows.map(({item,statement,occurrence,amountCents,date})=><button className="fin-utility-row" data-finance-detail-trigger aria-haspopup="dialog" key={item.identity.id} data-payment-date={status==='paid'?statement?.paymentDate:date} data-selected={!!paymentCalendar.selectedDate&&paymentCalendar.selectedDate===(status==='paid'?statement?.paymentDate:date)} onMouseEnter={()=>paymentCalendar.setPreviewDate(status==='paid'?statement?.paymentDate || null:date)} onMouseLeave={()=>paymentCalendar.setPreviewDate(null)} onFocus={()=>paymentCalendar.setPreviewDate(status==='paid'?statement?.paymentDate || null:date)} onBlur={()=>paymentCalendar.setPreviewDate(null)} aria-pressed={utility?.identity.id===item.identity.id} onClick={()=>openDetail({view:'utilities',utilityId:item.identity.id,month:date?.slice(0,7) || data.end.slice(0,7),...(statement&&!statement.dueDate?{statementId:statement.id}:{})})}><span><strong>{item.identity.label}</strong><small className={status==='paid'?'fin-paid':status==='due'?'fin-due':''}>{status==='nothing'?'No payment required':status==='paid'?`Recorded${statement?.paymentDate?` ${financeDate(statement.paymentDate)}`:''}`:date?`Due ${financeDate(date)}`:'Statement unavailable'}</small></span><span className="fin-row-amount"><strong className={status==='paid'?'fin-paid':amountCents&&amountCents>0?'fin-outflow':''}>{financeMoney(amountCents)}</strong><small>{statement?statementComparison(statement,item.statements):occurrence?'Schedule estimate':'No saved bill this month'}</small></span></button>)}</section>:null;})}
        {!visible.length&&<p className="fin-empty">No matching utilities.</p>}
        <RecurringPayments payments={payments} selectedDate={paymentCalendar.selectedDate} loading={paymentCalendar.loading} error={paymentCalendar.error} truncated={paymentCalendar.truncated} onPreview={paymentCalendar.setPreviewDate} onNavigate={openPayment}/>
            </section><aside className="fin-companion" aria-label="Payment calendar">
        <div className="fin-payment-calendar-wrap"><FinanceActivityCalendar month={paymentCalendar.month} today={data.end} through={paymentCalendar.through} earliest={data.start} days={paymentCalendar.days || []} scheduledDays={paymentCalendar.scheduledDays || []} payments={paymentCalendar.payments || []} onPayment={openPayment} selectedDate={paymentCalendar.selectedDate} previewDate={paymentCalendar.previewDate?.startsWith(paymentCalendar.month)?paymentCalendar.previewDate:null} loading={paymentCalendar.loading} unavailable={!!paymentCalendar.error} onSelect={selectPaymentDay} onClearSelection={()=>paymentCalendar.setSelectedDate(null)} onMonth={paymentCalendar.changeMonth}/>
        {paymentCalendar.truncated&&<p className="fin-notice">Recorded history is incomplete. Daily totals are unavailable.</p>}

        </div>
</aside></div>
        <AnimatePresence>{active&&(recordedPayment||utility||schedule)&&<FinanceDetailDrawer triggerRef={triggerRef} onClose={closeDetail} identity={recordedPayment?.id || utility?.identity.id || schedule?.id || ''}>{recordedPayment?<RecordedPaymentDetail payment={recordedPayment} entry={paymentCalendar.days?.flatMap(day=>day.entries).find(entry=>entry.id===recordedPayment.id)} onClose={closeDetail} onNavigate={go}/>:utility&&month?<UtilityDetail key={utility.identity.id} utility={utility} month={month} statementId={destination.view==='utilities'?destination.statementId:undefined} end={data.end} onNavigate={go} onForeground={href=>navigate(href)} onClose={closeDetail}/>:schedule?<RecurringPaymentDetail schedule={schedule} onNavigate={go} onClose={closeDetail}/>:null}
        {!recordedPayment&&(utility||schedule)&&(!data.budgetId||paymentScheduleIds.length>0)&&<div className="fin-external-actions">{!data.budgetId&&<button disabled={isDemoMode()||!actualUrl} onClick={()=>actualUrl && window.open(actualUrl,'_blank','noopener,noreferrer')}>Open in Actual</button>}{paymentScheduleIds.map(id=><button key={id} disabled={isDemoMode()} onClick={()=>window.open(payLinks[id], '_blank','noopener,noreferrer')}>Pay online</button>)}{!data.budgetId&&<button onClick={()=>navigate('/settings?tab=connections#actual-budget')}>Actual connection</button>}</div>}
      </FinanceDetailDrawer>}</AnimatePresence>
    </>)}
  </main>;
}
