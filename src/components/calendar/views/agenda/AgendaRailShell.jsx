import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

const DEFAULT_ITEM_SCROLL_TOP_OFFSET = 44;
const ITEM_ACTION_SELECTOR = [
  "[data-testid='calendar-agenda-event-row']",
  "[data-testid='calendar-agenda-event-chip']",
  "[data-testid='calendar-agenda-bill-row']",
  "[data-testid='calendar-agenda-deadline-row']",
].join(", ");

function findRow(rowRefs, itemId, dateKey) {
  const itemIdText = String(itemId ?? "");
  const dateKeyText = String(dateKey ?? "");
  if (!itemIdText || !dateKeyText) return null;
  const simpleKeyPrefix = `${itemIdText}-${dateKeyText}`;
  const deadlineKeyNeedle = `:${itemIdText}-${dateKeyText}`;
  for (const [key, row] of rowRefs.current.entries()) {
    if (!row?.isConnected) continue;
    if (key.startsWith(simpleKeyPrefix) || key.includes(deadlineKeyNeedle)) return row;
    const itemElement = row.querySelector?.("[data-item-id]");
    if (itemElement && String(itemElement.getAttribute("data-item-id")) === itemIdText && key.endsWith(`-${dateKeyText}`)) {
      return row;
    }
    const matchIds = String(itemElement?.getAttribute("data-calendar-match-item-ids") || "")
      .split(/\s+/)
      .filter(Boolean);
    if (matchIds.includes(itemIdText) && key.endsWith(`-${dateKeyText}`)) {
      return row;
    }
  }
  return null;
}

function findRowAnchor(rowRefs, itemId, dateKey) {
  const row = findRow(rowRefs, itemId, dateKey);
  if (!row) return null;
  return row.matches?.(ITEM_ACTION_SELECTOR)
    ? row
    : row.querySelector?.(ITEM_ACTION_SELECTOR) || row;
}

