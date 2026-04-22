import { createPortal } from "react-dom";
import { CalendarOverviewRail, CalendarSelectedDayEmptyRail } from "../CalendarRailStates.jsx";
import CalendarEventEditorRail from "../events/CalendarEventEditorRail.jsx";
import AnimatedRailContent from "./AnimatedRailContent.jsx";
import CalendarGrid from "./CalendarGrid.jsx";
import CalendarModalHeader from "./CalendarModalHeader.jsx";

export default function CalendarModalShell({
  panelRef,
  scrollRef,
  panelWidth,
  layout,
  view,
  monthName,
  monthYear,
  canGoPrev,
  navigateMonth,
  onViewChange,
  HeaderExtras,
  viewData,
  computed,
  suppressOutsideClick,
  eventEditor,
  selectedDay,
  viewYear,
  viewMonth,
  setDeadlineEditor,
  onClose,
  activeView,
  currentYear,
  currentMonth,
  todayDate,
  firstDay,
  daysInMonth,
  trailingEmpty,
  itemsByDay,
  showEventsLoadingState,
  buildFallbackDayState,
  closeEventEditor,
  setSelectedDay,
  setSelectedItemId,
  showDetail,
  showEmptySelection,
  effectiveSelectedItemId,
  selectedDayState,
  selectedItems,
  deadlineEditor,
  focusDeadlineTask,
}) {
  const railHeight = 6 * layout.cellHeight + 5 * layout.gridGap + (layout.railHeightOffset || 30);
  const contentKind = view === "events" && eventEditor.isEditorOpen
    ? "editor"
    : view === "deadlines" && deadlineEditor?.mode
      ? "editor"
      : showDetail
        ? "detail"
        : showEmptySelection
          ? "empty"
          : "summary";

  const contentKey = view === "events" && eventEditor.isEditorOpen
    ? `editor-${eventEditor.isEditing ? eventEditor.editingEvent?.id || "edit" : "new"}`
    : view === "deadlines" && deadlineEditor?.mode
      ? `deadline-editor-${deadlineEditor.mode}-${deadlineEditor.taskId || deadlineEditor.seedDate || "new"}`
      : showDetail
        ? `detail-${view}-${viewYear}-${viewMonth}-${selectedDay}-${selectedDayState.totalCount}`
        : showEmptySelection
          ? `empty-${view}-${viewYear}-${viewMonth}`
          : `summary-${view}-${viewYear}-${viewMonth}`;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 49,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
    >
      <div
        ref={panelRef}
        data-testid="calendar-modal-panel"
        className="isolate flex flex-col animate-in fade-in zoom-in-95 duration-200"
        style={{
          width: panelWidth,
          maxWidth: `${layout.shellMaxWidth}px`,
          maxHeight: layout.shellMaxHeight,
          background: "radial-gradient(ellipse at top left, #1a1a2a, #0d0d15 70%)",
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <div
          ref={scrollRef}
          className="overflow-y-auto overscroll-contain flex-1"
          style={{ padding: layout.shellPadding }}
        >
          <CalendarModalHeader
            view={view}
            monthName={monthName}
            monthYear={monthYear}
            layout={layout}
            canGoPrev={canGoPrev}
            navigateMonth={navigateMonth}
            onViewChange={onViewChange}
            HeaderExtras={HeaderExtras}
            viewData={viewData}
            computed={computed}
            suppressOutsideClick={suppressOutsideClick}
            eventEditor={eventEditor}
            selectedDay={selectedDay}
            viewYear={viewYear}
            viewMonth={viewMonth}
            setDeadlineEditor={setDeadlineEditor}
            onClose={onClose}
            viewLabel={activeView.label}
          />

          <div
            data-testid="calendar-modal-body"
            style={{
              display: "grid",
              gridTemplateColumns: layout.stacked ? "minmax(0, 1fr)" : `minmax(0, 1fr) ${layout.railWidth}px`,
              gap: layout.contentGap,
              alignItems: "start",
            }}
          >
            <CalendarGrid
              view={view}
              viewYear={viewYear}
              viewMonth={viewMonth}
              currentYear={currentYear}
              currentMonth={currentMonth}
              todayDate={todayDate}
              firstDay={firstDay}
              daysInMonth={daysInMonth}
              trailingEmpty={trailingEmpty}
              itemsByDay={itemsByDay}
              selectedDay={selectedDay}
              viewData={viewData}
              activeView={activeView}
              layout={layout}
              showEventsLoadingState={showEventsLoadingState}
              buildFallbackDayState={buildFallbackDayState}
              closeEventEditor={closeEventEditor}
              setSelectedDay={setSelectedDay}
              setSelectedItemId={setSelectedItemId}
              setDeadlineEditor={setDeadlineEditor}
            />

            <aside
              data-testid="calendar-modal-rail"
              style={{
                position: layout.stickyRail ? "sticky" : "relative",
                top: 0,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 12,
                height: railHeight,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <AnimatedRailContent contentKind={contentKind} contentKey={contentKey}>
                {view === "events" && eventEditor.isEditorOpen ? (
                  <CalendarEventEditorRail editor={eventEditor} />
                ) : activeView.renderSidebar ? (
                  activeView.renderSidebar({ selectedDay, itemsByDay, viewYear, viewMonth, data: viewData })
                ) : showDetail ? (
                  activeView.renderDetail?.({
                    selectedDay,
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
                    onEditEvent: eventEditor.openEdit,
                    editorState: deadlineEditor,
                    onStartEdit: (task) => {
                      setSelectedItemId(String(task.id));
                      setDeadlineEditor({ mode: "edit", taskId: String(task.id) });
                    },
                    onCloseEditor: () => setDeadlineEditor(null),
                    onTaskSaved: focusDeadlineTask,
                    onTaskDeleted: (taskId) => {
                      setDeadlineEditor(null);
                      if (String(effectiveSelectedItemId) === String(taskId)) {
                        setSelectedItemId(null);
                      }
                    },
                  })
                ) : showEmptySelection ? (
                  <CalendarSelectedDayEmptyRail
                    view={view}
                    selectedDay={selectedDay}
                    viewYear={viewYear}
                    viewMonth={viewMonth}
                    currentYear={currentYear}
                    currentMonth={currentMonth}
                    todayDate={todayDate}
                    itemsByDay={itemsByDay}
                    computed={computed}
                    data={viewData}
                    activeView={activeView}
                    setSelectedDay={setSelectedDay}
                    setSelectedItemId={setSelectedItemId}
                    setDeadlineEditor={setDeadlineEditor}
                  />
                ) : (
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
                )}
              </AnimatedRailContent>
            </aside>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
