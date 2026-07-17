import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import type { ForwardedRef, PointerEvent as ReactPointerEvent, ReactNode } from "react";

const DEFAULT_ITEM_SCROLL_TOP_OFFSET = 44;
const ITEM_ACTION_SELECTOR = [
  "[data-testid='calendar-agenda-event-row']",
  "[data-testid='calendar-agenda-event-chip']",
  "[data-testid='calendar-agenda-bill-row']",
  "[data-testid='calendar-agenda-deadline-row']",
].join(", ");

type ElementMapRef = { current: Map<string, HTMLElement> };
export interface AgendaScrollMonth {
  monthKey: string;
  firstVisibleDateKey: string;
  visibleGroups: Array<{ dateKey: string }>;
}
export interface AgendaRegistrationCallbacks {
  registerHeader: (dateKey: string, node: HTMLElement | null) => void;
  registerSection: (dateKey: string, node: HTMLElement | null) => void;
  registerRow: (key: string, node: HTMLElement | null, dateKey?: string) => void;
  registerContent: (dateKey: string, node: HTMLElement | null) => void;
}
export type AgendaScrollCommand =
  | { id?: string | null; type: "today" }
  | { id?: string | null; type: "date"; dateKey: string }
  | { id?: string | null; type: "event" | "item"; itemId: string; dateKey: string };
export interface AgendaMonthScrollHandle {
  scrollToDate(dateKey: string, commandId?: string | null): boolean;
  scrollToEvent(itemId: unknown, dateKey: string, commandId?: string | null): boolean;
  scrollToItem(itemId: unknown, dateKey: string, commandId?: string | null): boolean;
  getItemAnchor(itemId: unknown, dateKey: string): HTMLElement | null;
  activateItem(itemId: unknown, dateKey: string): boolean;
  scrollToToday(commandId?: string | null): boolean;
  scrollToFirst(): boolean;
  getTopmostDate(): string | null;
  releaseEntryAnchor(): void;
}
export interface AgendaMonthScrollContainerProps {
  testId: string;
  months?: AgendaScrollMonth[];
  todayKey: string;
  selectedDateKey?: string | null;
  scrollCommand?: AgendaScrollCommand | null;
  entryScrollTargetDateKey?: string | false | null;
  isLoading?: boolean;
  floatingEditorDirty?: boolean;
  entryScrollReady?: boolean;
  itemScrollTopOffset?: number;
  skeleton?: ReactNode;
  showSkeleton?: boolean;
  onTopmostDateChange?: (dateKey: string) => void;
  renderMonth: (month: AgendaScrollMonth, callbacks: AgendaRegistrationCallbacks) => ReactNode;
}

function findRow(rowRefs: ElementMapRef, itemId: unknown, dateKey: string): HTMLElement | null {
  const itemIdText = String(itemId ?? "");
  const dateKeyText = String(dateKey ?? "");
  if (!itemIdText || !dateKeyText) return null;
  const simpleKeyPrefix = `${itemIdText}-${dateKeyText}`;
  const deadlineKeyNeedle = `:${itemIdText}-${dateKeyText}`;
  const keyMatchesDate = (key: string) => (
    key === itemIdText
    || key.endsWith(`-${dateKeyText}`)
    || key.endsWith(`:${dateKeyText}`)
    || itemIdText.endsWith(`:${dateKeyText}`)
  );
  for (const [key, row] of rowRefs.current.entries()) {
    if (!row?.isConnected) continue;
    if (key === itemIdText || key.startsWith(simpleKeyPrefix) || key.includes(deadlineKeyNeedle)) return row;
    const itemElement = row.querySelector?.("[data-item-id]");
    if (itemElement && String(itemElement.getAttribute("data-item-id")) === itemIdText && keyMatchesDate(key)) {
      return row;
    }
    const matchIds = String(itemElement?.getAttribute("data-calendar-match-item-ids") || "")
      .split(/\s+/)
      .filter(Boolean);
    if (matchIds.includes(itemIdText) && keyMatchesDate(key)) {
      return row;
    }
  }
  return null;
}

