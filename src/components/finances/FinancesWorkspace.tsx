import { getScheduleUrl } from './recurringPaymentModel';
import { useEffect,useState,useCallback } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight,ReceiptText } from 'lucide-react';
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
import RecurringPaymentDetail from './RecurringPaymentDetail';
import './finances.css';

export default function FinancesWorkspace({search,active}:{search:string;active:boolean}) {
  const navigate=useNavigate();
  const destination=financeDestination(search);
  const [recurringOpen,setRecurringOpen]=useState(false);
  const [data,setData]=useState<WorkspaceData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0),[query,setQuery]=useState('');
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  const payLinks=useUtilityPayLinks();
  const attentionCount=useFinancialAttentionCount(active,revision);
  useEffect(()=>{
    if(!active)return;let live=true;
    const load=async()=>{setLoading(true);setError('');try{const next=await getFinances();if(live)setData(next);}catch(cause){if(live)setError(cause instanceof Error?cause.message:'Finances unavailable');}finally{if(live)setLoading(false);}};
    void load();return()=>{live=false;};
  },[active,revision]);
  useEffect(()=>{window.addEventListener('ea-demo-financial-changed',refresh);window.addEventListener('focus',refresh);window.addEventListener('ea-financial-event-changed',refresh);window.addEventListener('ea-actual-metadata-invalidated',refresh);return()=>{window.removeEventListener('ea-demo-financial-changed',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('ea-financial-event-changed',refresh);window.removeEventListener('ea-actual-metadata-invalidated',refresh);};},[refresh]);
  const go=(target:FinanceDestination)=>navigate(financesHref(target));
  const utility=data?.utilities.find(item=>destination.view==='utilities'?item.identity.id===destination.utilityId:destination.view==='schedule'?item.identity.scheduleIds.includes(destination.scheduleId):false);
  const month=destination.view==='utilities'?destination.month || data?.end.slice(0,7):destination.view==='schedule'?destination.date?.slice(0,7) || data?.end.slice(0,7):undefined;
  const visible=data?.utilities.filter(item=>`${item.identity.label} ${item.identity.provider}`.toLowerCase().includes(query.toLowerCase())) || [];
  const overview=visible.map(item=>({item,...utilityOverview(item,data!.end)}));
  const recurring=data?.recurring.filter(item=>`${item.name} ${item.payee}`.toLowerCase().includes(query.toLowerCase())) || [];
  const schedule=destination.view==='schedule'?data?.recurring.find(item=>item.scheduleId===destination.scheduleId&&(!destination.date||item.next_date===destination.date)):null;
  const actualUrl=getScheduleUrl({scheduleId:utility?.identity.scheduleIds[0] || schedule?.scheduleId},data?.actualBudgetUrl);
  const paymentScheduleIds=(utility?.identity.scheduleIds || (schedule?[schedule.scheduleId]:[])).filter(id=>payLinks[id]);
  return <main className="fin-workspace" data-view={destination.view}><header className="fin-heading"><h1>Finances</h1></header>
    <nav className="fin-view-nav" aria-label="Finance view"><button aria-current={destination.view!=='journal'?'page':undefined} onClick={()=>go({view:'utilities'})}>Utilities</button><button aria-current={destination.view==='journal'?'page':undefined} onClick={()=>go({view:'journal'})}>Journal</button><span>{data?.updatedAt?`Actual synced ${financeDate(data.updatedAt)}`:'Sync time unavailable'}</span></nav>
    <div className="fin-foreground-links"><button className="relative" onClick={()=>navigate(financialHref({view:'all'}))}>Activity<FinancialAttentionBadge count={attentionCount} floating/></button></div>
    {loading&&!data&&<p role="status">Loading Finances…</p>}{error&&<p role="alert">{error}</p>}{data?.issues.map(issue=><p className="fin-notice" key={issue}>{issue}</p>)}{data?.truncated&&<p className="fin-notice">Available history is incomplete. Missing months are not zero spending.</p>}
    {data&&(destination.view==='journal'?<FinanceJournal key={`${destination.date || "recent"}:${destination.transactionId || ""}`} date={destination.date} transactionId={destination.transactionId} data={data} revision={revision} onNavigate={go}/>:<>
      <div className="fin-grid" data-detail={!!utility||!!schedule}><section className="fin-overview"><div className="fin-between"><h2>{new Date(`${data.end.slice(0,7)}-01T12:00:00`).toLocaleDateString('en-US',{month:'long'})} utilities</h2></div><label className="fin-search"><span className="sr-only">Find utility or recurring payment</span><input type="search" placeholder="Find a utility or recurring payment" value={query} onChange={event=>setQuery(event.target.value)}/></label>
        {(['due','paid','nothing','unknown'] as const).map(status=>{const rows=overview.filter(row=>row.status===status);return rows.length?<section className="fin-utility-group" key={status}><h3>{status==='due'?'Coming due':status==='paid'?'Paid this month':status==='nothing'?'Nothing due':'History & unavailable statements'}</h3>{rows.map(({item,statement,occurrence,amountCents,date})=><button className="fin-utility-row" key={item.identity.id} aria-pressed={utility?.identity.id===item.identity.id} onClick={()=>go({view:'utilities',utilityId:item.identity.id,month:date?.slice(0,7) || data.end.slice(0,7),...(statement&&!statement.dueDate?{statementId:statement.id}:{})})}><span><strong>{item.identity.label}</strong><small className={status==='paid'?'fin-paid':status==='due'?'fin-due':''}>{status==='nothing'?'No payment required':status==='paid'?`Recorded${statement?.paymentDate?` ${financeDate(statement.paymentDate)}`:''}`:date?`Due ${financeDate(date)}`:'Statement unavailable'}</small></span><span className="fin-row-amount"><strong>{financeMoney(amountCents)}</strong><small>{statement?statementComparison(statement,item.statements):occurrence?'Schedule estimate':'No saved bill this month'}</small></span></button>)}</section>:null;})}
        {!visible.length&&<p className="fin-empty">No matching utilities.</p>}
        <details className="fin-recurring" open={recurringOpen||!!schedule||!!query} onToggle={event=>setRecurringOpen(event.currentTarget.open)}><summary><ChevronRight size={15} aria-hidden="true"/><span>Other recurring payments</span><span className="fin-recurring-count">{recurring.length}</span></summary>{recurring.map(item=><button key={item.id} aria-pressed={schedule?.id===item.id} className="fin-utility-row" onClick={()=>go({view:'schedule',scheduleId:item.scheduleId,date:item.next_date})}><span><strong>{item.name}</strong><small>{item.paid?'Recorded':'Scheduled'} · {financeDate(item.next_date)}</small></span><strong>{financeMoney(Math.round(item.amount*100))}</strong></button>)}{!recurring.length&&<p>No matching recurring payments.</p>}</details>
      </section><aside className="fin-detail" aria-label="Financial details">{utility&&month?<UtilityDetail key={utility.identity.id} utility={utility} month={month} statementId={destination.view==='utilities'?destination.statementId:undefined} end={data.end} onNavigate={go} onForeground={href=>navigate(href)} onClose={()=>go({view:'utilities'})}/>:schedule?<RecurringPaymentDetail schedule={schedule} onNavigate={go} onClose={()=>go({view:'utilities'})}/>:<section className="fin-detail-empty"><ReceiptText size={40} strokeWidth={1.25} aria-hidden="true"/><h2>{query&&!visible.length?'No matching utilities':data.budgetId?'Your bills, in detail':'Connect your finances'}</h2><p>{query&&!visible.length?'Try another name, or choose a recurring payment from the results.':data.budgetId?'Explore a utility’s bills, source statements, and recorded payments.':'Connect Actual to see your utility bills and recurring payments here.'}</p></section>}
        {(utility||schedule)&&(!data.budgetId||paymentScheduleIds.length>0)&&<div className="fin-external-actions">{!data.budgetId&&<button disabled={isDemoMode()||!actualUrl} onClick={()=>actualUrl && window.open(actualUrl,'_blank','noopener,noreferrer')}>Open in Actual</button>}{paymentScheduleIds.map(id=><button key={id} disabled={isDemoMode()} onClick={()=>window.open(payLinks[id], '_blank','noopener,noreferrer')}>Pay online</button>)}{!data.budgetId&&<button onClick={()=>navigate('/settings?tab=connections#actual-budget')}>Actual connection</button>}</div>}
      </aside></div>
    </>)}
  </main>;
}
