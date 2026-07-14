import { useCallback, useLayoutEffect, useRef } from "react";

export default function useMobileDashboardScrollRestoration({ isMobile, tab }) {
  const scrollRef = useRef(null);
  const dashboardScrollTopRef = useRef(0);

  const onScroll = useCallback((event) => {
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

  return { scrollRef, onScroll };
}
