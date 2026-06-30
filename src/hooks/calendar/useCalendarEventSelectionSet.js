import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addCalendarEventSelection,
  calendarEventSelectionIdentity,
  calendarEventSelectionSize,
  clearCalendarEventSelection,
  createCalendarEventClipboard,
  createCalendarEventSelectionSet,
  getOrderedCalendarEventSelection,
  isCalendarEventSelected,
  removeCalendarEventSelection,
  resolveCalendarEventActionScope,
  toggleCalendarEventSelection,
} from "../../components/calendar/events/calendarEventSelectionModel.js";
import useCalendarQuickActions from "../../components/calendar/events/useCalendarQuickActions.js";
import { isGoogleSpecialDateEvent } from "../../components/calendar/googleSpecialDateModel.js";
import { parseYmd } from "../../components/calendar/calendarDateUtils.js";
import { EMPTY_CALENDAR_EVENTS } from "./calendarControllerHelpers.js";

// The event multi-select + clipboard submachine, lifted verbatim out of
// useCalendarModalController. It owns the selection set, the copy/paste
// clipboard, the seeded-toggle rules, and the event quick-actions bundle
// (optimistic mutations live in useCalendarQuickActions, which this hook hosts
// so its batch-delete callback can prune the selection). Every callback keeps
// the identifier names the controller used so its render tree is unchanged.
export default function useCalendarEventSelectionSet({
  view,
  activeView,
  activeLayout,
  visibleCalendarEvents,
  activeSelectedItemId,
  activeSelectedDateKey,
  selectedItemId,
  eventsEditable,
  eventsRefreshRange,
  eventsUpsertEvents,
  eventsRemoveEvent,
  floatingDetailRef,
  setFloatingDetail,
  setSelectedItemId,
  setSelectedDay,
  setSelectedDateKey,
  closeEventEditor,
  shakeFloatingEditor,
  agendaRailRef,
}) {
  const [calendarEventClipboard, setCalendarEventClipboard] = useState(null);
  const [calendarEventSelectionSet, setCalendarEventSelectionSet] = useState(() => createCalendarEventSelectionSet());
  const calendarEventSelectionRef = useRef(calendarEventSelectionSet);
  useEffect(() => {
    calendarEventSelectionRef.current = calendarEventSelectionSet;
  }, [calendarEventSelectionSet]);
  const calendarEventSelectionCount = calendarEventSelectionSize(calendarEventSelectionSet);
  const clearCalendarEventSelectionSet = useCallback(() => {
    setCalendarEventSelectionSet((current) => (
      calendarEventSelectionSize(current) > 0 ? clearCalendarEventSelection() : current
    ));
  }, []);
  const removeFromCalendarEventSelectionSet = useCallback((events) => {
    const identities = (Array.isArray(events) ? events : [events])
      .map((event) => calendarEventSelectionIdentity(event))
      .filter(Boolean);
    if (!identities.length) return;
    setCalendarEventSelectionSet((current) => {
      if (calendarEventSelectionSize(current) === 0) return current;
      const next = identities.reduce(
        (selection, identity) => removeCalendarEventSelection(selection, identity),
        current,
      );
      return calendarEventSelectionSize(next) === calendarEventSelectionSize(current)
        ? current
        : next;
    });
  }, []);

  // Mirror the inputs of selected-event resolution so the resolver (and the
  // selection handlers built on it) keep one identity across month crossings;
  // a fresh resolver per crossing would re-render every mounted month grid
  // through the quick-actions chain.
  const selectionResolutionRef = useRef({ events: EMPTY_CALENDAR_EVENTS, itemId: null });
  useEffect(() => {
    selectionResolutionRef.current = { events: visibleCalendarEvents, itemId: activeSelectedItemId };
  });
  const resolveSelectedCalendarEvent = useCallback(() => {
    const { events, itemId: selectionItemId } = selectionResolutionRef.current;
    if (view !== "events" || selectionItemId == null) return null;
    const selected = events.find((event) => {
      const itemId = activeView.getItemId ? activeView.getItemId(event) : event.id;
      return String(itemId) === String(selectionItemId);
    });
    if (!selected?.startMs || !selected?.calendarId || !selected?.accountId) return null;
    return selected;
  }, [activeView, view]);

  const copyCalendarEvent = useCallback((event) => {
    const clipboard = createCalendarEventClipboard(event);
    if (!clipboard) return false;
    setCalendarEventClipboard(clipboard);
    setFloatingDetail(null);
    return true;
  }, [setFloatingDetail]);

  const copySelectedCalendarEvent = useCallback(() => {
    const selectionClipboard = createCalendarEventClipboard(calendarEventSelectionRef.current);
    if (selectionClipboard) {
      setCalendarEventClipboard(selectionClipboard);
      setFloatingDetail(null);
      return true;
    }
    return copyCalendarEvent(resolveSelectedCalendarEvent());
  }, [copyCalendarEvent, resolveSelectedCalendarEvent, setFloatingDetail]);

  // Returns true only when a selection set was actually begun; ineligible
  // events (special dates, read-only sources) return false so the bare
  // cmd/ctrl hotkey falls through to dismissing the floating detail.
  const addSelectedCalendarEventToSelectionSet = useCallback(() => {
    const selectedEvent = resolveSelectedCalendarEvent();
    if (!calendarEventSelectionIdentity(selectedEvent)) {
      return false;
    }
    closeEventEditor();
    setFloatingDetail(null);
    setSelectedItemId(null);
    setCalendarEventSelectionSet((selection) => addCalendarEventSelection(selection, selectedEvent));
    return true;
  }, [
    closeEventEditor,
    resolveSelectedCalendarEvent,
    setFloatingDetail,
    setSelectedItemId,
  ]);

  const resolveContextEventActionScope = useCallback((event) => (
    resolveCalendarEventActionScope(calendarEventSelectionSet, event)
  ), [calendarEventSelectionSet]);

  const baseEventQuickActions = useCalendarQuickActions({
    editable: eventsEditable,
    layout: activeLayout,
    refreshRange: eventsRefreshRange,
    upsertEvents: eventsUpsertEvents,
    removeEvent: eventsRemoveEvent,
    onCopyEvent: copyCalendarEvent,
    onBatchDeleted: removeFromCalendarEventSelectionSet,
    resolveEventActionScope: resolveContextEventActionScope,
    onSelectEvent: (itemId, dateKey) => {
      const parsed = parseYmd(dateKey);
      if (parsed) {
        setSelectedDateKey(dateKey);
        setSelectedDay(parsed.day);
      }
      setSelectedItemId(itemId != null ? String(itemId) : null);
      window.requestAnimationFrame(() => {
        agendaRailRef.current?.scrollToEvent?.(itemId, dateKey);
      });
    },
    onReconcileSelection: (prevItemId, nextItemId) => {
      // Swap an optimistic paste/clone id for its reconciled server id ONLY if the
      // user is still on that event. We deliberately never touch the selected day
      // here: the optimistic select already moved it synchronously with the paste,
      // and re-asserting it now (after network latency) would yank selection back
      // from wherever the user has since navigated — the bug where a rapid
      // multi-day paste lands every event on the first day.
      if (prevItemId == null) return;
      setSelectedItemId((current) => (
        current != null && String(current) === String(prevItemId)
          ? (nextItemId != null ? String(nextItemId) : current)
          : current
      ));
    },
    onEventDeleted: (itemId) => {
      const current = floatingDetailRef.current;
      if (itemId != null && current?.open && current.view === "events" && String(current.itemId) === String(itemId)) {
        setFloatingDetail(null);
      }
      if (itemId != null && String(selectedItemId) === String(itemId)) {
        setSelectedItemId(null);
      }
    },
  });

  const toggleCalendarEventSelectionSet = useCallback(({ event } = {}) => {
    if (view !== "events") return false;
    const eventIdentity = calendarEventSelectionIdentity(event);
    // Special dates (birthdays) can never join the selection set, but a
    // modifier-click on them still follows the same dismiss path as any
    // other chip so the floating detail closes consistently.
    const dismissOnly = !eventIdentity && isGoogleSpecialDateEvent(event);
    if (!eventIdentity && !dismissOnly) return false;
    const selectedEvent = resolveSelectedCalendarEvent();
    const selectedIdentity = calendarEventSelectionIdentity(selectedEvent);
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty) {
      shakeFloatingEditor();
      return true;
    }
    closeEventEditor();
    setFloatingDetail(null);
    setSelectedItemId(null);
    if (dismissOnly) return true;
    setCalendarEventSelectionSet((selection) => {
      const seededSelection = calendarEventSelectionSize(selection) === 0
        && selectedIdentity
        && selectedIdentity !== eventIdentity
        ? addCalendarEventSelection(selection, selectedEvent)
        : selection;
      return toggleCalendarEventSelection(seededSelection, event);
    });
    return true;
  }, [
    closeEventEditor,
    floatingDetailRef,
    resolveSelectedCalendarEvent,
    setFloatingDetail,
    setSelectedItemId,
    shakeFloatingEditor,
    view,
  ]);

  // The toggle handler's identity follows editor/floating-detail callbacks;
  // routing it through a ref keeps eventQuickActions (a prop of every mounted
  // month grid) stable across controller re-renders that don't change the
  // selection itself.
  const toggleCalendarEventSelectionSetRef = useRef(null);
  useEffect(() => {
    toggleCalendarEventSelectionSetRef.current = toggleCalendarEventSelectionSet;
  });
  const stableToggleEventSelection = useCallback(
    (...args) => toggleCalendarEventSelectionSetRef.current?.(...args),
    [],
  );

  const eventQuickActions = useMemo(() => ({
    ...baseEventQuickActions,
    eventSelectionActive: calendarEventSelectionCount > 0,
    eventSelectionCount: calendarEventSelectionCount,
    clearEventSelection: clearCalendarEventSelectionSet,
    isEventSelectionSelected: (event) => isCalendarEventSelected(calendarEventSelectionSet, event),
    toggleEventSelection: stableToggleEventSelection,
  }), [
    baseEventQuickActions,
    calendarEventSelectionCount,
    calendarEventSelectionSet,
    clearCalendarEventSelectionSet,
    stableToggleEventSelection,
  ]);

  const requestSelectedCalendarEventDelete = useCallback(() => {
    const events = getOrderedCalendarEventSelection(calendarEventSelectionRef.current);
    if (!events.length) return false;
    return !!eventQuickActions.requestBatchDelete?.({ events });
  }, [eventQuickActions]);

  const pasteCopiedCalendarEvent = useCallback(() => {
    if (!calendarEventClipboard || !activeSelectedDateKey) return;
    const pasteResult = eventQuickActions.pasteEvent?.(calendarEventClipboard, activeSelectedDateKey);
    if (pasteResult) clearCalendarEventSelectionSet();
  }, [
    activeSelectedDateKey,
    calendarEventClipboard,
    clearCalendarEventSelectionSet,
    eventQuickActions,
  ]);

  return {
    eventQuickActions,
    clearCalendarEventSelectionSet,
    copySelectedCalendarEvent,
    pasteCopiedCalendarEvent,
    requestSelectedCalendarEventDelete,
    addSelectedCalendarEventToSelectionSet,
  };
}
