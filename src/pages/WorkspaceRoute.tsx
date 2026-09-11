import { WorkspaceLocationContext } from '../context/WorkspaceLocationContext';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import FinancialWorkspace from '../components/financial/FinancialWorkspace';
import { financialReference, financialSearch, legacyFinancialHref } from '../components/financial/financialNavigation';
import { useFinancialNavigationGuard } from '../components/financial/useFinancialNavigationGuard';
import AnimatedCollapse from '../components/shared/AnimatedCollapse';
import { ArrowLeft, CircleAlert, Trash2 } from 'lucide-react';

/** One foreground owner; repair hides (rather than unmounts) the retained financial editor. */
export default function WorkspaceRoute({ children }: { children:ReactNode }) {
  const navigate = useNavigate();
  const guard = useFinancialNavigationGuard();
  const location = guard.accepted;
  const legacyHref = legacyFinancialHref(location);
  const financial = location.pathname === '/finance' || legacyHref !== null;
  const open = location.pathname === '/settings' || financial;
  const search = financialSearch(legacyHref?.split('?')[1] ?? location.search);
  const [retainedSearch,setRetainedSearch] = useState<string|null>(financial ? search : null);
  const [repair,setRepair] = useState(false);
  const origin = useRef('/'); const originIndex = useRef<number|null>(null);
  const trigger = useRef<HTMLElement|null>(null); const wasOpen = useRef(false);
  const backStep = useRef<(()=>boolean)|null>(null);
  const [previousLocation,setPreviousLocation] = useState(location);
  const { request,allow,setDraftDirty } = guard;
  if (previousLocation.key !== location.key) {
    setPreviousLocation(location);
    if (!open) { setRetainedSearch(null); setRepair(false); }
    else if (!financial && !repair) setRetainedSearch(null);
    if (financial) {
      setRetainedSearch(search); setRepair(false);
    }
  }
  useLayoutEffect(() => {
    if (legacyHref) allow(() => navigate(legacyHref, { replace:true }));
  },[legacyHref,allow,navigate]);
  useLayoutEffect(() => {
    if (!open) {
      origin.current = `${location.pathname}${location.search}${location.hash}`;
      originIndex.current = window.history.state?.idx ?? null;
    } else if (!wasOpen.current) trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    wasOpen.current = open;
  },[location,open]);
  const closeNow = useCallback(() => {
    const currentIndex = window.history.state?.idx;
    if (originIndex.current !== null && typeof currentIndex === 'number' && currentIndex > originIndex.current) navigate(originIndex.current - currentIndex);
    else navigate(origin.current, { replace:true });
  },[navigate]);
  const close = useCallback(() => request(closeNow),[request,closeNow]);
  const registerBack = useCallback((back:(()=>boolean)|null) => { backStep.current = back; },[]);
  const navigateFinancial = useCallback((href:string) => {
    const sameRecord = JSON.stringify(financialReference(new URLSearchParams(href.split('?')[1]))) === JSON.stringify(financialReference(new URLSearchParams(location.search)));
    if (sameRecord) allow(() => navigate(href)); else request(() => navigate(href));
  },[request,allow,navigate,location.search]);
  const repairConnection = useCallback(() => {
    setRepair(true); allow(() => navigate('/settings?tab=connections#actual-budget'));
  },[allow,navigate]);
  const returnRecord = () => { setRepair(false); allow(() => navigate(`/finance${retainedSearch}`, { replace:true })); };
  return <>
    <WorkspaceLocationContext value={location}>{children}</WorkspaceLocationContext>
    <Dialog open={open} onOpenChange={value => { if (!value) { if (guard.pending) guard.keep(); else if (repair) returnRecord(); else if (!backStep.current?.()) close(); } }}>
      <DialogContent aria-labelledby={financial || repair ? 'financial-heading' : 'settings-heading'}
        data-suspend-calendar-hotkeys="blocking" data-workspace-foreground={financial ? new URLSearchParams(search).get('financial') === 'record' ? 'record' : 'finance' : 'settings'}
        finalFocus={() => trigger.current?.isConnected ? trigger.current : false}
        overlayClassName="bg-[var(--sp-deep)]/70" overlayStyle={{ backdropFilter:'none' }}
        showCloseButton={!financial && !repair}
        className="isolate flex flex-col gap-0 overflow-hidden bg-[#16161e] p-0 [&>[data-slot=dialog-close]]:right-4 [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:size-9 [&>[data-slot=dialog-close]]:transition-transform motion-safe:[&>[data-slot=dialog-close]]:hover:-translate-y-px motion-safe:[&>[data-slot=dialog-close]]:focus-visible:-translate-y-px [&>[data-slot=dialog-close]]:focus-visible:ring-2 [&>[data-slot=dialog-close]]:active:scale-95 motion-reduce:[&>[data-slot=dialog-close]]:transition-none">
        <div className="workspace-foreground-frame">
        <AnimatedCollapse open={Boolean(guard.pending)} style={{ flexShrink:0 }}><section className="financial-discard" role="alert" aria-label="Unsaved changes"><h3><CircleAlert size={16} />Discard this draft?</h3><p>Your changes have not been saved to Actual.</p><div className="financial-actions"><button autoFocus className="financial-button financial-primary" onClick={guard.keep}><ArrowLeft size={14} />Keep editing</button><button className="financial-button financial-danger" onClick={guard.discard}><Trash2 size={14} />Discard draft and continue</button></div></section></AnimatedCollapse>
        {repair && <div className="financial-toolbar"><h2 id="financial-heading">Actual connection</h2><button className="financial-button financial-action financial-back" onClick={returnRecord}><ArrowLeft size={14} />{new URLSearchParams(retainedSearch || '').get('financial') === 'record' ? 'Back to record' : 'Back to activity'}</button></div>}
        {retainedSearch && <div className="financial-retained flex min-h-0 flex-col" inert={Boolean(guard.pending)} hidden={!financial} style={!financial ? { display:'none' } : undefined}><FinancialWorkspace search={financial ? search : retainedSearch} onNavigate={navigateFinancial} onClose={close} onRepair={repairConnection} onDirty={setDraftDirty} registerBack={registerBack} requestDiscard={request} /></div>}
        {!financial && <div className="flex min-h-0 flex-1 flex-col"><Outlet /></div>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
