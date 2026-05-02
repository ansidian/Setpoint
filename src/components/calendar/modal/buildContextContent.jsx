import { CalendarOverviewRail, CalendarSelectedDayEmptyRail } from "../CalendarRailStates.jsx";
import CalendarEventEditorRail from "../events/CalendarEventEditorRail.jsx";

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
}) {
  if (view === "events" && eventEditor.isEditorOpen) {
    return (
      <CalendarEventEditorRail
        editor={eventEditor}
        expandedDesktop={!layout.stacked}
        ghostPreview={ghostPreview}
      />
    );
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
      onSelectItem: (itemId) => {
        setSelectedItemId(String(itemId));
        setDeadlineEditor(null);
      },
      onEditEvent: (item) => {
        onCloseFloatingDetail?.();
        eventEditor.openEdit?.(item);
      },
      editorState: deadlineEditor,
      onStartEdit: (task) => {
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
      onTaskDeleted: (taskId) => {
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
