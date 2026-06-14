import { useEffect } from "react";
import { createPortal } from "react-dom";
import CalendarQuickActionLayer from "../events/CalendarQuickActionLayer.jsx";
import DeadlineQuickActionLayer from "../views/deadlines/DeadlineQuickActionLayer.jsx";
import CalendarModalContextRail from "./CalendarModalContextRail.jsx";
import CalendarFloatingDetailContent from "./CalendarFloatingDetailContent.jsx";
import CalendarFloatingDetailPanel from "./CalendarFloatingDetailPanel.jsx";
import CalendarGridWeekHeader from "./CalendarGridWeekHeader.jsx";
import CalendarScrollContainer from "./CalendarScrollContainer.jsx";
import buildContextContent from "./buildContextContent.jsx";
import CalendarModalAgendaRailContent from "./CalendarModalAgendaRailContent.jsx";
import CalendarModalBackdrop from "./CalendarModalBackdrop.jsx";
import CalendarModalHeader from "./CalendarModalHeader.jsx";
import CalendarModalTexture from "./CalendarModalTexture.jsx";
import CalendarSearchRail from "./CalendarSearchRail.jsx";
import { getCalendarSearchLayoutMode } from "../calendarLayout.js";

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
    onClose,
    suppressOutsideClick,
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
  const headerEventEditor = view === "events"
    ? {
        ...eventEditor,
        openCreate: () => {
          if (!layout.stacked) {
            onOpenFloatingEventCreate?.(selectedDateKey);
          } else {
            onCloseFloatingDetail?.();
            eventEditor.openCreate?.();
          }
        },
      }
    : eventEditor;
  const onCreateTask = (seedDate) => {
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
  };

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
      onFilteredSelectedDeadlineHidden={() => {
        setSelectedItemId(null);
        onCloseFloatingDetail?.();
      }}
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
    onCreateEvent: () => {
      if (!layout.stacked) {
        onOpenFloatingEventCreate?.(selectedDateKey);
      } else {
        onCloseFloatingDetail?.();
        eventEditor.openCreate?.();
      }
    },
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

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 49,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: layout.viewportMargin,
        isolation: "isolate",
        contain: "layout paint style",
        overflow: "hidden",
      }}
    >
      <CalendarModalBackdrop />
      <div
        ref={panelRef}
        data-testid="calendar-modal-panel"
        data-calendar-suppress-focus-ring={suppressFocusRing ? "true" : undefined}
        className="isolate flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-modal-title"
        tabIndex={-1}
        style={{
          position: "relative",
          zIndex: 1,
          width: panelWidth,
          maxWidth: layout.panelMaxWidth || undefined,
          height: layout.shellHeight,
          maxHeight: layout.shellMaxHeight || undefined,
          overflow: "hidden",
          backgroundColor: "#16161e",
          backgroundImage: [
            "radial-gradient(circle at top left, rgba(203,166,218,0.14), transparent 30%)",
            "radial-gradient(circle at 86% 8%, rgba(137,180,250,0.08), transparent 24%)",
            "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01) 18%, rgba(255,255,255,0.01) 82%, rgba(255,255,255,0.025))",
          ].join(", "),
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.06)",
          outline: "none",
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
          contain: "layout paint",
          backfaceVisibility: "hidden",
          transform: "translate3d(0, 0, 0)",
          animation: layout.tier === "xl"
            ? "calendarPanelSettle 120ms cubic-bezier(0.16, 1, 0.3, 1)"
            : "calendarPanelEnter 140ms cubic-bezier(0.16, 1, 0.3, 1)",
          willChange: "transform",
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
            HeaderExtras={HeaderExtras}
            viewData={viewData}
            computed={computed}
            suppressOutsideClick={suppressOutsideClick}
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
            onClose={onClose}
            viewLabel={activeView.label}
            search={search}
          />

          <CalendarGridWeekHeader gap={layout.weekHeaderGap} />

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
                suppressOutsideClick={suppressOutsideClick}
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
            suppressOutsideClick={suppressOutsideClick}
            suppressFocusRing={suppressFocusRing}
            onClose={floatingEditorOpen ? onCancelFloatingEditor : onCloseFloatingDetail}
            onUserDraggedChange={onFloatingDetailDragged}
          >
            {floatingDetailContent}
          </CalendarFloatingDetailPanel>
        </div>
      </div>
    </div>,
    document.body,
  );
}
