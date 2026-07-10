import { memo, useCallback, useEffect } from "react";
import CalendarQuickActionLayer from "../events/CalendarQuickActionLayer.jsx";
import DeadlineQuickActionLayer from "../views/deadlines/DeadlineQuickActionLayer.jsx";
import CalendarModalContextRail from "./CalendarModalContextRail.jsx";
import CalendarFloatingDetailContentBase from "./CalendarFloatingDetailContent.jsx";
import CalendarFloatingDetailPanel from "./CalendarFloatingDetailPanel.jsx";
import CalendarGridWeekHeader from "./CalendarGridWeekHeader.jsx";
import CalendarScrollContainer from "./CalendarScrollContainer.jsx";
import buildContextContent from "./buildContextContent.jsx";
import CalendarModalAgendaRailContentBase from "./CalendarModalAgendaRailContent.jsx";
import CalendarModalHeader from "./CalendarModalHeader.jsx";
import CalendarModalTexture from "./CalendarModalTexture.jsx";
import CalendarSearchRail from "./CalendarSearchRail.jsx";
import { getCalendarSearchLayoutMode } from "../calendarLayout.js";

// Memo boundaries for the heavier rail children (fe-global::shell-props-inline-
// callbacks-churn). The shell re-renders on every calendar interaction; with the
// inline callbacks below hoisted to useCallback and the data props stabilized
// upstream, these wrappers let the agenda/floating rails skip re-rendering when
// their inputs are unchanged. Wrapping at the import site avoids reshaping the
// underlying component modules.
const CalendarModalAgendaRailContent = memo(CalendarModalAgendaRailContentBase);
const CalendarFloatingDetailContent = memo(CalendarFloatingDetailContentBase);

