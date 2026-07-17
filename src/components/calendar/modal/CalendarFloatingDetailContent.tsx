import CalendarEventEditorRail from "../events/CalendarEventEditorRail";
import { renderDeadlinesDetail, renderDeadlinesFloatingDetail } from "../views/deadlines/DeadlinesDetailRail.tsx";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import type useCalendarEventEditor from "../events/useCalendarEventEditor";
import type { CalendarDraftGhostPreview } from "../events/CalendarDraftPreviewPanel";
import type { CalendarFloatingDetail } from "../../../hooks/calendar/useCalendarFloatingDetail";
import type { CalendarGridDayState, CalendarGridItemLike } from "./calendarGridCellModel";

const renderDeadlinesDetailCompat = renderDeadlinesDetail as unknown as (props: Record<string, unknown>) => ReactNode;
const renderDeadlinesFloatingDetailCompat = renderDeadlinesFloatingDetail as unknown as (props: Record<string, unknown>) => ReactNode;

type CalendarEventEditor = ReturnType<typeof useCalendarEventEditor>;
type CalendarEventEditorInput = Parameters<CalendarEventEditor["openEdit"]>[0];
export type CalendarDetailItem = CalendarGridItemLike;
type CalendarEventEditorRailCompatProps = ComponentProps<typeof CalendarEventEditorRail> & { expandedDesktop?: boolean };
const CalendarEventEditorRailCompat = CalendarEventEditorRail as ComponentType<CalendarEventEditorRailCompatProps>;

export interface CalendarFloatingDetailActiveView {
  getDayState?: (items: CalendarDetailItem[]) => CalendarGridDayState<CalendarDetailItem>;
  getItemId?: (item: CalendarDetailItem) => unknown;
  matchesItemId?: (item: CalendarDetailItem, itemId: unknown) => boolean;
  renderFloatingDetail?: (options: Record<string, unknown>) => ReactNode;
}

export interface CalendarFloatingDetailContentProps {
  activeView: CalendarFloatingDetailActiveView;
  computed?: unknown;
  deadlineEditor?: Record<string, unknown> | null;
  effectiveSelectedItemId?: unknown;
  eventEditor: CalendarEventEditor;
  floatingDeadlineDetail: boolean;
  floatingDetail: CalendarFloatingDetail | null;
  floatingEditorOpen: boolean;
  ghostPreview?: CalendarDraftGhostPreview | null;
  layout: { stacked?: boolean };
  mobileSheet?: boolean;
  hideEdit?: boolean;
  onCancelFloatingEditor: () => void;
  onCloseFloatingDetail?: () => boolean | void;
  onDeadlineDraftPreviewChange?: (preview: unknown) => void;
  onFloatingDeadlineDeleted?: (taskId: unknown) => void;
  onFloatingDeadlineSaved?: (task: CalendarDetailItem) => void;
  onFloatingEditorDirtyChange?: (dirty: boolean) => void;
  onFloatingEditorSaveRequest?: (requestId: string) => void;
  onOpenFloatingDeadlineEdit?: (task: CalendarDetailItem, context: Record<string, unknown>) => void;
  onOpenFloatingEventEdit?: (item: CalendarDetailItem, context: Record<string, unknown>) => void;
  selectedDateKey?: string | null;
  selectedDay?: number | null;
  selectedDayState: CalendarGridDayState<CalendarDetailItem>;
  selectedItems?: CalendarDetailItem[] | CalendarGridDayState<CalendarDetailItem>;
  setDeadlineEditor: (editor: Record<string, unknown> | null) => void;
  setSelectedItemId: (itemId: string | null) => void;
  view: string;
  viewData?: unknown;
  viewMonth: number;
  viewYear: number;
  focusDeadlineTask?: (task: CalendarDetailItem) => void;
}

