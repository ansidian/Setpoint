import { useCallback, useLayoutEffect, useRef } from "react";
import type { UIEvent } from "react";
import type { DashboardTab } from "./dashboardShellModel";

export default function useMobileDashboardScrollRestoration({ isMobile, tab }: { isMobile: boolean; tab: DashboardTab }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dashboardScrollTopRef = useRef(0);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (isMobile && tab === "dashboard") {
      dashboardScrollTopRef.current = event.currentTarget.scrollTop;
    }
  }, [isMobile, tab]);

  useLayoutEffect(() => {
    if (!isMobile || tab !== "dashboard") return undefined;
    const element = scrollRef.current;
    if (!element) return undefined;
    const target = dashboardScrollTopRef.current;
    element.scrollTop = target;
    // Switching through a shorter tab can clamp the shared scroller before the
    // dashboard content expands again. Reapply after that reveal has painted.
    const frame = window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = target;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isMobile, tab]);

  const scrollToTop = useCallback(() => {
    dashboardScrollTopRef.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  return { scrollRef, onScroll, scrollToTop };
}
