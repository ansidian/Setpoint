import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

const DEFAULT_ITEM_SCROLL_TOP_OFFSET = 44;
const ITEM_ACTION_SELECTOR = [
  "[data-testid='calendar-agenda-event-row']",
  "[data-testid='calendar-agenda-event-chip']",
  "[data-testid='calendar-agenda-bill-row']",
  "[data-testid='calendar-agenda-deadline-row']",
].join(", ");

function findRow(rowRefs, itemId, dateKey) {
  const keyPrefix = `${itemId}-${dateKey}`;
  return [...rowRefs.current.entries()].find(([key]) => key.startsWith(keyPrefix))?.[1] || null;
}

const AgendaRailShell = forwardRef(function AgendaRailShell({
  testId,
  groups,
  firstVisibleDateKey,
  todayKey,
  selectedDateKey,
  scrollCommand = null,
  isLoading = false,
  floatingEditorDirty = false,
  itemScrollTopOffset = DEFAULT_ITEM_SCROLL_TOP_OFFSET,
  skeleton = null,
  showSkeleton = false,
  onPassiveDateChange,
  onDirtyBlocked,
  getSectionProps,
  renderHeader,
  renderGroup,
}, ref) {
  const scrollerRef = useRef(null);
  const headerRefs = useRef(new Map());
  const rowRefs = useRef(new Map());
  const suppressPassiveUntilRef = useRef(0);
  const scrollRafRef = useRef(0);
  const handledScrollCommandIdRef = useRef(null);

  const registerHeader = (dateKey, node) => {
    if (node) headerRefs.current.set(dateKey, node);
    else headerRefs.current.delete(dateKey);
  };
  const registerRow = (key, node) => {
    if (node) rowRefs.current.set(key, node);
    else rowRefs.current.delete(key);
  };

  const scrollElementIntoView = useCallback((element, { block = "start", offsetTop = 0 } = {}) => {
    if (!element || !scrollerRef.current) return false;
    const scroller = scrollerRef.current;
    suppressPassiveUntilRef.current = performance.now() + 420;
    const scrollerRect = scroller.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const upperEdge = scrollerRect.top + offsetTop;
    const lowerEdge = scrollerRect.bottom - 10;
    let nextScrollTop = scroller.scrollTop + rect.top - scrollerRect.top - offsetTop;
    if (block === "nearest") {
      if (rect.top >= upperEdge && rect.bottom <= lowerEdge) {
        window.setTimeout(() => {
          suppressPassiveUntilRef.current = 0;
        }, 80);
        return true;
      }
      nextScrollTop = rect.top < upperEdge
        ? scroller.scrollTop + rect.top - upperEdge
        : scroller.scrollTop + rect.bottom - lowerEdge;
    }
    nextScrollTop = Math.max(0, nextScrollTop);
    const distance = Math.abs(nextScrollTop - scroller.scrollTop);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const behavior = reduceMotion || distance > scrollerRect.height * 1.7 ? "auto" : "smooth";
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top: nextScrollTop, behavior });
    } else {
      scroller.scrollTop = nextScrollTop;
    }
    window.setTimeout(() => {
      suppressPassiveUntilRef.current = 0;
    }, behavior === "smooth" ? 430 : 80);
    return true;
  }, []);

  const scrollToItem = useCallback((itemId, dateKey) => {
    const row = findRow(rowRefs, itemId, dateKey);
    return scrollElementIntoView(row || headerRefs.current.get(dateKey), {
      block: row ? "nearest" : "start",
      offsetTop: row ? itemScrollTopOffset : 0,
    });
  }, [itemScrollTopOffset, scrollElementIntoView]);

  useImperativeHandle(ref, () => ({
    scrollToDate(dateKey) {
      return scrollElementIntoView(headerRefs.current.get(dateKey), { block: "start" });
    },
    scrollToEvent(itemId, dateKey) {
      return scrollToItem(itemId, dateKey);
    },
    scrollToItem(itemId, dateKey) {
      return scrollToItem(itemId, dateKey);
    },
    scrollToToday() {
      return scrollElementIntoView(headerRefs.current.get(todayKey), { block: "start" });
    },
    scrollToFirst() {
      return scrollElementIntoView(headerRefs.current.get(firstVisibleDateKey), { block: "start" });
    },
  }), [firstVisibleDateKey, scrollElementIntoView, scrollToItem, todayKey]);

  useEffect(() => {
    if (!scrollCommand || isLoading) return undefined;
    if (scrollCommand.id && handledScrollCommandIdRef.current === scrollCommand.id) return undefined;
    const id = window.requestAnimationFrame(() => {
      let handled = false;
      if (scrollCommand.type === "today") {
        handled = scrollElementIntoView(headerRefs.current.get(todayKey), { block: "start" });
      } else if (scrollCommand.type === "date") {
        handled = scrollElementIntoView(headerRefs.current.get(scrollCommand.dateKey), { block: "start" });
      } else if (scrollCommand.type === "event" || scrollCommand.type === "item") {
        handled = scrollToItem(scrollCommand.itemId, scrollCommand.dateKey);
      }
      if (handled && scrollCommand.id) {
        handledScrollCommandIdRef.current = scrollCommand.id;
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [groups, isLoading, scrollCommand, scrollElementIntoView, scrollToItem, todayKey]);

  useEffect(() => {
    if (isLoading) return undefined;
    const targetDate = selectedDateKey || firstVisibleDateKey;
    const id = window.requestAnimationFrame(() => {
      scrollElementIntoView(headerRefs.current.get(targetDate) || headerRefs.current.get(firstVisibleDateKey), { block: "start" });
      if (targetDate && targetDate !== selectedDateKey) {
        onPassiveDateChange?.(targetDate);
      }
    });
    return () => window.cancelAnimationFrame(id);
    // Entry scroll is keyed to the visible month, not every selection update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, firstVisibleDateKey]);

  function handleScroll() {
    if (isLoading || scrollRafRef.current) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      if (performance.now() < suppressPassiveUntilRef.current) return;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const top = scroller.getBoundingClientRect().top + 4;
      let active = null;
      for (const group of groups) {
        const header = headerRefs.current.get(group.dateKey);
        if (!header) continue;
        if (header.getBoundingClientRect().top <= top + 4) active = group.dateKey;
      }
      active ||= groups[0]?.dateKey || null;
      if (!active || active === selectedDateKey) return;
      if (floatingEditorDirty) {
        onDirtyBlocked?.();
        return;
      }
      onPassiveDateChange?.(active);
    });
  }

  function suppressItemPointerPassiveSync(event) {
    if (!(event.target instanceof HTMLElement)) return;
    if (!event.target.closest(ITEM_ACTION_SELECTOR)) return;
    suppressPassiveUntilRef.current = Math.max(
      suppressPassiveUntilRef.current,
      performance.now() + 900,
    );
  }

  if (showSkeleton) return skeleton;

  return (
    <div
      ref={scrollerRef}
      data-testid={testId}
      data-calendar-local-scroll="true"
      onScroll={handleScroll}
      onPointerDownCapture={suppressItemPointerPassiveSync}
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overscrollBehavior: "contain",
        padding: "0 10px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        background: "#1f1f24",
        isolation: "isolate",
      }}
    >
      <style>
        {`
          [data-testid="${testId}"] button:focus-visible {
            outline: 2px solid color-mix(in srgb, var(--ea-accent, #cba6da) 72%, transparent);
            outline-offset: 2px;
          }
          @media (prefers-reduced-motion: reduce) {
            [data-testid="${testId}"] button {
              transition: none !important;
              transform: none !important;
            }
          }
        `}
      </style>
      {groups.map((group) => (
        <section
          key={group.dateKey}
          data-date-key={group.dateKey}
          {...(getSectionProps?.(group) || {})}
          style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, paddingBottom: 14 }}
        >
          {renderHeader?.({ group, registerHeader })}
          {renderGroup?.({ group, registerRow })}
        </section>
      ))}
    </div>
  );
});

export default AgendaRailShell;
