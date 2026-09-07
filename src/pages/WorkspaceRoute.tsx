import { useCallback, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/** The workspace lifetime is independent of its foreground destination. */
export default function WorkspaceRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const settingsOpen = useMatch("/settings") !== null;
  const origin = useRef("/");
  const originIndex = useRef<number | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    if (!settingsOpen) {
      originIndex.current = typeof window.history.state?.idx === "number" ? window.history.state.idx : null;
      origin.current = `${location.pathname}${location.search}${location.hash}`;
    } else if (!wasOpen.current) {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    wasOpen.current = settingsOpen;
  }, [location, settingsOpen]);

  const close = useCallback(() => {
    const currentIndex = window.history.state?.idx;
    if (originIndex.current !== null && typeof currentIndex === "number" && currentIndex > originIndex.current) {
      navigate(originIndex.current - currentIndex);
    } else {
      navigate(origin.current, { replace: true });
    }
  }, [navigate]);

  return (
    <>
      {children}
      <Dialog open={settingsOpen} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent
          aria-labelledby="settings-heading"
          data-suspend-calendar-hotkeys="blocking"
          data-workspace-foreground="settings"
          finalFocus={() => trigger.current?.isConnected ? trigger.current : false}
          overlayClassName="bg-[var(--sp-deep)]/70"
          overlayStyle={{ backdropFilter: "none" }}
          className="isolate flex h-[min(860px,calc(100dvh-2rem))] w-[calc(100%-1rem)] max-w-[1140px] flex-col gap-0 overflow-hidden bg-[#16161e] p-0 sm:w-[calc(100%-2rem)] sm:max-w-[1140px] [&>[data-slot=dialog-close]]:right-4 [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:size-9 [&>[data-slot=dialog-close]]:transition-transform motion-safe:[&>[data-slot=dialog-close]]:hover:-translate-y-px motion-safe:[&>[data-slot=dialog-close]]:focus-visible:-translate-y-px [&>[data-slot=dialog-close]]:focus-visible:ring-2 [&>[data-slot=dialog-close]]:active:scale-95 motion-reduce:[&>[data-slot=dialog-close]]:transition-none"
        >
          <Outlet />
        </DialogContent>
      </Dialog>
    </>
  );
}
