import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { financialReference } from './financialNavigation';
import { useLocation, useNavigate } from 'react-router';

/** Browser history and in-surface actions share one inline discard decision. */
export function useFinancialNavigationGuard() {
  const location = useLocation(); const navigate = useNavigate();
  const [accepted,setAccepted] = useState(location);
  const [dirty,setDirty] = useState(false);
  const [pending,setPending] = useState<(()=>void)|null>(null);
  const draftReference = useRef<string|undefined>(JSON.stringify(financialReference(new URLSearchParams(location.search))));
  const acceptedIndex = useRef<number>(window.history.state?.idx || 0);
  const bypass = useRef(false);
  const focusReturn = useRef<HTMLElement|null>(null);
  const restoring = useRef(false);
  const dirtyRef = useRef(false);
  const setDraftDirty = useCallback((value:boolean) => { dirtyRef.current = value; setDirty(value); },[]);
  const request = useCallback((action:()=>void) => {
    if (dirtyRef.current) { focusReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPending(() => action); } else action();
  },[]);
  useLayoutEffect(() => {
    if (location.key === accepted.key) { restoring.current = false; return; }
    if (restoring.current) { restoring.current = false; return; }
    const index = window.history.state?.idx || 0;
    const targetReference = JSON.stringify(financialReference(new URLSearchParams(location.search)));
    const sameDraft = targetReference !== undefined && targetReference === draftReference.current;
    if (dirtyRef.current && !bypass.current && !sameDraft) {
      const target = `${location.pathname}${location.search}${location.hash}`;
      const delta = acceptedIndex.current - index;
      setPending(() => () => { bypass.current = true; navigate(target); });
      restoring.current = true;
      if (delta) navigate(delta); else navigate(`${accepted.pathname}${accepted.search}${accepted.hash}`, { replace:true });
      return;
    }
    if (targetReference !== undefined) draftReference.current = targetReference;
    if (location.pathname !== '/finance' && location.pathname !== '/settings') draftReference.current = undefined;
    bypass.current = false; acceptedIndex.current = index; setAccepted(location);
  },[location,accepted,navigate]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event:BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload',unload);
    return () => window.removeEventListener('beforeunload',unload);
  },[dirty]);
  const discard = () => { const action = pending; setPending(null); setDraftDirty(false); bypass.current = true; action?.(); };
  const allow = useCallback((action:()=>void) => { bypass.current = true; action(); },[]);
  return { accepted, dirty, pending, setDraftDirty, request, discard, keep:()=>{ setPending(null); requestAnimationFrame(() => focusReturn.current?.focus()); }, allow };
}