export default function CalendarFloatingDetailContent({
  activeView,
  computed,
  deadlineEditor,
  effectiveSelectedItemId,
  eventEditor,
  floatingDeadlineDetail,
  floatingDetail,
  floatingEditorOpen,
  ghostPreview,
  layout,
  mobileSheet = false,
  hideEdit = false,
  onCancelFloatingEditor,
  onCloseFloatingDetail,
  onDeadlineDraftPreviewChange,
  onFloatingDeadlineDeleted,
  onFloatingDeadlineSaved,
  onFloatingEditorDirtyChange,
  onFloatingEditorSaveRequest,
  onOpenFloatingDeadlineEdit,
  onOpenFloatingEventEdit,
  selectedDateKey,
  selectedDay,
  selectedDayState,
  selectedItems,
  setDeadlineEditor,
  setSelectedItemId,
  view,
  viewData,
  viewMonth,
  viewYear,
  focusDeadlineTask,
}: CalendarFloatingDetailContentProps) {
  if ((layout.stacked && !mobileSheet) || !floatingDetail?.open) return null;

  const selectedItemPool = activeView.getDayState
    ? [
        ...(selectedDayState.activeItems || []),
        ...(selectedDayState.completedItems || []),
      ]
    : Array.isArray(selectedItems)
      ? selectedItems
      : selectedDayState.items || [];
  const getItemId = activeView.getItemId;
  const selectedItemResolves = floatingDetail?.itemId && getItemId
    ? selectedItemPool.some((item) => (
        activeView.matchesItemId?.(item, floatingDetail.itemId)
        || String(getItemId(item)) === String(floatingDetail.itemId)
      ))
    : !!floatingDetail?.itemId;
  const floatingDetailItems = !selectedItemResolves
      && Array.isArray(floatingDetail?.itemsSnapshot)
        ? floatingDetail.itemsSnapshot
    : String(floatingDetail?.anchorKind || "").startsWith("search")
      && !selectedItemResolves
      && Array.isArray(floatingDetail.itemsSnapshot)
        ? floatingDetail.itemsSnapshot
    : floatingDetail?.view && floatingDetail.view !== view && !selectedItemResolves && Array.isArray(floatingDetail.itemsSnapshot)
      ? floatingDetail.itemsSnapshot
      : selectedItems;

  if (floatingEditorOpen && floatingDeadlineDetail) {
    return renderDeadlinesDetailCompat({
      selectedDay,
      selectedDateKey,
      viewYear,
      viewMonth,
      items: floatingDetailItems,
      data: viewData,
      computed,
      selectedItemId: floatingDetail.itemId,
      onSelectItem: (itemId: unknown) => {
        setSelectedItemId(String(itemId));
      },
      editorState: deadlineEditor,
      onStartEdit: (task: CalendarDetailItem) => {
        onOpenFloatingDeadlineEdit?.(task, { dateKey: selectedDateKey });
      },
      onCloseEditor: onCancelFloatingEditor,
      onTaskSaved: (task: CalendarDetailItem) => {
        focusDeadlineTask?.(task);
        onFloatingDeadlineSaved?.(task);
      },
      onTaskDeleted: (taskId: unknown) => {
        onFloatingDeadlineDeleted?.(taskId);
      },
      onDraftPreviewChange: onDeadlineDraftPreviewChange,
      onEditorDirtyChange: onFloatingEditorDirtyChange,
      ghostPreview,
    });
  }

  if (floatingEditorOpen && floatingDetail.view === "events") {
    return (
      <CalendarEventEditorRailCompat
        editor={{
          ...eventEditor,
          closeEditor: onCancelFloatingEditor,
          save: () => {
            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            onFloatingEditorSaveRequest?.(requestId);
            return eventEditor.save?.();
          },
        }}
        expandedDesktop
        host="floating"
        ghostPreview={ghostPreview}
      />
    );
  }

  if (floatingDeadlineDetail) {
    return renderDeadlinesFloatingDetailCompat({
      selectedDay,
      selectedDateKey,
      viewYear,
      viewMonth,
      items: floatingDetailItems,
      data: viewData,
      computed,
      selectedItemId: floatingDetail.itemId,
      hideEdit,
      onStartEdit: (task: CalendarDetailItem) => {
        if (!layout.stacked) {
          onOpenFloatingDeadlineEdit?.(task, {
            dateKey: floatingDetail.dateKey || selectedDateKey,
            anchorElement: floatingDetail.anchorElement,
            sourceCellElement: floatingDetail.sourceCellElement,
            exclusionElement: floatingDetail.exclusionElement,
            anchorKind: floatingDetail.anchorKind,
          });
        }
      },
      onCloseFloatingDetail,
      ghostPreview,
    });
  }

  return activeView.renderFloatingDetail?.({
    selectedDay,
    selectedDateKey,
    viewYear,
    viewMonth,
    items: floatingDetailItems,
    data: viewData,
    computed,
    selectedItemId: floatingDetail.itemId,
    hideEdit,
    onEditEvent: (item: CalendarDetailItem) => {
      if (!layout.stacked) {
        onOpenFloatingEventEdit?.(item, {
          dateKey: floatingDetail.dateKey || selectedDateKey,
          anchorElement: floatingDetail.anchorElement,
          sourceCellElement: floatingDetail.sourceCellElement,
          exclusionElement: floatingDetail.exclusionElement,
          anchorKind: floatingDetail.anchorKind,
        });
      } else {
        onCloseFloatingDetail?.();
        eventEditor.openEdit?.(item as CalendarEventEditorInput);
      }
    },
    editorState: null,
    onCloseFloatingDetail,
    onStartEdit: (task: CalendarDetailItem) => {
      if (!layout.stacked) {
        onOpenFloatingDeadlineEdit?.(task, {
          dateKey: floatingDetail.dateKey || selectedDateKey,
          anchorElement: floatingDetail.anchorElement,
          sourceCellElement: floatingDetail.sourceCellElement,
          exclusionElement: floatingDetail.exclusionElement,
          anchorKind: floatingDetail.anchorKind,
        });
      } else {
        onCloseFloatingDetail?.();
        const itemId = activeView.getItemId?.(task) ?? task.id;
        setSelectedItemId(itemId != null ? String(itemId) : null);
        setDeadlineEditor({ mode: "edit", taskId: String(task.id) });
        onDeadlineDraftPreviewChange?.(null);
      }
    },
    onCloseEditor: () => {
      setDeadlineEditor(null);
      onDeadlineDraftPreviewChange?.(null);
    },
    onTaskSaved: focusDeadlineTask,
    onTaskDeleted: (taskId: unknown) => {
      setDeadlineEditor(null);
      onDeadlineDraftPreviewChange?.(null);
      const selectedId = String(effectiveSelectedItemId || "");
      if (selectedId === String(taskId) || selectedId.includes(`:${taskId}-`)) {
        setSelectedItemId(null);
        onCloseFloatingDetail?.();
      }
    },
    onDraftPreviewChange: onDeadlineDraftPreviewChange,
    ghostPreview,
  });
}
