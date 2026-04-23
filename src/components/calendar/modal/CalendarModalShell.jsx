import { createPortal } from "react-dom";
import { CalendarOverviewRail, CalendarSelectedDayEmptyRail } from "../CalendarRailStates.jsx";
import CalendarEventEditorRail from "../events/CalendarEventEditorRail.jsx";
import AnimatedRailContent from "./AnimatedRailContent.jsx";
import CalendarGrid from "./CalendarGrid.jsx";
import CalendarModalHeader from "./CalendarModalHeader.jsx";
import CalendarWorkspaceSupportBand from "./CalendarWorkspaceSupportBand.jsx";

function getPanelEntryClassName(tier) {
  if (tier === "xl") return "animate-in fade-in duration-150";
  return "animate-in fade-in slide-in-from-top-1 duration-150";
}

function buildContextContent({
  layout,
  view,
  activeView,
  eventEditor,
  deadlineEditor,
  selectedDay,
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
}) {
  if (view === "events" && eventEditor.isEditorOpen) {
    return (
      <CalendarEventEditorRail
        editor={eventEditor}
        expandedDesktop={!layout.stacked}
      />
    );
  }

  if (activeView.renderSidebar) {
    return activeView.renderSidebar({ selectedDay, itemsByDay, viewYear, viewMonth, data: viewData });
  }

  if (showDetail) {
    return activeView.renderDetail?.({
      selectedDay,
      viewYear,
      viewMonth,
      items: selectedItems,
      data: viewData,
      computed,
      selectedItemId: effectiveSelectedItemId,
      supportBandActive: true,
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
    });
  }

  if (showEmptySelection) {
    return (
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
  showGridSkeleton,
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
  const workspaceMode = view === "events" && eventEditor.isEditorOpen
    ? "editor"
    : view === "deadlines" && deadlineEditor?.mode
      ? "editor"
      : showDetail
        ? "detail"
        : showEmptySelection
          ? "empty"
          : "overview";
  const contentKind = workspaceMode === "overview" ? "summary" : workspaceMode;

  const contentKey = view === "events" && eventEditor.isEditorOpen
    ? `editor-${eventEditor.isEditing ? eventEditor.editingEvent?.id || "edit" : "new"}`
    : view === "deadlines" && deadlineEditor?.mode
      ? `deadline-editor-${deadlineEditor.mode}-${deadlineEditor.taskId || deadlineEditor.seedDate || "new"}`
      : showDetail
        ? `detail-${view}-${viewYear}-${viewMonth}-${selectedDay}-${selectedDayState.totalCount}`
        : showEmptySelection
          ? `empty-${view}-${viewYear}-${viewMonth}`
          : `summary-${view}-${viewYear}-${viewMonth}`;

  const contextWidth = workspaceMode === "editor" ? layout.editorWidth : layout.contextWidth;
  const leftColumnGap = layout.stacked ? layout.contentGap : 0;

  const supportProps = {
    activeView,
    view,
    data: viewData,
    computed,
    currentYear,
    currentMonth,
    todayDate,
    viewYear,
    viewMonth,
    itemsByDay,
    selectedDay,
    selectedItemId: effectiveSelectedItemId,
    selectedItems,
    selectedDayState,
    eventEditor,
    deadlineEditor,
    setSelectedDay,
    setSelectedItemId,
    setDeadlineEditor,
  };

  const contextContent = buildContextContent({
    layout,
    view,
    activeView,
    eventEditor,
    deadlineEditor,
    selectedDay,
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
  });

  return createPortal(
    <div
      className="animate-in fade-in duration-150"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 49,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: layout.viewportMargin,
        background: [
          "radial-gradient(circle at top, rgba(203,166,218,0.10), transparent 28%)",
          "radial-gradient(circle at 100% 0%, rgba(137,180,250,0.07), transparent 22%)",
          "rgba(4,6,10,0.72)",
        ].join(", "),
      }}
    >
      <div
        ref={panelRef}
        data-testid="calendar-modal-panel"
        className={`isolate flex flex-col ${getPanelEntryClassName(layout.tier)}`}
        style={{
          position: "relative",
          width: panelWidth,
          height: layout.shellHeight,
          overflow: "hidden",
          backgroundColor: "#16161e",
          backgroundImage: [
            "radial-gradient(circle at top left, rgba(203,166,218,0.14), transparent 30%)",
            "radial-gradient(circle at 86% 8%, rgba(137,180,250,0.08), transparent 24%)",
            "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01) 18%, rgba(255,255,255,0.01) 82%, rgba(255,255,255,0.025))",
          ].join(", "),
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage: "radial-gradient(rgba(255,255,255,0.035) 0.8px, transparent 0.8px)",
            backgroundSize: "22px 22px",
            opacity: 0.18,
            maskImage: "linear-gradient(180deg, rgba(0,0,0,0.34), rgba(0,0,0,0) 38%)",
          }}
        />
        <div
          ref={scrollRef}
          className="overflow-y-auto overscroll-contain flex-1"
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            gap: layout.contentGap,
            minHeight: 0,
            height: "100%",
            padding: layout.shellPadding,
          }}
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
              gridTemplateColumns: layout.stacked ? "minmax(0, 1fr)" : `minmax(0, 1fr) ${contextWidth}px`,
              gap: layout.contentGap,
              alignItems: "stretch",
              flex: 1,
              minHeight: 0,
              overflow: layout.stacked ? "visible" : "hidden",
            }}
          >
            <div
              style={{
                minWidth: 0,
                minHeight: 0,
                display: "grid",
                gridTemplateRows: layout.stacked
                  ? "auto auto"
                  : "minmax(0, 1fr) auto",
                gap: leftColumnGap,
                overflow: layout.stacked ? "visible" : "hidden",
              }}
            >
              <div style={{ minWidth: 0, minHeight: 0, display: "flex", flex: 1 }}>
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
                  selectedItemId={effectiveSelectedItemId}
                  viewData={viewData}
                  activeView={activeView}
                  layout={layout}
                  suppressOutsideClick={suppressOutsideClick}
                  showGridSkeleton={showGridSkeleton}
                  buildFallbackDayState={buildFallbackDayState}
                  closeEventEditor={closeEventEditor}
                  setSelectedDay={setSelectedDay}
                  setSelectedItemId={setSelectedItemId}
                  setDeadlineEditor={setDeadlineEditor}
                />
              </div>

              <CalendarWorkspaceSupportBand
                layout={layout}
                mode={workspaceMode}
                activeView={activeView}
                supportProps={supportProps}
              />
            </div>

            <aside
              data-testid="calendar-modal-rail"
              data-context-mode={workspaceMode}
              style={{
                position: layout.stacked ? "relative" : layout.stickyRail ? "sticky" : "relative",
                top: 0,
                minHeight: 0,
                height: layout.stacked ? "auto" : "100%",
                background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 16,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              <AnimatedRailContent contentKind={contentKind} contentKey={contentKey}>
                {workspaceMode === "editor" ? (
                  <div
                    data-testid="calendar-modal-editor-expanded"
                    style={{
                      flex: 1,
                      minHeight: 0,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    {contextContent}
                  </div>
                ) : contextContent}
              </AnimatedRailContent>
            </aside>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
