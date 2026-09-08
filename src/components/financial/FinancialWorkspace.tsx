import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, CircleAlert, CircleMinus, Clock3, Inbox, List, Wallet, X } from 'lucide-react';
import Dropdown from '../shared/Dropdown';
import AnimatedHeight from '../shared/AnimatedHeight';
import { getFinancialActivity, listFinancialActivity } from '../../api';
import type { FinancialActivity, FinancialActivityPage, FinancialActivityQuery } from '../../../shared/types/financial-activity';
import FinancialRecord from './FinancialRecord';
import FinancialAttentionBadge from './FinancialAttentionBadge';
import useFinancialAttentionCount from './useFinancialAttentionCount';
import FinancialEmailRecord from './FinancialEmailRecord';
import { financialHref, financialReference } from './financialNavigation';
import './financial.css';
import { activityFacts, activityAmount, activityReviewReason } from './financialActivityPresentation';

export default function FinancialWorkspace({ search,onNavigate,onClose,onRepair,onDirty,registerBack,requestDiscard }: {
  requestDiscard:(action:()=>void)=>void; search:string; onNavigate:(href:string)=>void; onClose:()=>void; onRepair:()=>void; onDirty:(dirty:boolean)=>void; registerBack:(back:(()=>boolean)|null)=>void;
}) {
  const params = new URLSearchParams(search);
  const reference = financialReference(params);
  const referenceKey = JSON.stringify(reference);
  const view = (params.get('view') || 'needs_attention') as FinancialActivityQuery['view'];
  const query:FinancialActivityQuery = { view, ...(params.get('source') ? { source:params.get('source') as FinancialActivityQuery['source'] } : {}), ...(params.get('context') ? { context:params.get('context') as FinancialActivityQuery['context'] } : {}), ...(params.get('runId') ? { runId:params.get('runId')! } : {}), offset:Number(params.get('offset') || 0) };
  const queryKey = JSON.stringify(query);
  const emailUid = params.get('financialEmail');
  const list = params.get('financial') === 'list' && !emailUid;
  const showDetail = Boolean(reference) && params.get('showList') !== '1';
  const [page,setPage] = useState<FinancialActivityPage|null>(null);
  const [selected,setSelected] = useState<FinancialActivity|null>(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const [revision,setRevision] = useState(0);
  const attentionCount = useFinancialAttentionCount(list,revision,query);
  const listRef = useRef<HTMLDivElement>(null);
  const scrolls = useRef(new Map<string,number>());
  const processingReference = useRef<string|null>(null);
  const refresh = useCallback(() => setRevision(value => value + 1),[]);
  const recordChanged = useCallback((processing = false) => {
    if (processing) processingReference.current = referenceKey;
    window.dispatchEvent(new Event('ea-financial-event-changed'));
  },[referenceKey]);
  useEffect(() => {
    if (emailUid) return;
    let active = true; setLoading(true); setError('');
    const load = async () => {
      try { const next = await listFinancialActivity(JSON.parse(queryKey)); if (active) setPage(next); }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Could not refresh financial activity.'); }
      finally { if (active) setLoading(false); }
    };
    void load(); return () => { active = false; };
  },[queryKey,revision,emailUid]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ref = JSON.parse(referenceKey);
    if (!ref) { setSelected(null); return; }
    setSelected(current => JSON.stringify(current?.reference) === referenceKey ? current : null);
    // Publications are hints. Keep one selected pending original moving even if one is missed.
    // Corrections own their journal polling; history/list reads do not need an interval.
    let wasProcessing = processingReference.current === referenceKey;
    const load = async () => {
      try {
        const value = await getFinancialActivity(ref);
        if (!active) return;
        setSelected(value);
        const processing = value.status === 'processing' && !value.correction;
        processingReference.current = processing ? referenceKey : null;
        if (wasProcessing && !processing) refresh();
        wasProcessing = processing;
        if (processing) timer = setTimeout(() => void load(),5000);
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'This record is unavailable.');
          if (wasProcessing) timer = setTimeout(() => void load(),5000);
        }
      }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  },[referenceKey,revision,refresh]);
  useEffect(() => {
    window.addEventListener('focus',refresh); window.addEventListener('ea-financial-event-changed',refresh);
    return () => { window.removeEventListener('focus',refresh); window.removeEventListener('ea-financial-event-changed',refresh); };
  },[refresh]);
  useEffect(() => {
    if (showDetail) document.querySelector<HTMLElement>('.financial-detail article h3')?.focus();
    else listRef.current?.querySelector<HTMLElement>('[aria-current=true]')?.focus();
  },[referenceKey,showDetail,selected?.id]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = scrolls.current.get(queryKey) || 0; },[queryKey]);
  const changeQuery = (patch:Partial<FinancialActivityQuery>) => onNavigate(`${financialHref({ ...query,...patch,offset:patch.offset ?? 0 },reference,true)}${params.get('showList') === '1' ? '&showList=1' : ''}`);
  if (emailUid) return <div className="financial-surface">
    <header className="financial-toolbar"><h2 id="financial-heading"><Wallet size={18} className="text-[var(--primary)]" aria-hidden="true" />Actual record</h2><button onClick={onClose} aria-label="Close financial activity" className="financial-button financial-icon-button"><X size={16} /></button></header>
    <div className="financial-toolbar"><button className="financial-button financial-back" onClick={() => onNavigate(financialHref(query))}><ArrowLeft size={14} />Back to activity</button></div>
    <div className="financial-detail"><FinancialEmailRecord key={emailUid} emailUid={emailUid!} /></div>
  </div>;
  return <div className="financial-surface">
    <header className="financial-toolbar"><h2 id="financial-heading"><Wallet size={18} className="text-[var(--primary)]" aria-hidden="true" />{list ? 'Financial activity' : selected?.status === 'needs_attention' ? 'Review record' : 'Financial record'}</h2><button onClick={onClose} aria-label="Close financial activity" className="financial-button financial-icon-button"><X size={16} /></button></header>
    {list && <div className="financial-toolbar financial-filters" data-selected={showDetail}>
      <div className="financial-view-switch" role="group" aria-label="Activity status">
      <button className="financial-button" aria-pressed={view === 'all'} onClick={() => changeQuery({ view:'all' })}><List size={14} />All</button>
      <button className="financial-button" aria-pressed={view === 'needs_attention'} onClick={() => changeQuery({ view:'needs_attention' })}><CircleAlert size={14} />Needs attention<FinancialAttentionBadge count={attentionCount}/></button><button className="financial-button" aria-pressed={view === 'completed'} onClick={() => changeQuery({ view:'completed' })}><CheckCircle2 size={14} />Completed</button></div>
      <div className="financial-field financial-filter-source"><span>Source</span><Dropdown ariaLabel="Source" value={query.source || ''} onChange={source => changeQuery({ source:source as FinancialActivityQuery['source'] || undefined })} options={[{ id:"",name:"All sources" },{ id:"managed",name:"Financial emails" },{ id:"amazon",name:"Amazon imports" },{ id:"paypal",name:"PayPal imports" },{ id:"generic",name:"Other receipts" }]} /></div>
      {query.runId && <button className="financial-button" onClick={() => changeQuery({ runId:undefined })}>Clear batch filter</button>}
    </div>}
    {error && <div className="financial-toolbar financial-error" role="alert">{error} Saved details and entered drafts are retained.<button className="financial-button" disabled={loading} onClick={refresh}>Try again</button></div>}
    <div className="financial-body" data-selected={showDetail}>
      {list && <div className="financial-list" ref={listRef} onScroll={event => scrolls.current.set(queryKey,event.currentTarget.scrollTop)} aria-label="Financial activity list">
        {loading && !page && <p role="status" className="financial-note">Loading financial activity…</p>}
        <AnimatedHeight><div className="space-y-1 p-1">{page?.items.map(item => <button key={item.id} className="financial-row" aria-current={selected?.id === item.id} onClick={() => onNavigate(financialHref(query,item.reference,true))}>
          <span className="financial-row-title"><strong>{item.payee || item.subject || 'Financial record'}</strong><ChevronRight size={14} aria-hidden="true" /></span>
          <span className="financial-row-meta"><span className="financial-status" data-tone={item.status === 'completed' ? 'success' : item.status === 'needs_attention' ? 'attention' : 'muted'}>{item.status === 'completed' ? <CheckCircle2 size={13} /> : item.status === 'processing' ? <Clock3 size={13} /> : item.status === 'dismissed' ? <CircleMinus size={13} /> : <CircleAlert size={13} />}{item.status === 'completed' ? 'Completed' : item.status === 'processing' ? 'Processing' : item.status === 'dismissed' ? 'Dismissed' : 'Needs attention'}</span><span className="financial-row-amount">{activityAmount(item)}</span></span>
          <span className="financial-note">{activityFacts(item).label}</span>
          {item.emailUids.length > 1 && <span className="financial-note">{item.emailUids.length} related emails · one record</span>}
          {item.status !== 'completed' && <span className="financial-note">{activityReviewReason(item)}</span>}
        </button>)}</div></AnimatedHeight>
        {list && view === 'needs_attention' && selected?.status === 'completed' && <div className="financial-note p-3 space-y-3"><p>This record has moved to Completed.</p><button className="financial-button" onClick={() => changeQuery({ view:'completed' })}>View completed activity</button></div>}
        {page?.total === 0 && !(view === 'needs_attention' && selected?.status === 'completed') && <p className="financial-note p-3">{query.source || query.runId ? 'No records match these filters.' : view === 'completed' ? 'No completed financial activity yet.' : view === 'all' ? 'No financial activity yet.' : 'No financial records need your attention.'}</p>}
        {page && page.total > 20 && <div className="flex flex-wrap gap-2 mt-4"><button className="financial-button" disabled={loading || !page.offset} onClick={() => changeQuery({ offset:Math.max(0,page.offset - 20) })}>Previous</button><button className="financial-button" disabled={loading || page.offset + 20 >= page.total} onClick={() => changeQuery({ offset:page.offset + 20 })}>Next</button><p>{page.offset + 1}–{Math.min(page.offset + 20,page.total)} of {page.total}</p></div>}
      </div>}
      <div className="financial-detail">
        {!list && reference && <button type="button" className="financial-button financial-back mb-4" onClick={() => onNavigate(financialHref(query))}><ArrowLeft size={14} />{view === 'needs_attention' ? 'Back to review' : 'Back to activity'}</button>}
        {list && reference && <button className="financial-button financial-back financial-mobile-back mb-4" onClick={() => onNavigate(`${financialHref(query,reference,true)}&showList=1`)}><ArrowLeft size={14} />Back to list</button>}
        {selected ? <FinancialRecord key={selected.id} activity={selected} onDirty={onDirty} onChanged={recordChanged} onRepair={onRepair} registerBack={registerBack} requestDiscard={requestDiscard} /> : <p role="status" className="financial-empty financial-note"><Inbox size={24} aria-hidden="true" />{reference ? 'Loading the selected record…' : 'Select a record to inspect its result and source evidence.'}</p>}
      </div>
    </div>
  </div>;
}
