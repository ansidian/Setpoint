import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { parseYmd } from "../../components/calendar/calendarDateUtils.ts";
import { ymdFromView } from "./calendarModalSelectionModel";
import { initialDeadlineEditorState } from "./calendarModalInteractionModel";
import type { CalendarFloatingDetail } from "./useCalendarFloatingDetail";
import type {
  CalendarEventCreateOpenResult,
  CalendarEventCreateRequest,
} from "./calendarEventCreateBridge";

export interface FloatingEditorItem {
  id?: string | number | null;
  title?: string;
  startMs?: number | null;
  due_date?: string | null;
  writable?: boolean;
  calendarItemKind?: string;
}

export type FloatingEditorDetail = CalendarFloatingDetail;

export type DeadlineEditorState =
  | { mode: "create"; seedDate: string | null }
  | { mode: "edit"; taskId: string };

export interface FloatingOpenOptions {
  dateKey?: string | null;
  anchorElement?: HTMLElement | null;
  sourceCellElement?: HTMLElement | null;
  exclusionElement?: HTMLElement | null;
  anchorKind?: string;
  allowSelectionFallback?: boolean;
}

interface FloatingEventEditorRef {
  openCreate?: (request?: CalendarEventCreateRequest) => Promise<CalendarEventCreateOpenResult>;
  openEdit?: (item: FloatingEditorItem) => void;
  closeEditor?: () => void;
}

export interface FloatingEditorRoutingOptions {
  activeSelectedDateKey: string | null;
  activeView: { getItemId?: (item: FloatingEditorItem) => unknown };
  eventEditorRef: MutableRefObject<FloatingEventEditorRef | null>;
  findDateCell: (dateKey: string | null) => HTMLElement | null;
  floatingDetailRef: MutableRefObject<FloatingEditorDetail | null>;
  focusDate?: string | null;
  focusItemId?: string | null;
  forceDeadlineOverlay?: boolean;
  open: boolean;
  openFloatingDetail: (detail: FloatingEditorDetail) => void;
  selectedDay: number | null;
  selectedItemId: string | null;
  setFloatingDetail: Dispatch<SetStateAction<FloatingEditorDetail | null>>;
  setSelectedDateKey: Dispatch<SetStateAction<string | null>>;
  setSelectedDay: Dispatch<SetStateAction<number | null>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  suppressAgendaPassiveSync: () => void;
  todayDateKey?: string | null;
  view: string;
  viewMonth: number;
  viewYear: number;
}

function pacificDateKeyFromMs(ms: number | null | undefined) {
  if (!ms) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function findEventGhostAnchor(dateCell: HTMLElement | null, dateKey: string | null): HTMLElement | null {
  const findMatchingGhost = (root: ParentNode) => (
    Array.from(root.querySelectorAll<HTMLElement>("[data-ghost-kind='event']"))
      .find((element) => !dateKey || element.dataset.ghostStart === dateKey) || null
  );
  return (dateCell && findMatchingGhost(dateCell)) || findMatchingGhost(document);
}

const SEEDED_EVENT_GHOST_READY_TIMEOUT_MS = 1500;
const SEEDED_EVENT_GHOST_MIN_TRACKED_FRAMES = 4;
const SEEDED_EVENT_GHOST_STABLE_FRAMES = 2;

function elementRectSignature(element: HTMLElement): string {
  const rect = element.getBoundingClientRect();
  return [rect.top, rect.right, rect.bottom, rect.left, rect.width, rect.height].join(":");
}

function resolveSeededEventCreateAnchor(
  dateCell: HTMLElement | null,
  dateKey: string | null,
): Promise<HTMLElement | null> {
  if (typeof MutationObserver === "undefined" || !document.documentElement) {
    return Promise.resolve(findEventGhostAnchor(dateCell, dateKey) || dateCell);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: number | null = null;
    let frameId: number | null = null;
    let observer: MutationObserver | null = null;
    let trackedAnchor: HTMLElement | null = null;
    let trackedRect = "";
    let trackedFrames = 0;
    let stableFrames = 0;
    const finish = (anchor: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      resolve(anchor);
    };
    const trackMatchingGhost = () => {
      frameId = null;
      const matchingGhost = findEventGhostAnchor(dateCell, dateKey);
      if (!matchingGhost?.isConnected) {
        trackedAnchor = null;
        trackedRect = "";
        trackedFrames = 0;
        stableFrames = 0;
        return;
      }

      const rect = elementRectSignature(matchingGhost);
      if (matchingGhost === trackedAnchor && rect === trackedRect) {
        stableFrames += 1;
      } else {
        trackedAnchor = matchingGhost;
        trackedRect = rect;
        stableFrames = 1;
      }
      trackedFrames += 1;

      // The target ghost can render before CalendarScrollContainer's effect has
      // started its smooth/instant jump. Give that navigation a few frames to
      // begin, then require consecutive stable geometry before positioning the
      // floating editor against the ghost.
      if (
        trackedFrames >= SEEDED_EVENT_GHOST_MIN_TRACKED_FRAMES
        && stableFrames >= SEEDED_EVENT_GHOST_STABLE_FRAMES
      ) {
        finish(matchingGhost);
        return;
      }
      frameId = window.requestAnimationFrame(trackMatchingGhost);
    };
    const scheduleMatchingGhostTrack = () => {
      if (frameId !== null || !findEventGhostAnchor(dateCell, dateKey)) return;
      frameId = window.requestAnimationFrame(trackMatchingGhost);
    };

    observer = new MutationObserver(scheduleMatchingGhostTrack);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    timeoutId = window.setTimeout(() => {
      finish(findEventGhostAnchor(dateCell, dateKey) || dateCell);
    }, SEEDED_EVENT_GHOST_READY_TIMEOUT_MS);
    // Close the gap between the initial lookup and observer registration.
    scheduleMatchingGhostTrack();
  });
}

