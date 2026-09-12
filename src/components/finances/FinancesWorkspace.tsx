import type { ReactNode } from 'react';
import { publicAssetUrl } from '@/publicAsset';
import '../shell/MobileShell.css';
import CalendarPaymentPreview from './CalendarPaymentPreview';
import { getScheduleUrl } from './recurringPaymentModel';
import { useEffect,useState,useCallback,useRef } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight,Search,ChevronLeft,ChevronRight,CalendarDays,Pencil } from 'lucide-react';
import { getFinances } from '../../api';
import type { FinanceWorkspace as WorkspaceData } from '../../../shared/types/finances';
import { financeDestination,financesHref } from './financesNavigation';
import type { FinanceDestination } from './financesNavigation';
import { financeDate } from './financeWorkspaceModel';
import { paymentPresentation, paymentCalendarPresentation } from './paymentPresentationModel';
import type { PaymentPresentationRow } from './paymentPresentationModel';
import PaymentStatusList from './PaymentStatusList';
import PaymentGroupEditor from './PaymentGroupEditor';
import { initializePaymentOrganization, reconcilePaymentOrganization } from '../../../shared/payment-groups';
import type { PaymentItem, PaymentOrganization } from '../../../shared/types/payment-groups';
import PaymentDetail from './PaymentDetail';
import { shiftFinanceMonth } from '../../hooks/calendar/financeActivityModel';
import FinancialAttentionBadge from '../financial/FinancialAttentionBadge';
import useFinancialAttentionCount from '../financial/useFinancialAttentionCount';
import { financialHref } from '../financial/financialNavigation';
import { useUtilityPayLinks } from '../../hooks/useUtilityPayLinks';
import { isDemoMode } from '../../demo/config';
import FinanceJournal from './FinanceJournal';
import FinanceActivityCalendar from '../calendar/FinanceActivityCalendar';
import useFinancePaymentCalendar from '../../hooks/calendar/useFinancePaymentCalendar';
import WorkspaceLoading from '../shared/WorkspaceLoading';
import FinanceDetailDrawer from './FinanceDetailDrawer';
import type { FinancePayment } from '../../hooks/calendar/financePaymentsModel';
import './finances.css';