function findRowAnchor(rowRefs: ElementMapRef, itemId: unknown, dateKey: string): HTMLElement | null {
  const row = findRow(rowRefs, itemId, dateKey);
  if (!row) return null;
  return row.matches?.(ITEM_ACTION_SELECTOR)
    ? row
    : row.querySelector?.(ITEM_ACTION_SELECTOR) || null;
}

const AgendaMonthScrollContainer = forwardRef(function AgendaMonthScrollContainer({
  testId,
  months = [],
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
  onTopmostDateChange,
  renderMonth,
}: AgendaMonthScrollContainerProps, ref: ForwardedRef<AgendaMonthScrollHandle>) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const headerRefs = useRef(new Map<string, HTMLElement>());
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const contentRefs = useRef(new Map<string, Set<HTMLElement>>());
  const suppressPassiveUntilRef = useRef(0);
  const scrollRafRef = useRef(0);
  const handledScrollCommandIdRef = useRef<string | null>(null);
  const passiveScrollTargetDateKeyRef = useRef<string | null>(null);
  const entryPassiveDateChangeRef = useRef<string | null>(null);
  const entryAnchorRef = useRef({
    targetDateKey: null as string | false | null,
    released: false,
  });

  const allDateKeys = useMemo(() => (
    months.flatMap((m) => m.visibleGroups.map((g) => g.dateKey))
  ), [months]);

  const firstVisibleDateKey = months[0]?.firstVisibleDateKey || allDateKeys[0] || null;

  const registerHeader = useCallback((dateKey: string, node: HTMLElement | null) => {
    if (node) headerRefs.current.set(dateKey, node);
    else headerRefs.current.delete(dateKey);
  }, []);

  const registerSection = useCallback((dateKey: string, node: HTMLElement | null) => {
    if (node) sectionRefs.current.set(dateKey, node);
    else sectionRefs.current.delete(dateKey);
  }, []);

  const registerContent = useCallback((dateKey: string, node: HTMLElement | null) => {
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
  }, []);

  const registerRow = useCallback((key: string, node: HTMLElement | null, dateKey?: string) => {
    if (node) rowRefs.current.set(key, node);
    else rowRefs.current.delete(key);
    if (dateKey) registerContent(dateKey, node);
  }, [registerContent]);

  const cancelPassiveScrollFrame = useCallback(() => {
    if (!scrollRafRef.current) return;
    window.cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = 0;
  }, []);

  const beginProgrammaticScrollTarget = useCallback((dateKey: string | null) => {
    if (!dateKey) return;
    cancelPassiveScrollFrame();
    passiveScrollTargetDateKeyRef.current = dateKey;
  }, [cancelPassiveScrollFrame]);

  const clearProgrammaticScrollTarget = useCallback(() => {
    passiveScrollTargetDateKeyRef.current = null;
  }, []);

  const scrollElementIntoView = useCallback((element: HTMLElement | null | undefined, { block = "start", offsetTop = 0, forceSmooth = false, forceAuto = false }: {
    block?: ScrollLogicalPosition;
    offsetTop?: number;
    forceSmooth?: boolean;
    forceAuto?: boolean;
  } = {}) => {
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

  const scrollToDateHeader = useCallback((dateKey: string) => {
    const header = headerRefs.current.get(dateKey);
    if (!header) return false;
    beginProgrammaticScrollTarget(dateKey);
    return scrollElementIntoView(header, { block: "start" });
  }, [beginProgrammaticScrollTarget, scrollElementIntoView]);

  const scrollToDateStart = useCallback((dateKey: string) => {
    const contentCandidates = [...(contentRefs.current.get(dateKey) || [])];
    const content = contentCandidates.find((element) => element?.isConnected) || null;
    const header = headerRefs.current.get(dateKey);
    const target = content || header;
    if (!target) return false;
    beginProgrammaticScrollTarget(dateKey);
    if (content) {
      return scrollElementIntoView(content, {
        block: "start",
        offsetTop: itemScrollTopOffset,
      });
    }
    return scrollElementIntoView(header, { block: "start" });
  }, [beginProgrammaticScrollTarget, itemScrollTopOffset, scrollElementIntoView]);

  const scrollToItem = useCallback((itemId: unknown, dateKey: string) => {
    const row = findRow(rowRefs, itemId, dateKey);
    const target = row || headerRefs.current.get(dateKey);
    if (!target) return false;
    beginProgrammaticScrollTarget(dateKey);
    return scrollElementIntoView(target, {
      block: row ? "nearest" : "start",
      offsetTop: row ? itemScrollTopOffset : 0,
    });
  }, [beginProgrammaticScrollTarget, itemScrollTopOffset, scrollElementIntoView]);

  const activateItem = useCallback((itemId: unknown, dateKey: string) => {
    const anchor = findRowAnchor(rowRefs, itemId, dateKey);
    if (!anchor) return false;
    anchor.click();
    return true;
  }, []);

  const releaseEntryAnchor = useCallback(() => {
    entryAnchorRef.current.released = true;
  }, []);

  const releaseRailAnchors = useCallback(() => {
    releaseEntryAnchor();
    clearProgrammaticScrollTarget();
  }, [clearProgrammaticScrollTarget, releaseEntryAnchor]);

  if (entryAnchorRef.current.targetDateKey !== entryScrollTargetDateKey) {
    entryAnchorRef.current = {
      targetDateKey: entryScrollTargetDateKey,
      released: false,
    };
    entryPassiveDateChangeRef.current = null;
  }

  // Date sections appear in document order, so their tops are monotonic:
  // once one falls below the active line every later one does too. Breaking
  // there keeps the rect measurements proportional to the scrolled-past
  // months instead of every loaded day, and this runs on every scroll frame.
  const findTopmostDateKey = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return null;
    const activeLine = scroller.getBoundingClientRect().top + Math.max(4, itemScrollTopOffset);
    let active: string | null = null;
    for (const dateKey of allDateKeys) {
      const anchor = sectionRefs.current.get(dateKey) || headerRefs.current.get(dateKey);
      if (!anchor) continue;
      if (anchor.getBoundingClientRect().top <= activeLine + 4) active = dateKey;
      else break;
    }
    return active;
  }, [allDateKeys, itemScrollTopOffset]);

  const getTopmostDate = useCallback(() => {
    if (!scrollerRef.current) return firstVisibleDateKey;
    return findTopmostDateKey() || firstVisibleDateKey;
  }, [findTopmostDateKey, firstVisibleDateKey]);

  useImperativeHandle(ref, () => ({
    scrollToDate(dateKey, commandId = null) {
      releaseEntryAnchor();
      const handled = scrollToDateHeader(dateKey);
      if (handled && commandId) handledScrollCommandIdRef.current = commandId;
      return handled;
    },
    scrollToEvent(itemId, dateKey, commandId = null) {
      releaseEntryAnchor();
      const handled = scrollToItem(itemId, dateKey);
      if (handled && commandId) handledScrollCommandIdRef.current = commandId;
      return handled;
    },
    scrollToItem(itemId, dateKey, commandId = null) {
      releaseEntryAnchor();
      const handled = scrollToItem(itemId, dateKey);
      if (handled && commandId) handledScrollCommandIdRef.current = commandId;
      return handled;
    },
    getItemAnchor(itemId, dateKey) {
      return findRowAnchor(rowRefs, itemId, dateKey);
    },
    activateItem(itemId, dateKey) {
      releaseRailAnchors();
      return activateItem(itemId, dateKey);
    },
    scrollToToday(commandId = null) {
      releaseEntryAnchor();
      const handled = scrollToDateStart(todayKey);
      if (handled && commandId) handledScrollCommandIdRef.current = commandId;
      return handled;
    },
    scrollToFirst() {
      releaseEntryAnchor();
      if (!firstVisibleDateKey) return false;
      const header = headerRefs.current.get(firstVisibleDateKey);
      if (!header) return false;
      beginProgrammaticScrollTarget(firstVisibleDateKey);
      return scrollElementIntoView(header, { block: "start" });
    },
    getTopmostDate,
    releaseEntryAnchor,
  }), [activateItem, beginProgrammaticScrollTarget, firstVisibleDateKey, getTopmostDate, releaseEntryAnchor, releaseRailAnchors, scrollElementIntoView, scrollToDateHeader, scrollToDateStart, scrollToItem, todayKey]);

  useLayoutEffect(() => {
    if (!scrollCommand || showSkeleton) return undefined;
    if (scrollCommand.id && handledScrollCommandIdRef.current === scrollCommand.id) return undefined;
    suppressPassiveUntilRef.current = Math.max(
      suppressPassiveUntilRef.current,
      performance.now() + 420,
    );
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
  }, [months, releaseEntryAnchor, scrollCommand, scrollToDateHeader, scrollToDateStart, scrollToItem, showSkeleton, todayKey]);

  useEffect(() => {
    if (entryScrollTargetDateKey === false) return undefined;
    if (isLoading || !entryScrollReady) return undefined;
    if (entryAnchorRef.current.released) return undefined;
    const id = window.requestAnimationFrame(() => {
      const entryTargetHeader = entryScrollTargetDateKey ? headerRefs.current.get(entryScrollTargetDateKey) : null;
      const holdEntryTarget = !!entryTargetHeader && !entryAnchorRef.current.released;
      const targetDate = holdEntryTarget ? entryScrollTargetDateKey : firstVisibleDateKey;
      const fallbackHeader = firstVisibleDateKey ? headerRefs.current.get(firstVisibleDateKey) : null;
      const targetHeader = targetDate ? headerRefs.current.get(targetDate) : null;
      scrollElementIntoView((holdEntryTarget ? entryTargetHeader : targetHeader) || fallbackHeader, {
        block: "start",
        forceAuto: true,
      });
      if (targetDate && targetDate !== selectedDateKey && !floatingEditorDirty) {
        if (entryScrollTargetDateKey) {
          if (!holdEntryTarget) return;
          if (entryPassiveDateChangeRef.current === targetDate) return;
          entryPassiveDateChangeRef.current = targetDate;
        }
        onTopmostDateChange?.(targetDate);
      }
    });
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryScrollReady, entryScrollTargetDateKey, firstVisibleDateKey, months, isLoading]);

  function handleScroll() {
    const userScrolling = entryAnchorRef.current.released;
    if ((!entryScrollReady && !userScrolling) || scrollRafRef.current) {
      return;
    }
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      if (entryScrollTargetDateKey !== false && entryScrollTargetDateKey && !entryAnchorRef.current.released) {
        return;
      }
      if (performance.now() < suppressPassiveUntilRef.current) {
        return;
      }
      if (!scrollerRef.current) return;
      const active = findTopmostDateKey();
      if (passiveScrollTargetDateKeyRef.current) {
        if (active !== passiveScrollTargetDateKeyRef.current) {
          return;
        }
        passiveScrollTargetDateKeyRef.current = null;
      }
      if (!active) {
        return;
      }
      if (active === selectedDateKey && !isLoading) {
        return;
      }
      if (floatingEditorDirty) {
        return;
      }
      onTopmostDateChange?.(active);
    });
  }

  function suppressItemPointerPassiveSync(event: ReactPointerEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement)) return;
    releaseRailAnchors();
    if (!event.target.closest(ITEM_ACTION_SELECTOR)) return;
    suppressPassiveUntilRef.current = Math.max(
      suppressPassiveUntilRef.current,
      performance.now() + 900,
    );
  }

  if (showSkeleton) return skeleton;

  const registrationCallbacks: AgendaRegistrationCallbacks = { registerHeader, registerSection, registerRow, registerContent };

  return (
    <div
      ref={scrollerRef}
      data-testid={testId}
      data-calendar-local-scroll="true"
      onScroll={handleScroll}
      onPointerDownCapture={suppressItemPointerPassiveSync}
      onWheelCapture={releaseRailAnchors}
      onKeyDownCapture={releaseRailAnchors}
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overflowAnchor: "auto",
        overscrollBehavior: "contain",
        padding: "0 10px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        background: "var(--sp-panel)",
        isolation: "isolate",
      }}
    >
      <style>
        {`
          [data-testid="${testId}"] button:focus-visible {
            outline: 2px solid color-mix(in srgb, var(--ea-accent, var(--sp-accent)) 72%, transparent);
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
      {months.map((month) => (
        <div key={month.monthKey} data-month-key={month.monthKey}>
          {renderMonth(month, registrationCallbacks)}
        </div>
      ))}
    </div>
  );
});

export default AgendaMonthScrollContainer;
