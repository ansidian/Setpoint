import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import CalendarEventEditorRail from "../events/CalendarEventEditorRail.jsx";
import CalendarQuickActionLayer from "../events/CalendarQuickActionLayer.jsx";
import DeadlineQuickActionLayer from "../views/deadlines/DeadlineQuickActionLayer.jsx";
import AnimatedRailContent from "./AnimatedRailContent.jsx";
import CalendarFloatingDetailPanel from "./CalendarFloatingDetailPanel.jsx";
import CalendarGrid from "./CalendarGrid.jsx";
import buildContextContent from "./buildContextContent.jsx";
import CalendarModalBackdrop from "./CalendarModalBackdrop.jsx";
import CalendarModalHeader from "./CalendarModalHeader.jsx";
import CalendarModalTexture from "./CalendarModalTexture.jsx";
import BillsAgendaRail from "../views/bills/BillsAgendaRail.jsx";
import DeadlinesAgendaRail from "../views/deadlines/DeadlinesAgendaRail.jsx";
import EventsAgendaRail from "../views/events/EventsAgendaRail.jsx";

export default function CalendarModalShell({
  panelRef,
  scrollRef,
  contextRailRef,
  panelWidth,
  layout,
  view,
  monthName,
  monthYear,
  canGoPrev,
  navigateMonth,
  monthMotionDirection,
  onViewChange,
  HeaderExtras,
  viewData,
  weatherData,
  computed,
  suppressOutsideClick,
  eventEditor,
  selectedDay,
  selectedDateKey,
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
  itemsByDate,
  showGridSkeleton,
  buildFallbackDayState,
  closeEventEditor,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  eventQuickActions,
  deadlineQuickActions,
  agendaRailRef,
  agendaScrollCommand,
  onAgendaPassiveDateChange,
  onAgendaDateAction,
  onAgendaEventAction,
  onAgendaDirtyBlocked,
  onGridDateAction,
  onGridEventAction,
  showDetail,
  showEmptySelection,
  effectiveSelectedItemId,
  selectedDayState,
  selectedItems,
  deadlineEditor,
  focusDeadlineTask,
  ghostPreview,
  onDeadlineDraftPreviewChange,
  floatingDetail,
  floatingDetailLabel,
  onOpenFloatingDetail,
  onCloseFloatingDetail,
  onParkFloatingDetail,
  onFloatingDetailDragged,
  onReanchorFloatingDetail,
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
  suppressFocusRing = false,
}) {
  const monthWheelStateRef = useRef({ lastNavigateAt: -Infinity, ignoreUntil: -Infinity, lastWheelAt: -Infinity, lastWheelDelta: 0 });
  const floatingEditorOpen = !layout.stacked
    && !!floatingDetail?.open
    && (floatingDetail.mode === "edit" || floatingDetail.mode === "create");
  const railEventEditor = floatingEditorOpen && view === "events"
    ? { ...eventEditor, isEditorOpen: false, mode: "detail" }
    : eventEditor;
  const railDeadlineEditor = floatingEditorOpen && view === "deadlines" ? null : deadlineEditor;
  const useAgendaRail = !layout.stacked && (view === "events" || view === "bills" || view === "deadlines");
  const workspaceMode = useAgendaRail ? "agenda"
    : view === "events" && railEventEditor.isEditorOpen ? "editor"
      : view === "deadlines" && railDeadlineEditor?.mode ? "editor"
        : showDetail ? "detail"
          : showEmptySelection ? "empty" : "overview";
  const contentKind = workspaceMode === "overview" ? "summary" : workspaceMode;

  useEffect(() => {
    if (!floatingEditorOpen || floatingDetail?.view !== "events") return;
    onFloatingEditorDirtyChange?.(!!eventEditor.isDirty);
  }, [eventEditor.isDirty, floatingDetail?.view, floatingEditorOpen, onFloatingEditorDirtyChange]);

  const contentKey = useAgendaRail
    ? `agenda-${viewYear}-${viewMonth}`
    : view === "events" && railEventEditor.isEditorOpen
    ? `editor-${eventEditor.isEditing ? eventEditor.editingEvent?.id || "edit" : "new"}`
    : view === "deadlines" && railDeadlineEditor?.mode
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
    view === "events" ? (
      <EventsAgendaRail
        ref={agendaRailRef}
        viewYear={viewYear}
        viewMonth={viewMonth}
        events={viewData?.events || []}
        weatherData={weatherData}
        isLoading={!!viewData?.isLoading}
        selectedDateKey={selectedDateKey}
        selectedItemId={effectiveSelectedItemId}
        scrollCommand={agendaScrollCommand}
        currentYear={currentYear}
        currentMonth={currentMonth}
        todayDate={todayDate}
        eventQuickActions={eventQuickActions}
        floatingEditorDirty={floatingEditorOpen && !!floatingDetail?.dirty}
        onDirtyBlocked={onAgendaDirtyBlocked}
        onPassiveDateChange={onAgendaPassiveDateChange}
        onDateAction={onAgendaDateAction}
        onEventAction={onAgendaEventAction}
      />
    ) : view === "bills" ? (
      <BillsAgendaRail
        ref={agendaRailRef}
        viewYear={viewYear}
        viewMonth={viewMonth}
        computed={computed}
        selectedDateKey={selectedDateKey}
        selectedItemId={effectiveSelectedItemId}
        scrollCommand={agendaScrollCommand}
        currentYear={currentYear}
        currentMonth={currentMonth}
        todayDate={todayDate}
        onPassiveDateChange={onAgendaPassiveDateChange}
        onDateAction={onAgendaDateAction}
        onBillAction={onAgendaEventAction}
      />
    ) : (
      <DeadlinesAgendaRail
        ref={agendaRailRef}
        viewYear={viewYear}
        viewMonth={viewMonth}
        computed={computed}
        selectedDateKey={selectedDateKey}
        selectedItemId={effectiveSelectedItemId}
        scrollCommand={agendaScrollCommand}
        currentYear={currentYear}
        currentMonth={currentMonth}
        todayDate={todayDate}
        floatingEditorDirty={floatingEditorOpen && !!floatingDetail?.dirty}
        onDirtyBlocked={onAgendaDirtyBlocked}
        onPassiveDateChange={onAgendaPassiveDateChange}
        onDateAction={onAgendaDateAction}
        onDeadlineAction={onAgendaEventAction}
        deadlineQuickActions={deadlineQuickActions}
      />
    )
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

  const selectedItemPool = activeView.getDayState
    ? [
        ...(selectedDayState.activeItems || []),
        ...(selectedDayState.completedItems || []),
      ]
    : Array.isArray(selectedItems)
      ? selectedItems
      : selectedDayState.items || [];
  const selectedItemResolves = floatingDetail?.itemId && activeView.getItemId
    ? selectedItemPool.some((item) => String(activeView.getItemId(item)) === String(floatingDetail.itemId))
    : !!floatingDetail?.itemId;
  const floatingDetailItems = floatingDetail?.parked
    && !selectedItemResolves
    && Array.isArray(floatingDetail.itemsSnapshot)
      ? floatingDetail.itemsSnapshot
      : selectedItems;
  const floatingDetailContent = !layout.stacked && floatingDetail?.open
    ? floatingEditorOpen && floatingDetail.view === "events"
      ? (
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
        )
      : floatingEditorOpen && floatingDetail.view === "deadlines"
        ? activeView.renderDetail?.({
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
          })
        : activeView.renderFloatingDetail?.({
        selectedDay,
        selectedDateKey,
        viewYear,
        viewMonth,
        items: floatingDetailItems,
        data: viewData,
        computed,
        selectedItemId: floatingDetail.itemId,
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
            setSelectedItemId(String(task.id));
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
          if (String(effectiveSelectedItemId) === String(taskId)) {
            setSelectedItemId(null);
            onCloseFloatingDetail?.();
          }
        },
        onDraftPreviewChange: onDeadlineDraftPreviewChange,
        ghostPreview,
      })
    : null;

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
                gridTemplateRows: layout.stacked ? "auto" : "minmax(0, 1fr)",
                overflow: layout.stacked ? "visible" : "hidden",
              }}
            >
              <div style={{ minWidth: 0, minHeight: 0, display: "flex", flex: 1 }}>
                <CalendarGrid
                  key={`${view}-${viewYear}-${viewMonth}`}
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
                  itemsByDate={itemsByDate}
                  selectedDay={selectedDay}
                  selectedDateKey={selectedDateKey}
                  selectedItemId={effectiveSelectedItemId}
                  viewData={viewData}
                  activeView={activeView}
                  layout={layout}
                  suppressOutsideClick={suppressOutsideClick}
                  showGridSkeleton={showGridSkeleton}
                  buildFallbackDayState={buildFallbackDayState}
                  closeEventEditor={closeEventEditor}
                  setSelectedDay={setSelectedDay}
                  setSelectedDateKey={setSelectedDateKey}
                  setSelectedItemId={setSelectedItemId}
                  eventQuickActions={eventQuickActions}
                  deadlineQuickActions={deadlineQuickActions}
                  setDeadlineEditor={setDeadlineEditor}
                  canGoPrev={canGoPrev}
                  navigateMonth={navigateMonth}
                  monthWheelStateRef={monthWheelStateRef}
                  monthMotionDirection={monthMotionDirection}
                  ghostPreview={ghostPreview}
                  onOpenFloatingDetail={onOpenFloatingDetail}
                  onCloseFloatingDetail={onCloseFloatingDetail}
                  onReanchorFloatingDetail={onReanchorFloatingDetail}
                  floatingDetailOpen={!!floatingDetail?.open}
                  floatingDetailParked={!!floatingDetail?.parked}
                  floatingEditorDirty={floatingEditorOpen && !!floatingDetail?.dirty}
                  onShakeFloatingEditor={onShakeFloatingEditor}
                  onDirectDateAction={onGridDateAction}
                  onDirectItemAction={onGridEventAction}
                />
                {view === "events" ? (
                  <CalendarQuickActionLayer quickActions={eventQuickActions} />
                ) : view === "deadlines" ? (
                  <DeadlineQuickActionLayer quickActions={deadlineQuickActions} />
                ) : null}
              </div>
            </div>

            <aside
              ref={contextRailRef}
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
              <AnimatedRailContent contentKind={contentKind} contentKey={contentKey} layoutTier={layout.tier}>
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
          <CalendarFloatingDetailPanel
            detail={floatingDetail}
            label={floatingDetailLabel}
            calendarPanelRef={panelRef}
            railRef={contextRailRef}
            suppressOutsideClick={suppressOutsideClick}
            suppressFocusRing={suppressFocusRing}
            onClose={floatingEditorOpen ? onCancelFloatingEditor : onCloseFloatingDetail}
            onPark={onParkFloatingDetail}
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