export default function CalendarModalShell({
  refs,
  viewState,
  viewModel,
  data,
  selection,
  editors,
  quickActions,
  agenda,
  floating,
  handlers,
  search,
  availableCalendarViews,
}) {
  const { panelRef, scrollRef, contextRailRef, agendaRailRef } = refs;
  const {
    view,
    viewYear,
    viewMonth,
    currentYear,
    currentMonth,
    todayDate,
    suppressFocusRing = false,
  } = viewState;
  const {
    panelWidth,
    layout,
    monthName,
    monthYear,
    canGoPrev,
    computed,
    itemsByDay,
    itemsByDate,
    cellMetaByDate,
    showGridSkeleton,
    buildFallbackDayState,
    showDetail,
    showEmptySelection,
    effectiveSelectedItemId,
    selectedDayState,
    selectedItems,
    ghostPreview,
    floatingDetailLabel,
  } = viewModel;
  const {
    activeView,
    HeaderExtras,
    viewData,
    weatherData,
    isMonthCached,
    getMonthEvents,
    getMonthDeadlines,
    eventsRange = null,
    deadlinesRange = null,
    dataRevision = 0,
    getMonthBills,
    billsRange = null,
    billsDataRevision = 0,
  } = data;
  const { selectedDay, selectedDateKey, setSelectedDay, setSelectedDateKey, setSelectedItemId } = selection;
  const { eventEditor, deadlineEditor, setDeadlineEditor, closeEventEditor, onDeadlineDraftPreviewChange } = editors;
  const { eventQuickActions, deadlineQuickActions } = quickActions;
  const {
    agendaScrollCommand,
    agendaEntryTargetDateKey,
    onAgendaPassiveDateChange,
    onAgendaDateAction,
    onAgendaEventAction,
    miniCalendarActions,
    onAgendaDirtyBlocked,
    onGridDateAction,
    onGridEventAction,
  } = agenda;
  const {
    floatingDetail,
    onOpenFloatingDetail,
    onCloseFloatingDetail,
    onFloatingDetailDragged,
    onOpenFloatingEventCreate,
    onOpenFloatingEventEdit,
    onOpenFloatingDeadlineCreate,
    onOpenFloatingDeadlineEdit,
    onCancelFloatingEditor,
    onFloatingEditorDirtyChange,
    onFloatingEditorSaveRequest,
    onShakeFloatingEditor,
    onFloatingDeadlineSaved,
    onFloatingDeadlineDeleted,
  } = floating;
  const {
    navigateMonth,
    jumpToMonth,
    onViewChange,
    focusDeadlineTask,
    onDisplayMonthChange,
    onLabelMonthChange,
    onFetchSettle,
  } = handlers;
  const floatingEditorOpen = !layout.stacked
    && !!floatingDetail?.open
    && (floatingDetail.mode === "edit" || floatingDetail.mode === "create");
  const floatingDeadlineDetail = floatingDetail?.detailKind === "deadline";
  const floatingDetailGridDateKey = floatingEditorOpen
    ? floatingDetail?.dateKey || null
    : ghostPreview?.targetDate || floatingDetail?.dateKey || null;
  const railEventEditor = floatingEditorOpen && view === "events" && !floatingDeadlineDetail
    ? { ...eventEditor, isEditorOpen: false, mode: "detail" }
    : eventEditor;
  const railDeadlineEditor = floatingEditorOpen && floatingDeadlineDetail ? null : deadlineEditor;
  const useAgendaRail = !layout.stacked && (view === "events" || view === "bills");
  const searchOpen = !!search?.open;
  const searchLayoutMode = getCalendarSearchLayoutMode(layout, searchOpen);
  const showSearchRail = searchOpen;
  const showContextRail = !searchOpen || searchLayoutMode === "three-rail";
  const workspaceMode = useAgendaRail ? "agenda"
    : view === "events" && railEventEditor.isEditorOpen ? "editor"
      : view === "events" && railDeadlineEditor?.mode ? "editor"
        : showDetail ? "detail"
          : showEmptySelection ? "empty" : "overview";
  const contentKind = workspaceMode === "overview" ? "summary" : workspaceMode;

  useEffect(() => {
    if (!floatingEditorOpen || floatingDeadlineDetail || floatingDetail?.view !== "events") return;
    onFloatingEditorDirtyChange?.(!!eventEditor.isDirty);
  }, [eventEditor.isDirty, floatingDeadlineDetail, floatingDetail?.view, floatingEditorOpen, onFloatingEditorDirtyChange]);

  const contentKey = useAgendaRail
    ? `agenda-${view}`
    : view === "events" && railEventEditor.isEditorOpen
    ? `editor-${eventEditor.isEditing ? eventEditor.editingEvent?.id || "edit" : "new"}`
    : view === "events" && railDeadlineEditor?.mode
      ? `deadline-editor-${deadlineEditor.mode}-${deadlineEditor.taskId || deadlineEditor.seedDate || "new"}`
      : showDetail
        ? `detail-${view}-${viewYear}-${viewMonth}-${selectedDay}-${selectedDayState.totalCount}`
        : showEmptySelection
          ? `empty-${view}-${viewYear}-${viewMonth}`
          : `summary-${view}-${viewYear}-${viewMonth}`;

  const contextWidth = workspaceMode === "editor" ? layout.editorWidth : layout.contextWidth;
  // Hoist the rail-facing callbacks to useCallback so the memoized agenda /
  // floating rails (and any memoized header descendants) are not re-rendered by
  // a fresh inline-arrow identity on every shell render.
  const handleOpenEventCreate = useCallback(() => {
    if (!layout.stacked) {
      onOpenFloatingEventCreate?.(selectedDateKey);
    } else {
      onCloseFloatingDetail?.();
      eventEditor.openCreate?.();
    }
  }, [eventEditor, layout.stacked, onCloseFloatingDetail, onOpenFloatingEventCreate, selectedDateKey]);
  const handleCreateTask = useCallback((seedDate) => {
    if (!layout.stacked) {
      onOpenFloatingDeadlineCreate?.(seedDate || selectedDateKey || null);
    } else {
      onCloseFloatingDetail?.();
      setDeadlineEditor({
        mode: "create",
        seedDate: seedDate || null,
      });
      onDeadlineDraftPreviewChange?.(null);
    }
  }, [layout.stacked, onCloseFloatingDetail, onDeadlineDraftPreviewChange, onOpenFloatingDeadlineCreate, selectedDateKey, setDeadlineEditor]);
  const handleFilteredSelectedDeadlineHidden = useCallback(() => {
    setSelectedItemId(null);
    onCloseFloatingDetail?.();
  }, [onCloseFloatingDetail, setSelectedItemId]);
  const headerEventEditor = view === "events"
    ? {
        ...eventEditor,
        openCreate: handleOpenEventCreate,
      }
    : eventEditor;
  const onCreateTask = handleCreateTask;

  const contextContent = useAgendaRail ? (
    <CalendarModalAgendaRailContent
      ref={agendaRailRef}
      view={view}
      viewYear={viewYear}
      viewMonth={viewMonth}
      viewData={viewData}
      weatherData={weatherData}
      computed={computed}
      selectedDateKey={selectedDateKey}
      selectedItemId={effectiveSelectedItemId}
      scrollCommand={agendaScrollCommand}
      entryScrollTargetDateKey={agendaEntryTargetDateKey}
      currentYear={currentYear}
      currentMonth={currentMonth}
      todayDate={todayDate}
      monthNavigation={{ canGoPrev, navigateMonth }}
      eventQuickActions={eventQuickActions}
      deadlineQuickActions={deadlineQuickActions}
      floatingEditorDirty={floatingEditorOpen && !!floatingDetail?.dirty}
      onDirtyBlocked={onAgendaDirtyBlocked}
      onPassiveDateChange={onAgendaPassiveDateChange}
      onDateAction={onAgendaDateAction}
      miniCalendarActions={miniCalendarActions}
      onEventAction={onAgendaEventAction}
      getMonthEvents={getMonthEvents}
      eventsRange={eventsRange}
      deadlinesRange={deadlinesRange}
      dataRevision={dataRevision}
      getMonthBills={getMonthBills}
      billsRange={billsRange}
      billsDataRevision={billsDataRevision}
      onFilteredSelectedDeadlineHidden={handleFilteredSelectedDeadlineHidden}
    />
  ) : buildContextContent({
    layout,
    view,
    activeView,
    eventEditor: railEventEditor,
    deadlineEditor: railDeadlineEditor,
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
    onCreateEvent: handleOpenEventCreate,
    onCreateTask,
    ghostPreview,
    onDeadlineDraftPreviewChange,
    onCloseFloatingDetail,
  });

  const floatingDetailContent = (
    <CalendarFloatingDetailContent
      activeView={activeView}
      computed={computed}
      deadlineEditor={deadlineEditor}
      effectiveSelectedItemId={effectiveSelectedItemId}
      eventEditor={eventEditor}
      floatingDeadlineDetail={floatingDeadlineDetail}
      floatingDetail={floatingDetail}
      floatingEditorOpen={floatingEditorOpen}
      ghostPreview={ghostPreview}
      layout={layout}
      onCancelFloatingEditor={onCancelFloatingEditor}
      onCloseFloatingDetail={onCloseFloatingDetail}
      onDeadlineDraftPreviewChange={onDeadlineDraftPreviewChange}
      onFloatingDeadlineDeleted={onFloatingDeadlineDeleted}
      onFloatingDeadlineSaved={onFloatingDeadlineSaved}
      onFloatingEditorDirtyChange={onFloatingEditorDirtyChange}
      onFloatingEditorSaveRequest={onFloatingEditorSaveRequest}
      onOpenFloatingDeadlineEdit={onOpenFloatingDeadlineEdit}
      onOpenFloatingEventEdit={onOpenFloatingEventEdit}
      selectedDateKey={selectedDateKey}
      selectedDay={selectedDay}
      selectedDayState={selectedDayState}
      selectedItems={selectedItems}
      setDeadlineEditor={setDeadlineEditor}
      setSelectedItemId={setSelectedItemId}
      view={view}
      viewData={viewData}
      viewMonth={viewMonth}
      viewYear={viewYear}
      focusDeadlineTask={focusDeadlineTask}
    />
  );

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        isolation: "isolate",
        contain: "layout paint style",
        overflow: "hidden",
      }}
    >
      <div
        ref={panelRef}
        data-testid="calendar-modal-panel"
        data-calendar-suppress-focus-ring={suppressFocusRing ? "true" : undefined}
        className="isolate flex flex-col"
        aria-labelledby="calendar-modal-title"
        tabIndex={-1}
        style={{
          position: "relative",
          zIndex: 1,
          // In-flow tab fill: flex:1 + minHeight:0 size the panel to the column's
          // height; width/maxWidth cap it and margin:0 auto centers it horizontally.
          flex: 1,
          minHeight: 0,
          width: panelWidth,
          maxWidth: layout.panelMaxWidth || undefined,
          margin: "0 auto",
          maxHeight: layout.shellMaxHeight || undefined,
          overflow: "hidden",
          backgroundColor: "var(--sp-panel)",
          backgroundImage: [
            "radial-gradient(circle at top left, color-mix(in srgb, var(--sp-accent) 14%, transparent), transparent 30%)",
            "radial-gradient(circle at 86% 8%, color-mix(in srgb, var(--sp-blue) 8%, transparent), transparent 24%)",
            "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01) 18%, rgba(255,255,255,0.01) 82%, rgba(255,255,255,0.025))",
          ].join(", "),
          border: "1px solid rgba(255,255,255,0.06)",
          outline: "none",
          contain: "layout paint",
          backfaceVisibility: "hidden",
          transform: "translate3d(0, 0, 0)",
        }}
      >
        <CalendarModalTexture />
        <div
          ref={scrollRef}
          className="flex-1"
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
            jumpToMonth={jumpToMonth}
            currentYear={currentYear}
            currentMonth={currentMonth}
            onViewChange={onViewChange}
            availableCalendarViews={availableCalendarViews}
            HeaderExtras={HeaderExtras}
            viewData={viewData}
            computed={computed}
            eventEditor={headerEventEditor}
            selectedDay={selectedDay}
            selectedDateKey={selectedDateKey}
            viewYear={viewYear}
            viewMonth={viewMonth}
            setDeadlineEditor={(next) => {
              if (!layout.stacked && next?.mode === "create") {
                onOpenFloatingDeadlineCreate?.(next.seedDate || selectedDateKey || null);
              } else {
                onCloseFloatingDetail?.();
                setDeadlineEditor(next);
              }
            }}
            viewLabel={activeView.label}
            search={search}
          />

          <div
            data-testid="calendar-modal-body"
            data-search-layout={searchLayoutMode}
            style={{
              display: "grid",
              gridTemplateColumns: layout.stacked
                ? "minmax(0, 1fr)"
                : searchOpen && searchLayoutMode === "three-rail"
                  ? `${layout.searchWidth}px minmax(0, 1fr) ${contextWidth}px`
                  : searchOpen
                    ? `${layout.searchWidth}px minmax(0, 1fr)`
                    : `minmax(0, 1fr) ${contextWidth}px`,
              gridTemplateRows: layout.stacked && searchOpen ? "auto minmax(0, 1fr)" : undefined,
              gap: layout.contentGap,
              alignItems: "stretch",
              flex: 1,
              minHeight: 0,
              overflow: layout.stacked ? "visible" : "hidden",
            }}
          >
            {showSearchRail ? (
              <CalendarSearchRail search={search} layoutMode={searchLayoutMode} weatherData={weatherData} />
            ) : null}
            <div
              style={{
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <CalendarGridWeekHeader gap={layout.weekHeaderGap} />
              <CalendarScrollContainer
                view={view}
                activeView={activeView}
                layout={layout}
                currentYear={currentYear}
                currentMonth={currentMonth}
                todayDate={todayDate}
                viewYear={viewYear}
                viewMonth={viewMonth}
                onDisplayMonthChange={onDisplayMonthChange}
                onLabelMonthChange={onLabelMonthChange}
                onFetchSettle={onFetchSettle}
                viewData={viewData}
                itemsByDay={itemsByDay}
                itemsByDate={itemsByDate}
                cellMetaByDate={cellMetaByDate}
                selectedDay={selectedDay}
                selectedDateKey={selectedDateKey}
                selectedItemId={effectiveSelectedItemId}
                showGridSkeleton={showGridSkeleton}
                isMonthCached={isMonthCached}
                getMonthEvents={getMonthEvents}
                getMonthDeadlines={getMonthDeadlines}
                dataRevision={dataRevision}
                buildFallbackDayState={buildFallbackDayState}
                closeEventEditor={closeEventEditor}
                setSelectedDay={setSelectedDay}
                setSelectedDateKey={setSelectedDateKey}
                setSelectedItemId={setSelectedItemId}
                eventQuickActions={eventQuickActions}
                deadlineQuickActions={deadlineQuickActions}
                ghostPreview={ghostPreview}
                onOpenFloatingDetail={onOpenFloatingDetail}
                onCloseFloatingDetail={onCloseFloatingDetail}
                floatingDetailOpen={!!floatingDetail?.open && !!floatingDetailContent}
                floatingDetailItemId={floatingDetail?.itemId || null}
                floatingDetailMode={floatingDetail?.mode || null}
                floatingDetailDateKey={floatingDetailGridDateKey}
                floatingEditorDirty={floatingEditorOpen && !!floatingDetail?.dirty}
                onCancelFloatingEditor={onCancelFloatingEditor}
                onShakeFloatingEditor={onShakeFloatingEditor}
                onDirectDateAction={onGridDateAction}
                onDirectItemAction={onGridEventAction}
              />
              {view === "events" ? (
                <>
                  <CalendarQuickActionLayer quickActions={eventQuickActions} />
                  <DeadlineQuickActionLayer quickActions={deadlineQuickActions} />
                </>
              ) : null}
            </div>

            {showContextRail ? (
              <CalendarModalContextRail
                contextRailRef={contextRailRef}
                layout={layout}
                workspaceMode={workspaceMode}
                contentKind={contentKind}
                contentKey={contentKey}
                contextContent={contextContent}
              />
            ) : null}
          </div>
          <CalendarFloatingDetailPanel
            detail={floatingDetail}
            label={floatingDetailLabel}
            calendarPanelRef={panelRef}
            railRef={contextRailRef}
            suppressFocusRing={suppressFocusRing}
            onClose={floatingEditorOpen ? onCancelFloatingEditor : onCloseFloatingDetail}
            onUserDraggedChange={onFloatingDetailDragged}
          >
            {floatingDetailContent}
          </CalendarFloatingDetailPanel>
        </div>
      </div>
    </div>
  );
}
