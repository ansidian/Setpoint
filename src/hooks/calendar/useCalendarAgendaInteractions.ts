import { useCallback, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { parseYmd } from "../../components/calendar/calendarDateUtils.ts";
import type { CalendarFloatingDetail } from "./useCalendarFloatingDetail";
import type { AgendaRailHandle, ControllerAgendaCommand } from "./useCalendarAgendaScroll";
import type { FloatingEditorItem } from "./useFloatingEditorRouting";

interface AgendaActiveView {
  getItemId?: (item: FloatingEditorItem) => unknown;
}

interface AgendaSelectionState {
  setSelectedDay: Dispatch<SetStateAction<number | null>>;
  setSelectedDateKey: Dispatch<SetStateAction<string | null>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  setViewDate: Dispatch<SetStateAction<{ year: number; month: number }>>;
  setFetchAnchor: Dispatch<SetStateAction<{ year: number; month: number }>>;
  setLabelMonth: Dispatch<SetStateAction<{ year: number; month: number }>>;
}

interface AgendaEditorState {
  isDirty: () => boolean;
  closeEventEditor: () => void;
  clearEventSelectionSet: () => void;
  closeDeadlineEditor: () => void;
  shakeEditor: () => void;
  openEventCreate: (dateKey: string | null) => void;
}

interface AgendaFloatingState {
  detailRef: MutableRefObject<CalendarFloatingDetail | null>;
  openDetail: (detail: CalendarFloatingDetail) => void;
  setDetail: Dispatch<SetStateAction<CalendarFloatingDetail | null>>;
}

interface AgendaScrollState {
  railRef: MutableRefObject<AgendaRailHandle | null>;
  requestScroll: (command: ControllerAgendaCommand) => void;
  releaseEntryScroll: (released: boolean) => void;
  suppressPassiveSync: () => void;
  shouldIgnorePassiveSync: (detail: CalendarFloatingDetail | null) => boolean;
  onPassiveScroll: (dateKey: string) => void;
}

interface CalendarAgendaInteractionsOptions {
  view: string;
  viewYear: number;
  viewMonth: number;
  activeView: AgendaActiveView;
  selection: AgendaSelectionState;
  editor: AgendaEditorState;
  floating: AgendaFloatingState;
  scroll: AgendaScrollState;
}

export interface CalendarAgendaItemAction {
  event?: FloatingEditorItem | null;
  item?: FloatingEditorItem | null;
  dateKey: string;
  anchorElement?: HTMLElement | null;
  sourceCellElement?: HTMLElement | null;
  anchorKind?: string;
  detailKind?: string | null;
  preserveEventSelection?: boolean;
}

/** Owns agenda selection, anchoring, mini-calendar activation, and scroll actions. */
export default function useCalendarAgendaInteractions({
  view,
  viewYear,
  viewMonth,
  activeView,
  selection,
  editor,
  floating,
  scroll,
}: CalendarAgendaInteractionsOptions) {
  const { railRef, requestScroll } = scroll;
  const agendaSelectionAnchorRef = useRef<{
    itemId: string | null;
    dateKey: string;
    anchorKind: string;
  } | null>(null);

  function applyAgendaDateSelection(dateKey: string, { passive = false }: { passive?: boolean } = {}) {
    const parsed = parseYmd(dateKey);
    if (!parsed) return;
    const current = floating.detailRef.current;
    if (passive && scroll.shouldIgnorePassiveSync(current)) return;
    if (current?.open && (current.mode === "edit" || current.mode === "create")) {
      if (passive) return;
      if (current.dirty) {
        editor.shakeEditor();
        return;
      }
      if (current.view === "events") editor.closeEventEditor();
      if (current.detailKind === "deadline") editor.closeDeadlineEditor();
    } else if (!passive) {
      editor.closeEventEditor();
    }
    if (!passive) floating.setDetail(null);
    selection.setSelectedDay(parsed.day);
    selection.setSelectedDateKey(dateKey);
    selection.setSelectedItemId(null);
    if (!passive) {
      scroll.releaseEntryScroll(true);
      agendaSelectionAnchorRef.current = null;
      editor.clearEventSelectionSet();
    }
  }

  const onAgendaSelectDate = (dateKey: string) => applyAgendaDateSelection(dateKey);
  const onAgendaHoverDate = (dateKey: string) => applyAgendaDateSelection(dateKey, { passive: true });

  const agendaPassiveDateChangeImpl = (dateKey: string) => {
    scroll.onPassiveScroll(dateKey);
    onAgendaHoverDate(dateKey);
  };
  const agendaPassiveDateChangeImplRef = useRef(agendaPassiveDateChangeImpl);
  useLayoutEffect(() => {
    agendaPassiveDateChangeImplRef.current = agendaPassiveDateChangeImpl;
  });
  const onAgendaPassiveDateChange = useCallback((dateKey: string) => {
    agendaPassiveDateChangeImplRef.current?.(dateKey);
  }, []);

  function onAgendaEventAction({
    event,
    item,
    dateKey,
    anchorElement,
    sourceCellElement,
    anchorKind,
    detailKind,
    preserveEventSelection = false,
  }: CalendarAgendaItemAction) {
    const selectedItem = item || event;
    if (!selectedItem) return;
    scroll.suppressPassiveSync();
    const parsed = parseYmd(dateKey);
    if (!parsed) return;
    const current = floating.detailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty) {
      editor.shakeEditor();
      return;
    }
    editor.closeEventEditor();
    if (!preserveEventSelection) editor.clearEventSelectionSet();
    scroll.releaseEntryScroll(true);
    selection.setSelectedDay(parsed.day);
    selection.setSelectedDateKey(dateKey);
    const rawItemId = activeView.getItemId ? activeView.getItemId(selectedItem) : selectedItem.id;
    const itemId = rawItemId == null || typeof rawItemId === "string" || typeof rawItemId === "number"
      ? rawItemId
      : String(rawItemId);
    selection.setSelectedItemId(itemId != null ? String(itemId) : null);
    agendaSelectionAnchorRef.current = {
      itemId: itemId != null ? String(itemId) : null,
      dateKey,
      anchorKind: anchorKind || "agenda-row",
    };
    floating.openDetail({
      mode: "detail",
      view,
      detailKind: detailKind || null,
      itemId,
      dateKey,
      day: parsed.day,
      anchorElement,
      sourceCellElement,
      anchorKind: anchorKind || "agenda-row",
      itemsSnapshot: [selectedItem],
    });
  }

  const scrollAgendaToDate = useCallback((dateKey: string) => {
    agendaSelectionAnchorRef.current = null;
    requestScroll({ type: "date", dateKey });
  }, [requestScroll]);

  const scrollAgendaToEvent = useCallback((itemId: string | number, dateKey: string) => {
    agendaSelectionAnchorRef.current = null;
    requestScroll({ type: "event", itemId, dateKey });
  }, [requestScroll]);

  function onMiniCalendarDateAction(dateKey: string) {
    const parsed = parseYmd(dateKey);
    if (!parsed) return false;
    if (editor.isDirty()) {
      editor.shakeEditor();
      return false;
    }
    if (parsed.year !== viewYear || parsed.month !== viewMonth) {
      const nextMonth = { year: parsed.year, month: parsed.month };
      selection.setViewDate(nextMonth);
      selection.setFetchAnchor(nextMonth);
      selection.setLabelMonth(nextMonth);
    }
    onAgendaSelectDate(dateKey);
    scrollAgendaToDate(dateKey);
    return true;
  }

  function onMiniCalendarDateCreate(dateKey: string) {
    if (!onMiniCalendarDateAction(dateKey)) return false;
    editor.openEventCreate(dateKey);
    return true;
  }

  const resolveSelectedAgendaEditAnchor = useCallback((itemId: string | number, dateKey: string | null) => {
    const lastAgendaSelection = agendaSelectionAnchorRef.current;
    if (
      !lastAgendaSelection
      || String(lastAgendaSelection.itemId || "") !== String(itemId || "")
      || lastAgendaSelection.dateKey !== dateKey
      || !String(lastAgendaSelection.anchorKind || "").startsWith("agenda")
    ) return null;
    const anchor = railRef.current?.getItemAnchor?.(itemId, dateKey);
    if (!anchor) return null;
    return {
      anchorElement: anchor,
      sourceCellElement: anchor,
      anchorKind: lastAgendaSelection.anchorKind,
    };
  }, [railRef]);

  return {
    onAgendaPassiveDateChange,
    onAgendaDateAction: onAgendaSelectDate,
    onMiniCalendarDateAction,
    onMiniCalendarDateCreate,
    onAgendaEventAction,
    scrollAgendaToDate,
    scrollAgendaToEvent,
    resolveSelectedAgendaEditAnchor,
  };
}