export default function FinancesWorkspace({search,active,scrollTopRequestId=0,mobileShellActions}:{search:string;active:boolean;scrollTopRequestId?:number;mobileShellActions?:ReactNode}) {
  const navigate=useNavigate();
  const destination=financeDestination(search);
  const [data,setData]=useState<WorkspaceData|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[query,setQuery]=useState('');
  const paymentCalendar=useFinancePaymentCalendar(data,revision,active&&destination.view!=='journal',destination.view==='utilities'?destination.month:destination.view==='schedule'?destination.month || destination.date?.slice(0,7):undefined);
  const workspaceRef=useRef<HTMLElement>(null);
  useEffect(()=>{ if(scrollTopRequestId && workspaceRef.current) workspaceRef.current.scrollTop=0; },[scrollTopRequestId]);
  const overviewRef=useRef<HTMLElement>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    if(!active || destination.view==='journal')return;
    const find=(event:KeyboardEvent)=>{if(searchRef.current?.disabled)return;if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'&&!event.altKey){event.preventDefault();if(window.matchMedia('(max-width: 767px)').matches)navigate(financesHref({view:'utilities',month:paymentCalendar.month}));requestAnimationFrame(()=>{searchRef.current?.focus();searchRef.current?.select();});}};
    window.addEventListener('keydown',find);return()=>window.removeEventListener('keydown',find);
  },[active,destination.view,navigate,paymentCalendar.month]);
  const [calendarPreview,setCalendarPreview]=useState<{rowId:string;date:string;month:string;payment:FinancePayment}|null>(null);
  const previewTriggerRef=useRef<HTMLElement>(null);
  const triggerRef=useRef<HTMLElement>(null);
  const [showCalendar,setShowCalendar]=useState(false);
  const [organizing,setOrganizing]=useState(false);
  const [organizeWidth,setOrganizeWidth]=useState<number>();
  const reducedMotion=useReducedMotion();
  const organizeTransition={duration:reducedMotion?0:.26,ease:[.16,1,.3,1] as const};
  const organizeTrigger=useRef<HTMLButtonElement>(null);
  const loadGeneration=useRef(0);
  const selectPaymentDay=(date:string)=>{
    paymentCalendar.setSelectedDate(date);
    if(!window.matchMedia('(max-width: 767px)').matches)overviewRef.current?.querySelector<HTMLElement>(`[data-payment-date="${date}"]`)?.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  };
  const refresh=useCallback(()=>setRevision(value=>value+1),[setRevision]);
  const payLinks=useUtilityPayLinks();
  const attentionCount=useFinancialAttentionCount(active,revision);
  useEffect(()=>{
    if(!active)return;let live=true;const generation=++loadGeneration.current;
    const load=async()=>{setError('');try{const next=await getFinances();if(live&&generation===loadGeneration.current)setData(next);}catch(cause){if(live&&generation===loadGeneration.current)setError(cause instanceof Error?cause.message:'Finances unavailable');}};
    void load();return()=>{live=false;};
  },[active,revision]);
  useEffect(()=>{window.addEventListener('ea-demo-financial-changed',refresh);window.addEventListener('focus',refresh);window.addEventListener('ea-financial-event-changed',refresh);window.addEventListener('ea-actual-metadata-invalidated',refresh);return()=>{window.removeEventListener('ea-demo-financial-changed',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('ea-financial-event-changed',refresh);window.removeEventListener('ea-actual-metadata-invalidated',refresh);};},[refresh]);
  const go=(target:FinanceDestination)=>{setCalendarPreview(null);navigate(financesHref(target));};
  const rememberTrigger=()=>{const element=document.activeElement;if(element instanceof HTMLElement && element.matches('[data-finance-detail-trigger]'))triggerRef.current=element;};
  const closeDetail=()=>{if(destination.view!=='journal')navigate(financesHref({view:'utilities',month:paymentCalendar.month}));requestAnimationFrame(()=>triggerRef.current?.focus({preventScroll:true}));};
  const model=data?paymentPresentation(data,paymentCalendar.month):null;
  const rows=model?.rows || [];
  const paymentItems:PaymentItem[]=data?.paymentItems || [];
  const organization=data?.paymentOrganization || initializePaymentOrganization(data?.budgetId || '',paymentItems);
  const finishOrganizing=(saved?:PaymentOrganization)=>{if(saved){loadGeneration.current++;setData(current=>current?{...current,paymentOrganization:reconcilePaymentOrganization(saved,current.paymentItems || [])}:current);refresh();}setOrganizing(false);requestAnimationFrame(()=>organizeTrigger.current?.focus());};
  const selected=rows.find(row=>row.id===(destination.view!=='journal'?destination.rowId:undefined)) || (destination.view!=='journal'&&!destination.rowId ? rows.find(row=>destination.view==='utilities'&&destination.utilityId
    ? row.utilityId===destination.utilityId&&(!destination.statementId||row.statements.some(statement=>statement.id===destination.statementId))
    : destination.view==='schedule'&&row.scheduleId===destination.scheduleId&&(!destination.date||row.dueDate===destination.date)) : undefined);
  const openRow=(row:PaymentPresentationRow)=>{
    setCalendarPreview(null);
    rememberTrigger();
    if(selected?.id===row.id){closeDetail();return;}
    // Journal destinations describe the evidence; selecting a row keeps its details in Utilities.
    if(row.target.view!=='journal')navigate(financesHref({...row.target,month:paymentCalendar.month,rowId:row.id}));
    else navigate(financesHref({view:'utilities',month:paymentCalendar.month,rowId:row.id}));
  };
  const calendar=paymentCalendarPresentation(rows,paymentCalendar.month);
  const openPayment=(payment:FinancePayment,trigger:HTMLButtonElement)=>{
    const row=rows.find(item=>item.id===(payment.rowId || payment.id) || item.payments.some(record=>record.id===payment.id));
    if(row && payment.date){previewTriggerRef.current=trigger;paymentCalendar.setSelectedDate(payment.date);setCalendarPreview(current=>current?.rowId===row.id&&current.month===paymentCalendar.month?null:{rowId:row.id,date:payment.date!,month:paymentCalendar.month,payment});}
  };
  const changeMonth=(month:string)=>{setCalendarPreview(null);navigate(financesHref({view:'utilities',month}));paymentCalendar.changeMonth(month);};
  const previewRow=calendarPreview?.month===paymentCalendar.month?rows.find(row=>row.id===calendarPreview.rowId):undefined;
  const previewUtility=data?.utilities.find(item=>item.identity.id===previewRow?.utilityId);
  const previewPayLinks=isDemoMode()?[]:[...new Set((previewUtility?.identity.scheduleIds || (previewRow?.scheduleId?[previewRow.scheduleId]:[])).map(id=>payLinks[id]).filter((url):url is string=>!!url))];
  const visible=rows.filter(row=>`${row.name} ${row.provider}`.toLowerCase().includes(query.toLowerCase()));
  const utility=data?.utilities.find(item=>item.identity.id===selected?.utilityId);
  const actualUrl=getScheduleUrl({scheduleId:selected?.scheduleId || utility?.identity.scheduleIds[0]},data?.actualBudgetUrl);
  const paymentScheduleIds=(utility?.identity.scheduleIds || (selected?.scheduleId?[selected.scheduleId]:[])).filter(id=>payLinks[id]);
  const detail=selected&&<FinanceDetailDrawer triggerRef={triggerRef} onClose={closeDetail} identity={selected.id}>
    <PaymentDetail month={paymentCalendar.month} row={selected} historyComplete={model?.historyComplete ?? false} onNavigate={go} onForeground={href=>navigate(href)} onClose={closeDetail} actions={(!data?.budgetId||paymentScheduleIds.length>0)&&<div className="fin-external-actions">{!data?.budgetId&&<button disabled={isDemoMode()||!actualUrl} onClick={()=>actualUrl && window.open(actualUrl,'_blank','noopener,noreferrer')}>Open in Actual</button>}{paymentScheduleIds.map(id=><button className="fin-pay-online" key={id} disabled={isDemoMode()} onClick={()=>window.open(payLinks[id], '_blank','noopener,noreferrer')}>Pay online<ArrowUpRight size={14} aria-hidden="true"/></button>)}</div>}/>
  </FinanceDetailDrawer>;
  const heading=<header className={mobileShellActions ? "fin-heading fin-mobile-heading mobile-dashboard-header" : "fin-heading"}><h1>{mobileShellActions&&<img src={publicAssetUrl("favicon.svg")} alt="" width={22} height={22}/>}Finances</h1><div className="fin-foreground-links"><button className="relative" onClick={()=>navigate(financialHref({view:'all'}))}>Activity<ArrowUpRight size={14} aria-hidden="true"/><FinancialAttentionBadge count={attentionCount} floating/></button></div>{mobileShellActions}</header>;
  return <div className={mobileShellActions ? "fin-mobile-surface" : undefined} style={mobileShellActions ? undefined : {display:"contents"}}>{mobileShellActions&&heading}<main ref={workspaceRef} className="fin-workspace" data-view={destination.view}>{!mobileShellActions&&heading}
    <nav className="fin-view-nav" aria-label="Finance view"><button aria-current={destination.view!=='journal'?'page':undefined} onClick={()=>go({view:'utilities'})}>Payments</button><button aria-current={destination.view==='journal'?'page':undefined} disabled={organizing} onClick={()=>go({view:'journal'})}>Journal</button><span>{data?.updatedAt?`Actual synced ${financeDate(data.updatedAt)}`:data?'Sync time unavailable':''}</span></nav>
    {!data&&!error&&<WorkspaceLoading surface="finances" />} {error&&<p role="alert">{error}</p>}{data?.issues.map(issue=><p className="fin-notice" key={issue}>{issue}{issue.includes('configured payee')&&<button className="fin-link" onClick={()=>navigate('/settings?tab=finance#utility-mappings')}>Fix mapping<ArrowUpRight size={14}/></button>}</p>)}{data?.truncated&&<p className="fin-notice">Available history is incomplete. Missing months are not zero spending.</p>}
    {data&&(destination.view==='journal'?<FinanceJournal key={`${destination.date || "recent"}:${destination.transactionId || ""}`} date={destination.date} transactionId={destination.transactionId} data={data} revision={revision} onNavigate={go}/>:<LayoutGroup id="payment-organization"><div className="fin-grid">
      <div className="fin-payment-toolbar">
        <div className="fin-month-control">
          <button aria-label="Previous payment month" disabled={paymentCalendar.month<=data.start.slice(0,7)} onClick={()=>changeMonth(shiftFinanceMonth(paymentCalendar.month,-1))}><ChevronLeft size={16}/></button>
          <h2><button className="fin-current-month" title="Return to current month" aria-label="Return to current month" onClick={()=>changeMonth(data.end.slice(0,7))}>{new Date(`${paymentCalendar.month}-01T12:00:00`).toLocaleDateString('en-US',{month:'long',year:'numeric'})}</button></h2>
          <button aria-label="Next payment month" disabled={paymentCalendar.month>=paymentCalendar.through.slice(0,7)} onClick={()=>changeMonth(shiftFinanceMonth(paymentCalendar.month,1))}><ChevronRight size={16}/></button>
        </div>
        <label className="fin-search"><Search size={16} aria-hidden="true"/><span className="sr-only">Find payment</span><input ref={searchRef} type="search" disabled={organizing} placeholder={organizing?'Search unavailable while organizing':'Find a bill or payment'} value={query} onChange={event=>setQuery(event.target.value)}/></label>
        <div className="fin-payment-actions">
          <motion.div className="fin-organize-slot" initial={false} animate={{width:organizing?0:organizeWidth??'auto'}} transition={organizeTransition}>
            <div style={{width:organizeWidth}} inert={organizing}>
              <AnimatePresence initial={false}>
                {!organizing&&<motion.div layout="position" layoutId="organize-actions" transition={organizeTransition} exit={{opacity:0}}>
                  <button ref={organizeTrigger} className="fin-organize-trigger" disabled={!data.budgetId||!data.paymentOrganization} onClick={event=>{setOrganizeWidth(event.currentTarget.getBoundingClientRect().width);setQuery('');setCalendarPreview(null);closeDetail();setOrganizing(true);}}><Pencil size={13}/>Organize</button>
                </motion.div>}
              </AnimatePresence>
            </div>
          </motion.div>
          <button className="fin-mobile-calendar-toggle" aria-expanded={showCalendar} onClick={()=>setShowCalendar(value=>!value)}><CalendarDays size={16}/>{showCalendar?'Hide calendar':'Show calendar'}</button>
        </div>
      </div>
      <section className="fin-overview" ref={overviewRef} aria-label="Bills and payments">
        {!model?.historyComplete&&<p className="fin-notice">Payment history is incomplete. Available payments are shown; missing records do not confirm an unpaid bill.</p>}
        {organizing?<PaymentGroupEditor organization={organization} items={paymentItems} rows={rows} onSave={finishOrganizing} onCancel={()=>finishOrganizing()}/>:<PaymentStatusList key={organization.revision} organization={organization} today={data.end} rows={visible} selectedId={selected?.id} selectedDate={paymentCalendar.selectedDate} onPreview={paymentCalendar.setPreviewDate} onSelect={openRow}/>}
      </section><aside className="fin-companion" aria-label={selected?'Selected payment':'Payment calendar'}>
        <div className="fin-payment-calendar-wrap" data-mobile-open={showCalendar} hidden={!!selected}>
          <FinanceActivityCalendar preserveSelection={!!calendarPreview || !!selected} month={paymentCalendar.month} today={data.end} through={paymentCalendar.through} earliest={data.start} days={paymentCalendar.days || []} scheduledDays={calendar.scheduledDays} payments={calendar.payments} onPayment={openPayment} selectedDate={paymentCalendar.selectedDate} previewDate={paymentCalendar.previewDate?.startsWith(paymentCalendar.month)?paymentCalendar.previewDate:null} loading={paymentCalendar.loading} unavailable={!!paymentCalendar.error} onSelect={selectPaymentDay} onClearSelection={()=>paymentCalendar.setSelectedDate(null)} onMonth={changeMonth}/>
          {paymentCalendar.truncated&&<p className="fin-notice">Recorded history is incomplete. Daily totals are unavailable.</p>}
        </div>
        <AnimatePresence>{active&&detail}</AnimatePresence>
      </aside>
    </div></LayoutGroup>)}
    {active&&!selected&&destination.view!=='journal'&&previewRow&&calendarPreview&&<CalendarPaymentPreview key={previewRow.id} row={previewRow} payment={calendarPreview.payment} date={calendarPreview.date} anchorRef={previewTriggerRef} payLinks={previewPayLinks} onClose={()=>setCalendarPreview(null)} onDetails={()=>{triggerRef.current=previewTriggerRef.current;openRow(previewRow);}} onNavigate={go}/>}
  </main></div>;
}
