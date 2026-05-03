import { useCallback } from "react";
import { parseYmd } from "../../components/calendar/calendarDateUtils.js";
import { ymdFromView } from "./calendarModalSelectionModel.js";

function pacificDateKeyFromMs(ms) {
  if (!ms) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export default function useCalendarModalEditorRouting({
  activeSelectedDateKey,
  activeView,
  eventEditorRef,
  findDateCell,
  floatingDetailRef,
  openFloatingDetail,
  selectedDay,
  selectedItemId,
  setDeadlineDraftPreview,
  setDeadlineEditor,
  setFloatingDetail,
  setSelectedDateKey,
  setSelectedDay,
  setSelectedItemId,
  suppressAgendaPassiveSync,
  viewMonth,
  viewYear,
}) {
  const handleEventEditorSaved = useCallback((savedEvent) => {
    const current = floatingDetailRef.current;
    if (!current?.open || current.view !== "events" || (current.mode !== "edit" && current.mode !== "create")) return;
    if (current.saveRequestId && current.saveRequestId !== current.activeSaveRequestId) return;
    if (!savedEvent?.id) {
      setFloatingDetail(null);
      return;
    }
    const dateKey = savedEvent.startMs ? pacificDateKeyFromMs(savedEvent.startMs) : current.dateKey;
    const parsed = parseYmd(dateKey);
    const itemId = activeView.getItemId ? activeView.getItemId(savedEvent) : savedEvent.id;
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    setSelectedItemId(String(itemId));
    setFloatingDetail({
      ...current,
      mode: "detail",
      itemId: String(itemId),
      dateKey,
      day: parsed?.day ?? current.day ?? null,
      itemsSnapshot: [savedEvent],
      editorSessionId: null,
      saveRequestId: null,
      activeSaveRequestId: null,
      dirty: false,
    });
  }, [activeView, floatingDetailRef, setFloatingDetail, setSelectedDateKey, setSelectedDay, setSelectedItemId]);

  const handleEventEditorDeleted = useCallback((deletedEvent) => {
    const current = floatingDetailRef.current;
    if (current?.open && current.view === "events") {
      setFloatingDetail(null);
    }
    const deletedId = deletedEvent && activeView.getItemId
      ? activeView.getItemId(deletedEvent)
      : deletedEvent?.id;
    if (deletedId != null && String(selectedItemId) === String(deletedId)) {
      setSelectedItemId(null);
    }
  }, [activeView, floatingDetailRef, selectedItemId, setFloatingDetail, setSelectedItemId]);

  const openFloatingEventCreate = useCallback((seedDate = null) => {
    suppressAgendaPassiveSync();
    const dateKey = seedDate || activeSelectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay });
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    const dateCell = findDateCell(dateKey);
    setSelectedItemId(null);
    eventEditorRef.current?.openCreate?.();
    openFloatingDetail({
      mode: "create",
      view: "events",
      dateKey,
      day: parsed?.day ?? null,
      anchorElement: dateCell,
      sourceCellElement: dateCell,
      anchorKind: "day-cell",
      parked: !dateCell,
    });
  }, [activeSelectedDateKey, eventEditorRef, findDateCell, openFloatingDetail, selectedDay, setSelectedDateKey, setSelectedDay, setSelectedItemId, suppressAgendaPassiveSync, viewMonth, viewYear]);

  const openFloatingEventEdit = useCallback((item, options = {}) => {
    if (!item?.writable) return;
    suppressAgendaPassiveSync();
    const itemId = activeView.getItemId ? activeView.getItemId(item) : item.id;
    const dateKey = options.dateKey || pacificDateKeyFromMs(item.startMs) || activeSelectedDateKey;
    const fallbackCell = findDateCell(dateKey);
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    setSelectedItemId(itemId != null ? String(itemId) : null);
    eventEditorRef.current?.openEdit?.(item);
    const current = floatingDetailRef.current;
    const reuseCurrentAnchor = current?.open
      && current.view === "events"
      && String(current.itemId) === String(itemId)
      && !current.parked;
    openFloatingDetail({
      mode: "edit",
      view: "events",
      itemId: itemId != null ? String(itemId) : null,
      dateKey,
      day: parsed?.day ?? null,
      anchorElement: options.anchorElement || (reuseCurrentAnchor ? current.anchorElement : null) || fallbackCell,
      sourceCellElement: options.sourceCellElement || (reuseCurrentAnchor ? current.sourceCellElement : null) || fallbackCell,
      exclusionElement: options.exclusionElement || null,
      anchorKind: options.anchorKind || (reuseCurrentAnchor ? current.anchorKind : fallbackCell ? "day-cell" : "parked"),
      parked: options.parked ?? (!options.anchorElement && !reuseCurrentAnchor && !fallbackCell),
      itemsSnapshot: [item],
    });
  }, [activeSelectedDateKey, activeView, eventEditorRef, findDateCell, floatingDetailRef, openFloatingDetail, setSelectedDateKey, setSelectedDay, setSelectedItemId, suppressAgendaPassiveSync]);

  const openFloatingDeadlineCreate = useCallback((seedDate = null, options = {}) => {
    const allowSelectionFallback = options.allowSelectionFallback !== false;
    const dateKey = seedDate || (allowSelectionFallback
      ? activeSelectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay })
      : null);
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    const dateCell = findDateCell(dateKey);
    setSelectedItemId(null);
    setDeadlineEditor({ mode: "create", seedDate: dateKey || null });
    setDeadlineDraftPreview(null);
    openFloatingDetail({
      mode: "create",
      view: "deadlines",
      dateKey,
      day: parsed?.day ?? null,
      anchorElement: dateCell,
      sourceCellElement: dateCell,
      anchorKind: "day-cell",
      parked: !dateCell,
    });
  }, [activeSelectedDateKey, findDateCell, openFloatingDetail, selectedDay, setDeadlineDraftPreview, setDeadlineEditor, setSelectedDateKey, setSelectedDay, setSelectedItemId, viewMonth, viewYear]);

  const openFloatingDeadlineEdit = useCallback((task, options = {}) => {
    if (task?.source !== "todoist") return;
    const itemId = String(task.id);
    const dateKey = options.dateKey || task.due_date || activeSelectedDateKey;
    const fallbackCell = findDateCell(dateKey);
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    setSelectedItemId(itemId);
    setDeadlineEditor({ mode: "edit", taskId: itemId });
    setDeadlineDraftPreview(null);
    const current = floatingDetailRef.current;
    const reuseCurrentAnchor = current?.open
      && current.view === "deadlines"
      && String(current.itemId) === itemId
      && !current.parked;
    openFloatingDetail({
      mode: "edit",
      view: "deadlines",
      itemId,
      dateKey,
      day: parsed?.day ?? null,
      anchorElement: options.anchorElement || (reuseCurrentAnchor ? current.anchorElement : null) || fallbackCell,
      sourceCellElement: options.sourceCellElement || (reuseCurrentAnchor ? current.sourceCellElement : null) || fallbackCell,
      exclusionElement: options.exclusionElement || null,
      anchorKind: options.anchorKind || (reuseCurrentAnchor ? current.anchorKind : fallbackCell ? "day-cell" : "parked"),
      parked: options.parked ?? (!options.anchorElement && !reuseCurrentAnchor && !fallbackCell),
      itemsSnapshot: [task],
    });
  }, [activeSelectedDateKey, findDateCell, floatingDetailRef, openFloatingDetail, setDeadlineDraftPreview, setDeadlineEditor, setSelectedDateKey, setSelectedDay, setSelectedItemId]);

  const cancelFloatingEditor = useCallback(() => {
    const current = floatingDetailRef.current;
    if (!current?.open || (current.mode !== "edit" && current.mode !== "create")) return;
    if (current.view === "events") {
      eventEditorRef.current?.closeEditor?.();
    }
    if (current.view === "deadlines") {
      setDeadlineEditor(null);
      setDeadlineDraftPreview(null);
    }
    if (current.mode === "create") {
      setFloatingDetail(null);
      return;
    }
    setFloatingDetail({
      ...current,
      mode: "detail",
      editorSessionId: null,
      saveRequestId: null,
      activeSaveRequestId: null,
      dirty: false,
    });
  }, [eventEditorRef, floatingDetailRef, setDeadlineDraftPreview, setDeadlineEditor, setFloatingDetail]);

  const handleFloatingDeadlineSaved = useCallback((task) => {
    const current = floatingDetailRef.current;
    if (!current?.open || current.view !== "deadlines" || (current.mode !== "edit" && current.mode !== "create")) return;
    if (!task?.id) {
      setFloatingDetail(null);
      return;
    }
    const dateKey = task.due_date || current.dateKey || activeSelectedDateKey;
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    setSelectedItemId(String(task.id));
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
    setFloatingDetail({
      ...current,
      mode: "detail",
      itemId: String(task.id),
      dateKey,
      day: parsed?.day ?? current.day ?? null,
      itemsSnapshot: [task],
      editorSessionId: null,
      saveRequestId: null,
      activeSaveRequestId: null,
      dirty: false,
    });
  }, [activeSelectedDateKey, floatingDetailRef, setDeadlineDraftPreview, setDeadlineEditor, setFloatingDetail, setSelectedDateKey, setSelectedDay, setSelectedItemId]);

  const handleFloatingDeadlineDeleted = useCallback((taskId) => {
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
    setFloatingDetail(null);
    if (String(selectedItemId) === String(taskId)) {
      setSelectedItemId(null);
    }
  }, [selectedItemId, setDeadlineDraftPreview, setDeadlineEditor, setFloatingDetail, setSelectedItemId]);

  return {
    cancelFloatingEditor,
    handleEventEditorDeleted,
    handleEventEditorSaved,
    handleFloatingDeadlineDeleted,
    handleFloatingDeadlineSaved,
    openFloatingDeadlineCreate,
    openFloatingDeadlineEdit,
    openFloatingEventCreate,
    openFloatingEventEdit,
  };
}
