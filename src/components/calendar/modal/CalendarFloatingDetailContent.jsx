import CalendarEventEditorRail from "../events/CalendarEventEditorRail.jsx";
import { renderDeadlinesDetail, renderDeadlinesFloatingDetail } from "../views/deadlines/DeadlinesDetailRail.jsx";

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
}) {
  if ((layout.stacked && !mobileSheet) || !floatingDetail?.open) return null;

  const selectedItemPool = activeView.getDayState
    ? [
        ...(selectedDayState.activeItems || []),
        ...(selectedDayState.completedItems || []),
      ]
    : Array.isArray(selectedItems)
      ? selectedItems
      : selectedDayState.items || [];
  const selectedItemResolves = floatingDetail?.itemId && activeView.getItemId
    ? selectedItemPool.some((item) => (
        activeView.matchesItemId?.(item, floatingDetail.itemId)
        || String(activeView.getItemId(item)) === String(floatingDetail.itemId)
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
    return renderDeadlinesDetail({
      selectedDay,
      selectedDateKey,
      viewYear,
      viewMonth,
      items: floatingDetailItems,
      data: viewData,
      computed,
      selectedItemId: floatingDetail.itemId,
      onSelectItem: (itemId) => {
        setSelectedItemId(String(itemId));
      },
      editorState: deadlineEditor,
      onStartEdit: (task) => {
        onOpenFloatingDeadlineEdit?.(task, { dateKey: selectedDateKey });
      },
      onCloseEditor: onCancelFloatingEditor,
      onTaskSaved: (task) => {
        focusDeadlineTask?.(task);
        onFloatingDeadlineSaved?.(task);
      },
      onTaskDeleted: (taskId) => {
        onFloatingDeadlineDeleted?.(taskId);
      },
      onDraftPreviewChange: onDeadlineDraftPreviewChange,
      onEditorDirtyChange: onFloatingEditorDirtyChange,
      ghostPreview,
    });
  }

  if (floatingEditorOpen && floatingDetail.view === "events") {
    return (
      <CalendarEventEditorRail
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
    return renderDeadlinesFloatingDetail({
      selectedDay,
      selectedDateKey,
      viewYear,
      viewMonth,
      items: floatingDetailItems,
      data: viewData,
      computed,
      selectedItemId: floatingDetail.itemId,
      hideEdit,
      onStartEdit: (task) => {
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
    onEditEvent: (item) => {
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
        eventEditor.openEdit?.(item);
      }
    },
    editorState: null,
    onCloseFloatingDetail,
    onStartEdit: (task) => {
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
    onTaskDeleted: (taskId) => {
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