function resolveFloatingDeadlineItemId(activeView: FloatingEditorRoutingOptions["activeView"] | null | undefined, task: FloatingEditorItem | null | undefined) {
  const itemId = activeView?.getItemId && task ? activeView.getItemId(task) : task?.id;
  return itemId != null ? String(itemId) : null;
}

function resolveFloatingEventItemId(activeView: FloatingEditorRoutingOptions["activeView"] | null | undefined, savedEvent: FloatingEditorItem | null | undefined, currentDetail: FloatingEditorDetail | null = null) {
  const itemId = activeView?.getItemId && savedEvent ? activeView.getItemId(savedEvent) : savedEvent?.id;
  if (itemId != null) return String(itemId);
  return currentDetail?.itemId != null ? String(currentDetail.itemId) : null;
}

/**
 * Owns floating-editor routing for BOTH the event and deadline editors behind one
 * interface (D-CAL-5). The event and deadline flows are deliberately parallel:
 *   - open:        openFloatingEventCreate/Edit  ↔  openFloatingDeadlineCreate/Edit
 *   - save→detail: handleEventEditorSaved        ↔  handleFloatingDeadlineSaved
 *   - delete:      handleEventEditorDeleted       ↔  handleFloatingDeadlineDeleted
 *   - cancel:      cancelFloatingEditor (shared, dispatches on detailKind)
 * Both save handlers transition the shared `floatingDetail` to `mode: "detail"`.
 *
 * The deadline editor's own state (`deadlineEditor` / `deadlineDraftPreview`) lives
 * here rather than in the controller, so the editor and its routing are one unit.
 * The setters are returned so the controller's selection/navigation/sync paths can
 * still reset editor state imperatively.
 */
