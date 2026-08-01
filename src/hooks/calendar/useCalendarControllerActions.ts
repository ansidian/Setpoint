import { useCallback, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { parseYmd } from "../../components/calendar/calendarDateUtils.ts";
import type { getCalendarLayoutMetrics } from "../../components/calendar/calendarLayout.ts";
import useDeadlineQuickActions, { type UseDeadlineQuickActionsOptions } from "../../components/calendar/views/deadlines/useDeadlineQuickActions.ts";
import { getDeadlineSelectionId } from "../../components/calendar/views/deadlines/deadlinesModel.ts";
import useCalendarEventSelectionSet from "./useCalendarEventSelectionSet";
import { nextCalendarView } from "./calendarModalInteractionModel";
import type { CalendarFloatingDetail } from "./useCalendarFloatingDetail";
import type { DeadlineEditorState, FloatingEditorItem } from "./useFloatingEditorRouting";

type EventSelectionOptions = Parameters<typeof useCalendarEventSelectionSet>[0];
type CalendarLayout = ReturnType<typeof getCalendarLayoutMetrics>;

interface DeadlineActionOptions {
  open: boolean;
  view: string;
  overlayVisible: boolean;
  layout: CalendarLayout;
  actions: Record<string, unknown>;
  activeSelectedDateKey: string | null;
  setSelectedDay: Dispatch<SetStateAction<number | null>>;
  setSelectedDateKey: Dispatch<SetStateAction<string | null>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  setDeadlineEditor: Dispatch<SetStateAction<DeadlineEditorState | null>>;
  setDeadlineDraftPreview: Dispatch<SetStateAction<Record<string, unknown> | null>>;
  setFloatingDetail: Dispatch<SetStateAction<CalendarFloatingDetail | null>>;
  openFloatingDeadlineEdit: (task: FloatingEditorItem, options?: { dateKey?: string | null }) => void;
  handleFloatingDeadlineDeleted: (taskId: string | number) => void;
}

interface WorkspaceActionOptions {
  view: string;
  onViewChange?: (view: string) => void;
  billsAvailable: boolean;
  floatingDetailRef: MutableRefObject<CalendarFloatingDetail | null>;
  setFloatingDetail: Dispatch<SetStateAction<CalendarFloatingDetail | null>>;
  shakeFloatingEditor: () => void;
  focusDateKey: (dateKey: string) => void;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  setDeadlineEditor: Dispatch<SetStateAction<DeadlineEditorState | null>>;
  setDeadlineDraftPreview: Dispatch<SetStateAction<Record<string, unknown> | null>>;
}

interface CalendarControllerActionsOptions {
  eventSelection: EventSelectionOptions;
  deadline: DeadlineActionOptions;
  workspace: WorkspaceActionOptions;
}

/** Owns quick-action routing and guarded workspace transitions. */
export default function useCalendarControllerActions({
  eventSelection,
  deadline,
  workspace,
}: CalendarControllerActionsOptions) {
  const eventSelectionSet = useCalendarEventSelectionSet(eventSelection);
  const {
    view,
    onViewChange,
    billsAvailable,
    floatingDetailRef,
    setFloatingDetail,
    shakeFloatingEditor,
    focusDateKey,
    setSelectedItemId,
    setDeadlineEditor,
    setDeadlineDraftPreview,
  } = workspace;

  const deadlineQuickActions = useDeadlineQuickActions({
    enabled: deadline.open && deadline.view === "events" && deadline.overlayVisible,
    layout: deadline.layout,
    actions: deadline.actions,
    onEditTask: (task: FloatingEditorItem, options: { dateKey?: string | null } = {}) => {
      if (deadline.layout.stacked) {
        const dateKey = options.dateKey || task.due_date || deadline.activeSelectedDateKey;
        const parsed = parseYmd(dateKey);
        if (parsed) {
          deadline.setSelectedDay(parsed.day);
          deadline.setSelectedDateKey(dateKey);
        }
        deadline.setSelectedItemId(getDeadlineSelectionId(task, dateKey as never));
        deadline.setDeadlineEditor({ mode: "edit", taskId: String(task.id) });
        deadline.setDeadlineDraftPreview(null);
        deadline.setFloatingDetail(null);
        return;
      }
      deadline.openFloatingDeadlineEdit(task, options);
    },
    onDeleted: deadline.handleFloatingDeadlineDeleted,
  } as unknown as UseDeadlineQuickActionsOptions);

  const handleViewChange = useCallback((nextView: string) => {
    const current = floatingDetailRef.current;
    if (
      current?.open
      && (current.mode === "edit" || current.mode === "create")
      && current.dirty
      && nextView !== view
    ) {
      shakeFloatingEditor();
      return;
    }
    if (nextView && nextView !== view) setFloatingDetail(null);
    onViewChange?.(nextView);
  }, [floatingDetailRef, onViewChange, setFloatingDetail, shakeFloatingEditor, view]);

  const availableCalendarViews = useMemo(
    () => (billsAvailable ? ["events", "bills"] : ["events"]),
    [billsAvailable],
  );
  const cycleView = useCallback((reverse = false) => {
    const next = nextCalendarView({ current: view, views: availableCalendarViews, reverse });
    if (next && next !== view) handleViewChange(next);
  }, [availableCalendarViews, handleViewChange, view]);

  function focusDeadlineTask(task: FloatingEditorItem | null | undefined) {
    if (task?.due_date) focusDateKey(task.due_date);
    const itemId = getDeadlineSelectionId(task);
    setSelectedItemId(itemId != null ? String(itemId) : null);
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
  }

  return {
    ...eventSelectionSet,
    deadlineQuickActions,
    handleViewChange,
    availableCalendarViews,
    cycleView,
    focusDeadlineTask,
  };
}