const AgendaRailShell = forwardRef(function AgendaRailShell({
  testId,
  groups,
  firstVisibleDateKey,
  todayKey,
  selectedDateKey,
  scrollCommand = null,
  entryScrollTargetDateKey = null,
  isLoading = false,
  floatingEditorDirty = false,
  entryScrollReady = true,
  itemScrollTopOffset = DEFAULT_ITEM_SCROLL_TOP_OFFSET,
  skeleton = null,
  showSkeleton = false,
  onPassiveDateChange,
  getSectionProps,
  renderHeader,
  renderGroup,
}, ref) {
  const scrollerRef = useRef(null);
  const headerRefs = useRef(new Map());
  const sectionRefs = useRef(new Map());
  const rowRefs = useRef(new Map());
  const contentRefs = useRef(new Map());
  const suppressPassiveUntilRef = useRef(0);
  const scrollRafRef = useRef(0);
  const handledScrollCommandIdRef = useRef(null);
  const entryAnchorRef = useRef({
    targetDateKey: null,
    released: false,
  });

  const registerHeader = (dateKey, node) => {
    if (node) headerRefs.current.set(dateKey, node);
    else headerRefs.current.delete(dateKey);
  };
  const registerSection = (dateKey, node) => {
    if (node) sectionRefs.current.set(dateKey, node);
    else sectionRefs.current.delete(dateKey);
  };
  const registerContent = (dateKey, node) => {
    if (!dateKey) return;
    const current = contentRefs.current.get(dateKey) || new Set();
    if (node) {
      current.add(node);
      contentRefs.current.set(dateKey, current);
    } else {
      current.forEach((element) => {
        if (!element?.isConnected) current.delete(element);
      });
      if (!current.size) contentRefs.current.delete(dateKey);
    }
  };
  const registerRow = (key, node, dateKey) => {
    if (node) rowRefs.current.set(key, node);
    else rowRefs.current.delete(key);
    registerContent(dateKey, node);
  };

  const scrollElementIntoView = useCallback((element, { block = "start", offsetTop = 0, forceSmooth = false, forceAuto = false } = {}) => {
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
    const behavior = forceAuto || reduceMotion || (!forceSmooth && distance > scrollerRect.height * 1.7) ? "auto" : "smooth";
    const previousScrollTop = scroller.scrollTop;
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top: nextScrollTop, behavior });
    } else {
      scroller.scrollTop = nextScrollTop;
    }
    if (behavior === "auto" && Math.abs(scroller.scrollTop - previousScrollTop) < 0.5 && distance > 0.5) {
      scroller.scrollTop = nextScrollTop;
    }
    window.setTimeout(() => {
      suppressPassiveUntilRef.current = 0;
    }, behavior === "smooth" ? 430 : 80);
    return true;
  }, []);

  const scrollToDateHeader = useCallback((dateKey) => (
    scrollElementIntoView(headerRefs.current.get(dateKey), { block: "start" })
  ), [scrollElementIntoView]);

  const scrollToDateStart = useCallback((dateKey) => {
    const contentCandidates = [...(contentRefs.current.get(dateKey) || [])];
    const content = contentCandidates.find((element) => element?.isConnected) || null;
    if (content) {
      return scrollElementIntoView(content, {
        block: "start",
        offsetTop: itemScrollTopOffset,
      });
    }
    return scrollToDateHeader(dateKey);
  }, [itemScrollTopOffset, scrollElementIntoView, scrollToDateHeader]);

  const scrollToItem = useCallback((itemId, dateKey) => {
    const row = findRow(rowRefs, itemId, dateKey);
    return scrollElementIntoView(row || headerRefs.current.get(dateKey), {
      block: row ? "nearest" : "start",
      offsetTop: row ? itemScrollTopOffset : 0,
      forceSmooth: !!row,
    });
  }, [itemScrollTopOffset, scrollElementIntoView]);

  const activateItem = useCallback((itemId, dateKey) => {
    const anchor = findRowAnchor(rowRefs, itemId, dateKey);
    if (!anchor) return false;
    anchor.click();
    return true;
  }, []);

  const releaseEntryAnchor = useCallback(() => {
    entryAnchorRef.current.released = true;
  }, []);

  if (entryAnchorRef.current.targetDateKey !== entryScrollTargetDateKey) {
    entryAnchorRef.current = {
      targetDateKey: entryScrollTargetDateKey,
      released: false,
    };
  }

  useImperativeHandle(ref, () => ({
    scrollToDate(dateKey, commandId = null) {
      const handled = scrollToDateHeader(dateKey);
      if (handled && commandId) handledScrollCommandIdRef.current = commandId;
      return handled;
    },
    scrollToEvent(itemId, dateKey, commandId = null) {
      const handled = scrollToItem(itemId, dateKey);
      if (handled && commandId) handledScrollCommandIdRef.current = commandId;
      return handled;
    },
    scrollToItem(itemId, dateKey, commandId = null) {
      const handled = scrollToItem(itemId, dateKey);
      if (handled && commandId) handledScrollCommandIdRef.current = commandId;
      return handled;
    },
    getItemAnchor(itemId, dateKey) {
      return findRowAnchor(rowRefs, itemId, dateKey);
    },
    activateItem(itemId, dateKey) {
      return activateItem(itemId, dateKey);
    },
    scrollToToday(commandId = null) {
      const handled = scrollToDateStart(todayKey);
      if (handled && commandId) handledScrollCommandIdRef.current = commandId;
      return handled;
    },
    scrollToFirst() {
      return scrollElementIntoView(headerRefs.current.get(firstVisibleDateKey), { block: "start" });
    },
  }), [activateItem, firstVisibleDateKey, scrollElementIntoView, scrollToDateHeader, scrollToDateStart, scrollToItem, todayKey]);

  useEffect(() => {
    if (!scrollCommand || showSkeleton) return undefined;
    if (scrollCommand.id && handledScrollCommandIdRef.current === scrollCommand.id) return undefined;
    const id = window.requestAnimationFrame(() => {
      let handled = false;
      if (scrollCommand.type === "today") {
        handled = scrollToDateStart(todayKey);
      } else if (scrollCommand.type === "date") {
        releaseEntryAnchor();
        handled = scrollToDateHeader(scrollCommand.dateKey);
      } else if (scrollCommand.type === "event" || scrollCommand.type === "item") {
        releaseEntryAnchor();
        handled = scrollToItem(scrollCommand.itemId, scrollCommand.dateKey);
      }
      if (handled && scrollCommand.id) {
        handledScrollCommandIdRef.current = scrollCommand.id;
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [groups, releaseEntryAnchor, scrollCommand, scrollToDateHeader, scrollToDateStart, scrollToItem, showSkeleton, todayKey]);

  useEffect(() => {
    if (isLoading || !entryScrollReady) return undefined;
    if (entryAnchorRef.current.released) return undefined;
    const id = window.requestAnimationFrame(() => {
      const entryTargetHeader = entryScrollTargetDateKey ? headerRefs.current.get(entryScrollTargetDateKey) : null;
      const holdEntryTarget = !!entryTargetHeader && !entryAnchorRef.current.released;
      const targetDate = holdEntryTarget ? entryScrollTargetDateKey : firstVisibleDateKey;
      scrollElementIntoView((holdEntryTarget ? entryTargetHeader : headerRefs.current.get(targetDate)) || headerRefs.current.get(firstVisibleDateKey), {
        block: "start",
        forceAuto: true,
      });
      if (holdEntryTarget && targetDate && targetDate !== selectedDateKey) {
        onPassiveDateChange?.(targetDate);
      }
    });
    return () => window.cancelAnimationFrame(id);
    // Entry scroll is keyed to the visible month, not every selection update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryScrollReady, entryScrollTargetDateKey, firstVisibleDateKey, groups, isLoading]);

  function handleScroll() {
    if (isLoading || !entryScrollReady || scrollRafRef.current) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      if (entryScrollTargetDateKey && !entryAnchorRef.current.released) return;
      if (performance.now() < suppressPassiveUntilRef.current) return;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const top = scroller.getBoundingClientRect().top + 4;
      let active = null;
      for (const group of groups) {
        const section = sectionRefs.current.get(group.dateKey);
        const header = headerRefs.current.get(group.dateKey);
        const anchor = section || header;
        if (!anchor) continue;
        if (anchor.getBoundingClientRect().top <= top + 4) active = group.dateKey;
      }
      active ||= groups[0]?.dateKey || null;
      if (!active || active === selectedDateKey) return;
      if (floatingEditorDirty) return;
      onPassiveDateChange?.(active);
    });
  }

  function suppressItemPointerPassiveSync(event) {
    if (!(event.target instanceof HTMLElement)) return;
    releaseEntryAnchor();
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
      onWheelCapture={releaseEntryAnchor}
      onKeyDownCapture={releaseEntryAnchor}
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
      {groups.map((group) => {
        const sectionProps = getSectionProps?.(group) || {};
        const { ref: sectionPropRef, ...restSectionProps } = sectionProps;
        return (
          <section
            key={group.dateKey}
            ref={(node) => {
              registerSection(group.dateKey, node);
              if (typeof sectionPropRef === "function") sectionPropRef(node);
              else if (sectionPropRef) sectionPropRef.current = node;
            }}
            data-date-key={group.dateKey}
            {...restSectionProps}
            style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, paddingBottom: 14 }}
          >
            {renderHeader?.({ group, registerHeader })}
            {renderGroup?.({ group, registerRow, registerContent })}
          </section>
        );
      })}
    </div>
  );
});

export default AgendaRailShell;
