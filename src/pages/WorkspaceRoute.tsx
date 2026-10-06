import { useCallback, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import './workspace-route.css';

/** The Settings foreground: opens over the current workspace and returns to where it was opened. */
export default function WorkspaceRoute({ children }: { children:ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const open = location.pathname === '/settings';
  const origin = useRef('/'); const originIndex = useRef<number|null>(null);
  const trigger = useRef<HTMLElement|null>(null); const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (!open) {
      origin.current = `${location.pathname}${location.search}${location.hash}`;
      originIndex.current = window.history.state?.idx ?? null;
    } else if (!wasOpen.current) trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    wasOpen.current = open;
  },[location,open]);
  const close = useCallback(() => {
    const currentIndex = window.history.state?.idx;
    if (originIndex.current !== null && typeof currentIndex === 'number' && currentIndex > originIndex.current) navigate(originIndex.current - currentIndex);
    else navigate(origin.current, { replace:true });
  },[navigate]);
  return <>
    {children}
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent aria-labelledby="settings-heading"
        data-suspend-calendar-hotkeys="blocking" data-workspace-foreground="settings"
        finalFocus={() => trigger.current?.isConnected ? trigger.current : false}
        overlayClassName="bg-[var(--sp-deep)]/70" overlayStyle={{ backdropFilter:'none' }}
        className="isolate flex flex-col gap-0 overflow-hidden bg-[#16161e] p-0 [&>[data-slot=dialog-close]]:right-4 [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:size-9 [&>[data-slot=dialog-close]]:transition-transform motion-safe:[&>[data-slot=dialog-close]]:hover:-translate-y-px motion-safe:[&>[data-slot=dialog-close]]:focus-visible:-translate-y-px [&>[data-slot=dialog-close]]:focus-visible:ring-2 [&>[data-slot=dialog-close]]:active:scale-95 motion-reduce:[&>[data-slot=dialog-close]]:transition-none">
        <div className="workspace-foreground-frame">
          <div className="flex min-h-0 flex-1 flex-col"><Outlet /></div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
