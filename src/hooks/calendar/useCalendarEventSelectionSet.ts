import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
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
  type CalendarEventClipboard,
  type CalendarEventSelectionSet,
  type SelectableCalendarEvent,
} from "../../components/calendar/events/calendarEventSelectionModel";
import useCalendarQuickActions from "../../components/calendar/events/useCalendarQuickActions";
import type { CalendarQuickActionEvent } from "../../components/calendar/events/calendarQuickActionModel";
import { isGoogleSpecialDateEvent } from "../../components/calendar/googleSpecialDateModel.ts";
import { parseYmd } from "../../components/calendar/calendarDateUtils.ts";
import { EMPTY_CALENDAR_EVENTS } from "./calendarControllerHelpers";

type CalendarEventValue = SelectableCalendarEvent;
type CalendarQuickActionScope = {
  kind: "none" | "single" | "selection";
  events: CalendarQuickActionEvent[];
  identities: string[];
};

interface FloatingDetailState {
  open?: boolean;
  view?: string;
  mode?: string;
  dirty?: boolean;
  itemId?: string | number | null;
}

type LegacyCallback = (...args: never[]) => unknown;

export interface CalendarEventSelectionSetOptions {
  view: string;
  activeView: { getItemId?: (event: CalendarEventValue) => string | number | null | undefined };
  activeLayout: unknown;
  visibleCalendarEvents: CalendarEventValue[];
  activeSelectedItemId: string | number | null;
  activeSelectedDateKey: string | null;
  selectedItemId: string | number | null;
  eventsEditable: boolean;
  eventsRefreshRange: LegacyCallback | null;
  eventsUpsertEvents: LegacyCallback | null;
  eventsRemoveEvent: LegacyCallback | null;
  eventsMarkStale: LegacyCallback | null;
  floatingDetailRef: MutableRefObject<FloatingDetailState | null>;
  setFloatingDetail: Dispatch<SetStateAction<FloatingDetailState | null>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  setSelectedDay: Dispatch<SetStateAction<number | null>>;
  setSelectedDateKey: Dispatch<SetStateAction<string | null>>;
  closeEventEditor: () => void;
  shakeFloatingEditor: () => void;
  agendaRailRef: MutableRefObject<{ scrollToEvent?: (itemId: string | number | null, dateKey: string) => void } | null>;
}

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
  eventsMarkStale,
  floatingDetailRef,
  setFloatingDetail,
  setSelectedItemId,
  setSelectedDay,
  setSelectedDateKey,
  closeEventEditor,
  shakeFloatingEditor,
  agendaRailRef,
}: CalendarEventSelectionSetOptions) {
  const [calendarEventClipboard, setCalendarEventClipboard] = useState<CalendarEventClipboard | null>(null);
  const [calendarEventSelectionSet, setCalendarEventSelectionSet] = useState<CalendarEventSelectionSet>(() => createCalendarEventSelectionSet());
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
  const removeFromCalendarEventSelectionSet = useCallback((events: CalendarEventValue | CalendarEventValue[]) => {
    const identities = (Array.isArray(events) ? events : [events])
      .map((event) => calendarEventSelectionIdentity(event))
      .filter((identity): identity is string => Boolean(identity));
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
  const selectionResolutionRef = useRef<{ events: CalendarEventValue[]; itemId: string | number | null }>({ events: EMPTY_CALENDAR_EVENTS, itemId: null });
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

  const copyCalendarEvent = useCallback((
    event: CalendarEventValue | CalendarEventValue[] | null,
  ) => {
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

  const resolveContextEventActionScope = useCallback((event: CalendarQuickActionEvent): CalendarQuickActionScope => (
    resolveCalendarEventActionScope(calendarEventSelectionSet, event) as CalendarQuickActionScope
  ), [calendarEventSelectionSet]);

  const baseEventQuickActions = useCalendarQuickActions({
    editable: eventsEditable,
    layout: activeLayout,
    refreshRange: (eventsRefreshRange as ((start: string, end: string) => unknown) | null) ?? undefined,
    upsertEvents: (eventsUpsertEvents as ((events: CalendarQuickActionEvent | CalendarQuickActionEvent[]) => void) | null) ?? undefined,
    removeEvent: (eventsRemoveEvent as ((eventId: string | number | null | undefined) => void) | null) ?? undefined,
    markStale: (eventsMarkStale as ((start: string, end: string) => void) | null) ?? undefined,
    onCopyEvent: (source) => copyCalendarEvent(source),
    onBatchDeleted: removeFromCalendarEventSelectionSet,
    resolveEventActionScope: resolveContextEventActionScope,
    onSelectEvent: (itemId: string | number | null, dateKey: string) => {
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
    onReconcileSelection: (prevItemId: string | number | null, nextItemId: string | number | null) => {
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
    onEventDeleted: (itemId: string | number | null) => {
      const current = floatingDetailRef.current;
      if (itemId != null && current?.open && current.view === "events" && String(current.itemId) === String(itemId)) {
        setFloatingDetail(null);
      }
      if (itemId != null && String(selectedItemId) === String(itemId)) {
        setSelectedItemId(null);
      }
    },
  });

  const toggleCalendarEventSelectionSet = useCallback(({ event }: { event?: CalendarEventValue } = {}) => {
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
  const toggleCalendarEventSelectionSetRef = useRef<typeof toggleCalendarEventSelectionSet | null>(null);
  useEffect(() => {
    toggleCalendarEventSelectionSetRef.current = toggleCalendarEventSelectionSet;
  });
  const stableToggleEventSelection = useCallback(
    (...args: Parameters<typeof toggleCalendarEventSelectionSet>) => toggleCalendarEventSelectionSetRef.current?.(...args),
    [],
  );

  const eventQuickActions = useMemo(() => ({
    ...baseEventQuickActions,
    eventSelectionActive: calendarEventSelectionCount > 0,
    eventSelectionCount: calendarEventSelectionCount,
    clearEventSelection: clearCalendarEventSelectionSet,
    isEventSelectionSelected: (event: CalendarEventValue) => isCalendarEventSelected(calendarEventSelectionSet, event),
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
    return !!eventQuickActions.requestBatchDelete?.({ events: events as CalendarQuickActionEvent[] });
  }, [eventQuickActions]);

  const pasteCopiedCalendarEvent = useCallback(() => {
    if (!calendarEventClipboard || !activeSelectedDateKey) return;
    eventQuickActions.pasteEvent(calendarEventClipboard, activeSelectedDateKey);
    clearCalendarEventSelectionSet();
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