export default function useFloatingEditorRouting({
  activeSelectedDateKey,
  activeView,
  eventEditorRef,
  findDateCell,
  floatingDetailRef,
  focusDate = null,
  focusItemId,
  forceDeadlineOverlay = false,
  open,
  openFloatingDetail,
  selectedDay,
  selectedItemId,
  setFloatingDetail,
  setSelectedDateKey,
  setSelectedDay,
  setSelectedItemId,
  suppressAgendaPassiveSync,
  todayDateKey = null,
  view,
  viewMonth,
  viewYear,
}: FloatingEditorRoutingOptions) {
  const [deadlineEditor, setDeadlineEditor] = useState<DeadlineEditorState | null>(() => initialDeadlineEditorState({
    open,
    view,
    focusItemId,
    focusDate,
    forceDeadlineOverlay,
    todayDateKey,
  }));
  const [deadlineDraftPreview, setDeadlineDraftPreview] = useState<Record<string, unknown> | null>(null);

  const handleEventEditorSaved = useCallback((savedEvent: FloatingEditorItem | null) => {
    const current = floatingDetailRef.current;
    if (!current?.open || current.view !== "events" || (current.mode !== "edit" && current.mode !== "create")) return;
    if (current.saveRequestId && current.saveRequestId !== current.activeSaveRequestId) return;
    if (!savedEvent?.id) {
      setFloatingDetail(null);
      return;
    }
    const dateKey = savedEvent.startMs ? pacificDateKeyFromMs(savedEvent.startMs) : current.dateKey;
    const parsed = parseYmd(dateKey);
    const itemId = resolveFloatingEventItemId(activeView, savedEvent, current);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey!);
    }
    setSelectedItemId(itemId);
    setFloatingDetail({
      ...current,
      mode: "detail",
      itemId,
      dateKey,
      day: parsed?.day ?? current.day ?? null,
      itemsSnapshot: [savedEvent],
      editorSessionId: null,
      saveRequestId: null,
      activeSaveRequestId: null,
      dirty: false,
    });
  }, [activeView, floatingDetailRef, setFloatingDetail, setSelectedDateKey, setSelectedDay, setSelectedItemId]);

  const handleEventEditorDeleted = useCallback((deletedEvent: FloatingEditorItem | null) => {
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

  const openFloatingEventCreate = useCallback((
    seedDate: string | null = null,
    request?: CalendarEventCreateRequest,
  ): Promise<CalendarEventCreateOpenResult> | void => {
    suppressAgendaPassiveSync();
    const dateKey = seedDate || activeSelectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay });
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    const dateCell = findDateCell(dateKey);
    setSelectedItemId(null);
    // Switching create workspaces must reset the other domain's editor, or its
    // ghost preview lingers on the grid behind the new editor.
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
    const openCreate = eventEditorRef.current?.openCreate;
    const openDetail = (
      anchorElement: HTMLElement | null = dateCell,
      sourceCellElement: HTMLElement | null = dateCell,
    ) => openFloatingDetail({
      mode: "create",
      view: "events",
      dateKey,
      day: parsed?.day ?? null,
      anchorElement,
      sourceCellElement,
      anchorKind: anchorElement !== sourceCellElement ? "chip" : "day-cell",
    });
    if (request) {
      if (!openCreate) {
        return Promise.resolve({ accepted: false, reason: "editor_unavailable" });
      }
      return openCreate(request).then((result) => {
        if (!result.accepted) return result;
        return resolveSeededEventCreateAnchor(dateCell, dateKey).then((anchorElement) => {
          openDetail(anchorElement, findDateCell(dateKey) || dateCell);
          return result;
        });
      });
    }
    void openCreate?.();
    openDetail();
  }, [activeSelectedDateKey, eventEditorRef, findDateCell, openFloatingDetail, selectedDay, setDeadlineDraftPreview, setDeadlineEditor, setSelectedDateKey, setSelectedDay, setSelectedItemId, suppressAgendaPassiveSync, viewMonth, viewYear]);

  const openFloatingEventEdit = useCallback((item: FloatingEditorItem, options: FloatingOpenOptions = {}) => {
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
      && String(current.itemId) === String(itemId);
    openFloatingDetail({
      mode: "edit",
      view: "events",
      itemId: itemId != null ? String(itemId) : null,
      dateKey,
      day: parsed?.day ?? null,
      anchorElement: options.anchorElement || (reuseCurrentAnchor ? current.anchorElement : null) || fallbackCell,
      sourceCellElement: options.sourceCellElement || (reuseCurrentAnchor ? current.sourceCellElement : null) || fallbackCell,
      exclusionElement: options.exclusionElement || null,
      anchorKind: options.anchorKind || (reuseCurrentAnchor ? current.anchorKind : "day-cell"),
      itemsSnapshot: [item],
    });
  }, [activeSelectedDateKey, activeView, eventEditorRef, findDateCell, floatingDetailRef, openFloatingDetail, setSelectedDateKey, setSelectedDay, setSelectedItemId, suppressAgendaPassiveSync]);

  const openFloatingDeadlineCreate = useCallback((seedDate: string | null = null, options: FloatingOpenOptions = {}) => {
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
    // Switching create workspaces must reset the other domain's editor, or its
    // ghost preview lingers on the grid behind the new editor.
    eventEditorRef.current?.closeEditor?.();
    setDeadlineEditor({ mode: "create", seedDate: dateKey || null });
    setDeadlineDraftPreview(null);
    openFloatingDetail({
      mode: "create",
      view: "events",
      detailKind: "deadline",
      dateKey,
      day: parsed?.day ?? null,
      anchorElement: dateCell,
      sourceCellElement: dateCell,
      anchorKind: "day-cell",
    });
  }, [activeSelectedDateKey, eventEditorRef, findDateCell, openFloatingDetail, selectedDay, setDeadlineDraftPreview, setDeadlineEditor, setSelectedDateKey, setSelectedDay, setSelectedItemId, viewMonth, viewYear]);

  const openFloatingDeadlineEdit = useCallback((task: FloatingEditorItem, options: FloatingOpenOptions = {}) => {
    if (!task?.id) return;
    const itemId = resolveFloatingDeadlineItemId(activeView, task);
    const editTaskId = String(task.id);
    const dateKey = options.dateKey || task.due_date || activeSelectedDateKey;
    const fallbackCell = findDateCell(dateKey);
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    setSelectedItemId(itemId != null ? String(itemId) : null);
    setDeadlineEditor({ mode: "edit", taskId: editTaskId });
    setDeadlineDraftPreview(null);
    const current = floatingDetailRef.current;
    const reuseCurrentAnchor = current?.open
      && current.detailKind === "deadline"
      && String(current.itemId) === String(itemId);
    openFloatingDetail({
      mode: "edit",
      view: "events",
      detailKind: "deadline",
      itemId: itemId != null ? String(itemId) : null,
      dateKey,
      day: parsed?.day ?? null,
      anchorElement: options.anchorElement || (reuseCurrentAnchor ? current.anchorElement : null) || fallbackCell,
      sourceCellElement: options.sourceCellElement || (reuseCurrentAnchor ? current.sourceCellElement : null) || fallbackCell,
      exclusionElement: options.exclusionElement || null,
      anchorKind: options.anchorKind || (reuseCurrentAnchor ? current.anchorKind : "day-cell"),
      itemsSnapshot: [task],
    });
  }, [activeSelectedDateKey, activeView, findDateCell, floatingDetailRef, openFloatingDetail, setDeadlineDraftPreview, setDeadlineEditor, setSelectedDateKey, setSelectedDay, setSelectedItemId]);

  const cancelFloatingEditor = useCallback(() => {
    const current = floatingDetailRef.current;
    if (!current?.open || (current.mode !== "edit" && current.mode !== "create")) return;
    suppressAgendaPassiveSync();
    if (current.view === "events") {
      eventEditorRef.current?.closeEditor?.();
    }
    if (current.detailKind === "deadline") {
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
  }, [eventEditorRef, floatingDetailRef, setDeadlineDraftPreview, setDeadlineEditor, setFloatingDetail, suppressAgendaPassiveSync]);

  const handleFloatingDeadlineSaved = useCallback((task: FloatingEditorItem | null) => {
    const current = floatingDetailRef.current;
    if (!current?.open || current.detailKind !== "deadline" || (current.mode !== "edit" && current.mode !== "create")) return;
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
    const itemId = resolveFloatingDeadlineItemId(activeView, task) || String(task.id);
    setSelectedItemId(itemId);
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
    setFloatingDetail({
      ...current,
      mode: "detail",
      itemId,
      dateKey,
      day: parsed?.day ?? current.day ?? null,
      itemsSnapshot: [task],
      editorSessionId: null,
      saveRequestId: null,
      activeSaveRequestId: null,
      dirty: false,
    });
  }, [activeSelectedDateKey, activeView, floatingDetailRef, setDeadlineDraftPreview, setDeadlineEditor, setFloatingDetail, setSelectedDateKey, setSelectedDay, setSelectedItemId]);

  const handleFloatingDeadlineDeleted = useCallback((taskId: string | number) => {
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
    setFloatingDetail(null);
    if (String(selectedItemId) === String(taskId)) {
      setSelectedItemId(null);
    }
  }, [selectedItemId, setDeadlineDraftPreview, setDeadlineEditor, setFloatingDetail, setSelectedItemId]);

  return {
    deadlineEditor,
    deadlineDraftPreview,
    setDeadlineEditor,
    setDeadlineDraftPreview,
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
