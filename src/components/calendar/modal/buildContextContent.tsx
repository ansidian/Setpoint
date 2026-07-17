import { CalendarOverviewRail, CalendarSelectedDayEmptyRail } from "../CalendarRailStates.tsx";
import CalendarEventEditorRail from "../events/CalendarEventEditorRail";
import { renderDeadlinesDetail } from "../views/deadlines/DeadlinesDetailRail.tsx";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import type useCalendarEventEditor from "../events/useCalendarEventEditor";
import type { CalendarDraftGhostPreview } from "../events/CalendarDraftPreviewPanel";
import type { CalendarDetailItem, CalendarFloatingDetailActiveView } from "./CalendarFloatingDetailContent";

const renderDeadlinesDetailCompat = renderDeadlinesDetail as unknown as (props: Record<string, unknown>) => ReactNode;

type CalendarEventEditor = ReturnType<typeof useCalendarEventEditor>;
type CalendarEventEditorInput = Parameters<CalendarEventEditor["openEdit"]>[0];
type CalendarEventEditorRailCompatProps = ComponentProps<typeof CalendarEventEditorRail> & { expandedDesktop?: boolean };
// This local type-only compatibility wrapper is not a separately exported component.
// eslint-disable-next-line react-refresh/only-export-components
const CalendarEventEditorRailCompat = CalendarEventEditorRail as ComponentType<CalendarEventEditorRailCompatProps>;

interface ContextActiveView extends CalendarFloatingDetailActiveView {
  renderSidebar?: (options: Record<string, unknown>) => ReactNode;
  renderDetail?: (options: Record<string, unknown>) => ReactNode;
}

export interface BuildContextContentOptions {
  layout: { stacked?: boolean };
  view: string;
  activeView: ContextActiveView;
  eventEditor: CalendarEventEditor;
  deadlineEditor?: Record<string, unknown> | null;
  selectedDay?: number | null;
  selectedDateKey?: string | null;
  itemsByDay: Record<number, CalendarDetailItem[]>;
  viewYear: number;
  viewMonth: number;
  viewData?: unknown;
  computed?: unknown;
  currentYear: number;
  currentMonth: number;
  todayDate: number;
  showDetail: boolean;
  showEmptySelection: boolean;
  effectiveSelectedItemId?: unknown;
  selectedItems?: CalendarDetailItem[];
  setSelectedDay: (day: number) => void;
  setSelectedItemId: (itemId: string | null) => void;
  setDeadlineEditor: (editor: Record<string, unknown> | null) => void;
  focusDeadlineTask?: (task: CalendarDetailItem) => void;
  onCreateEvent?: () => void;
  onCreateTask?: (seedDate?: string | null) => void;
  ghostPreview?: CalendarDraftGhostPreview | null;
  onDeadlineDraftPreviewChange?: (preview: unknown) => void;
  onCloseFloatingDetail?: () => boolean | void;
}

export default function buildContextContent({
  layout,
  view,
  activeView,
  eventEditor,
  deadlineEditor,
  selectedDay,
  selectedDateKey,
  itemsByDay,
  viewYear,
  viewMonth,
  viewData,
  computed,
  currentYear,
  currentMonth,
  todayDate,
  showDetail,
  showEmptySelection,
  effectiveSelectedItemId,
  selectedItems,
  setSelectedDay,
  setSelectedItemId,
  setDeadlineEditor,
  focusDeadlineTask,
  onCreateEvent,
  onCreateTask,
  ghostPreview,
  onDeadlineDraftPreviewChange,
  onCloseFloatingDetail,
}: BuildContextContentOptions) {
  if (view === "events" && eventEditor.isEditorOpen) {
    return (
      <CalendarEventEditorRailCompat
        editor={eventEditor}
        expandedDesktop={!layout.stacked}
        ghostPreview={ghostPreview}
      />
    );
  }

  if (view === "events" && deadlineEditor?.mode) {
    return renderDeadlinesDetailCompat({
      selectedDay,
      selectedDateKey,
      viewYear,
      viewMonth,
      items: selectedItems,
      data: viewData,
      computed,
      selectedItemId: effectiveSelectedItemId,
      onSelectItem: (itemId: unknown) => {
        setSelectedItemId(String(itemId));
      },
      editorState: deadlineEditor,
      onStartEdit: (task: CalendarDetailItem) => {
        const itemId = activeView.getItemId?.(task) ?? task.id;
        setSelectedItemId(itemId != null ? String(itemId) : null);
        setDeadlineEditor({ mode: "edit", taskId: String(task.id) });
        onDeadlineDraftPreviewChange?.(null);
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
        }
      },
      onDraftPreviewChange: onDeadlineDraftPreviewChange,
      ghostPreview,
    });
  }

  if (activeView.renderSidebar) {
    return activeView.renderSidebar({ selectedDay, itemsByDay, viewYear, viewMonth, data: viewData });
  }

  if (showDetail) {
    return activeView.renderDetail?.({
      selectedDay,
      selectedDateKey,
      viewYear,
      viewMonth,
      items: selectedItems,
      data: viewData,
      computed,
      selectedItemId: effectiveSelectedItemId,
      onSelectItem: (itemId: unknown) => {
        setSelectedItemId(String(itemId));
        setDeadlineEditor(null);
      },
      onEditEvent: (item: CalendarDetailItem) => {
        onCloseFloatingDetail?.();
        eventEditor.openEdit?.(item as CalendarEventEditorInput);
      },
      editorState: deadlineEditor,
      onStartEdit: (task: CalendarDetailItem) => {
        onCloseFloatingDetail?.();
        const itemId = activeView.getItemId?.(task) ?? task.id;
        setSelectedItemId(itemId != null ? String(itemId) : null);
        setDeadlineEditor({ mode: "edit", taskId: String(task.id) });
        onDeadlineDraftPreviewChange?.(null);
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
        }
      },
      onDraftPreviewChange: onDeadlineDraftPreviewChange,
      ghostPreview,
    });
  }

  if (showEmptySelection) {
    return (
      <CalendarSelectedDayEmptyRail
        view={view}
        selectedDay={selectedDay}
        selectedDateKey={selectedDateKey}
        viewYear={viewYear}
        viewMonth={viewMonth}
        currentYear={currentYear}
        currentMonth={currentMonth}
        todayDate={todayDate}
        itemsByDay={itemsByDay}
        computed={computed}
        data={viewData}
        activeView={activeView}
        eventEditor={eventEditor}
        setSelectedDay={setSelectedDay}
        setSelectedItemId={setSelectedItemId}
        setDeadlineEditor={setDeadlineEditor}
        onCreateEvent={onCreateEvent}
        onCreateTask={onCreateTask}
      />
    );
  }

  return (
    <CalendarOverviewRail
      view={view}
      viewYear={viewYear}
      viewMonth={viewMonth}
      currentYear={currentYear}
      currentMonth={currentMonth}
      todayDate={todayDate}
      itemsByDay={itemsByDay}
      computed={computed}
      data={viewData}
      activeView={activeView}
    />
  );
}
