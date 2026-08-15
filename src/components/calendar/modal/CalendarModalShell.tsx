import { memo, useCallback, useEffect } from "react";
import type { ComponentProps, ComponentType, ReactNode, RefObject } from "react";
import CalendarQuickActionLayer from "../events/CalendarQuickActionLayer";
import DeadlineQuickActionLayer from "../views/deadlines/DeadlineQuickActionLayer.tsx";
import CalendarModalContextRail from "./CalendarModalContextRail";
import CalendarFloatingDetailContentBase from "./CalendarFloatingDetailContent";
import CalendarFloatingDetailPanel from "./CalendarFloatingDetailPanel";
import CalendarGridWeekHeader from "./CalendarGridWeekHeader";
import CalendarScrollContainer from "./CalendarScrollContainer";
import buildContextContent from "./buildContextContent";
import CalendarModalAgendaRailContentBase from "./CalendarModalAgendaRailContent";
import CalendarModalFrame from "./CalendarModalFrame";
import CalendarModalHeader from "./CalendarModalHeader";
import CalendarSearchRail from "./CalendarSearchRail";
import { getCalendarSearchLayoutMode } from "../calendarLayout.ts";
import type useCalendarEventEditor from "../events/useCalendarEventEditor";
import type useCalendarEventSelectionSet from "../../../hooks/calendar/useCalendarEventSelectionSet";
import type { CalendarDraftGhostPreview } from "../events/CalendarDraftPreviewPanel";
import type { CalendarFloatingDetail } from "../../../hooks/calendar/useCalendarFloatingDetail";
import type { CalendarCellQuickActions, CalendarCellWeather } from "./CalendarCell";
import type { CalendarGridActiveViewContract, CalendarGridLayout } from "./CalendarGrid";
import type { CalendarGridDayState, CalendarGridItemLike } from "./calendarGridCellModel";
import type { CalendarSpanEvent } from "./calendarEventSpanLayout";
import type { CalendarSearchRailController, CalendarWeatherData } from "./CalendarSearchRail";
import type { CalendarSearchResultLike } from "../../../hooks/calendar/calendarModalSearchModel";
import type { CalendarSearchActivationContext } from "../../../hooks/calendar/useCalendarModalSearch";
import type { CalendarFloatingDetailActiveView, CalendarDetailItem } from "./CalendarFloatingDetailContent";

type CalendarEventEditor = ReturnType<typeof useCalendarEventEditor>;
type CalendarEventQuickActions = ReturnType<typeof useCalendarEventSelectionSet>["eventQuickActions"] & CalendarCellQuickActions;
export interface CalendarShellComputed {
  itemsByDate?: Record<string, CalendarGridItemLike[]>;
  cellMetaByDate?: Record<string, { weather?: CalendarCellWeather | null }>;
  [key: string]: unknown;
}
type CalendarShellActiveView = CalendarGridActiveViewContract & CalendarFloatingDetailActiveView & {
  HeaderExtras?: ComponentType<Record<string, unknown>>;
  renderSidebar?: (options: Record<string, unknown>) => ReactNode;
  renderDetail?: (options: Record<string, unknown>) => ReactNode;
};
type CalendarShellSearchController = CalendarSearchRailController & {
  isResultNavigable: (result: CalendarSearchResultLike, index?: number) => boolean;
  getResultActivationContext: (
    result: CalendarSearchResultLike,
    index: number,
    fallback: CalendarSearchActivationContext,
  ) => CalendarSearchActivationContext | null | undefined;
};

export interface CalendarModalShellProps {
  refs: {
    panelRef: RefObject<HTMLDivElement | null>;
    scrollRef: RefObject<HTMLDivElement | null>;
    contextRailRef: RefObject<HTMLElement | null>;
    agendaRailRef: RefObject<unknown>;
  };
  viewState: {
    view: string;
    viewYear: number;
    viewMonth: number;
    currentYear: number;
    currentMonth: number;
    todayDate: number;
    suppressFocusRing?: boolean;
  };
  viewModel: {
    panelWidth: number | string;
    layout: CalendarGridLayout & {
      stacked: boolean;
      stickyRail: boolean;
      tier: "uhd" | "xl" | "lg" | "md" | "sm";
      panelMaxWidth?: number | string | null;
      shellMaxHeight?: number | string | null;
      shellPadding: number;
      contentGap: number;
      searchWidth: number;
      contextWidth: number;
      editorWidth: number;
      headerStacked?: boolean;
      headerWrap?: boolean;
    };
    monthName: string;
    monthYear: string | number;
    canGoPrev: boolean;
    computed: CalendarShellComputed;
    itemsByDay: Record<number, CalendarGridItemLike[]>;
    itemsByDate: Record<string, CalendarGridItemLike[]>;
    cellMetaByDate: Record<string, { weather?: CalendarCellWeather | null }>;
    showGridSkeleton: boolean;
    buildFallbackDayState: (items: CalendarGridItemLike[]) => CalendarGridDayState;
    showDetail: boolean;
    showEmptySelection: boolean;
    effectiveSelectedItemId?: unknown;
    selectedDayState: CalendarGridDayState<CalendarDetailItem>;
    selectedItems: CalendarDetailItem[];
    ghostPreview?: (CalendarDraftGhostPreview & { targetDate?: string | null }) | null;
    floatingDetailLabel?: string | null;
  };
  data: {
    activeView: CalendarShellActiveView;
    HeaderExtras?: ComponentType<Record<string, unknown>>;
    viewData?: {
      events?: CalendarSpanEvent[];
      deadlineOverlay?: { enabled: boolean; showCompleted: boolean; data?: unknown } | null;
      planningReadiness?: { state?: unknown };
      isLoading?: boolean;
      agendaEntryReady?: boolean;
      pendingUpdate?: boolean;
    } | null;
    weatherData?: CalendarWeatherData | null;
    isMonthCached?: ((year: number, month: number) => boolean) | null;
    getMonthEvents?: ((year: number, month: number) => Array<CalendarSpanEvent & { id: string | number }> | null) | null;
    getMonthDeadlines?: ((year: number, month: number) => unknown) | null;
    eventsRange?: unknown;
    deadlinesRange?: unknown;
    dataRevision?: number;
    getMonthBills?: ((...args: unknown[]) => unknown) | null;
    billsRange?: unknown;
    billsDataRevision?: number;
  };
  selection: {
    selectedDay?: number | null;
    selectedDateKey?: string | null;
    setSelectedDay: (day: number) => void;
    setSelectedDateKey: (dateKey: string) => void;
    setSelectedItemId: (itemId: string | null) => void;
  };
  editors: {
    eventEditor: CalendarEventEditor;
    deadlineEditor?: Record<string, unknown> | null;
    setDeadlineEditor: (editor: Record<string, unknown> | null) => void;
    closeEventEditor: () => void;
    onDeadlineDraftPreviewChange?: (preview: unknown) => void;
  };
  quickActions: {
    eventQuickActions: CalendarEventQuickActions;
    deadlineQuickActions?: CalendarCellQuickActions | null;
  };
  agenda: {
    agendaScrollCommand?: unknown;
    agendaEntryTargetDateKey?: string | null;
    onAgendaPassiveDateChange?: (...args: unknown[]) => void;
    onAgendaDateAction?: (...args: unknown[]) => void;
    onAgendaEventAction?: (...args: unknown[]) => void;
    miniCalendarActions?: { onDateAction?: (...args: unknown[]) => void; onDateCreate?: (...args: unknown[]) => void } | null;
    onAgendaDirtyBlocked?: () => void;
    onGridDateAction?: (dateKey: string) => void;
    onGridEventAction?: (itemId: unknown, dateKey: string) => void;
  };
  floating: {
    floatingDetail: CalendarFloatingDetail | null;
    onOpenFloatingDetail?: (detail: Record<string, unknown>) => void;
    onCloseFloatingDetail?: () => boolean | void;
    onFloatingDetailDragged?: (dragged: boolean, placementKey: string) => void;
    onOpenFloatingEventCreate?: (dateKey?: string | null) => void;
    onOpenFloatingEventEdit?: (item: CalendarDetailItem, context: Record<string, unknown>) => void;
    onOpenFloatingDeadlineCreate?: (dateKey?: string | null) => void;
    onOpenFloatingDeadlineEdit?: (task: CalendarDetailItem, context: Record<string, unknown>) => void;
    onCancelFloatingEditor: () => void;
    onFloatingEditorDirtyChange?: (dirty: boolean) => void;
    onFloatingEditorSaveRequest?: (requestId: string) => void;
    onShakeFloatingEditor?: () => void;
    onFloatingDeadlineSaved?: (task: CalendarDetailItem) => void;
    onFloatingDeadlineDeleted?: (taskId: unknown) => void;
  };
  handlers: {
    navigateMonth: (offset: number) => void;
    jumpToMonth?: (year: number, month: number) => void;
    onViewChange?: (view: string) => void;
    focusDeadlineTask?: (task: CalendarDetailItem) => void;
    onDisplayMonthChange?: (target: { year: number; month: number }) => void;
    onLabelMonthChange?: (target: { year: number; month: number }) => void;
    onFetchSettle?: (target: { year: number; month: number; scrollDriven: boolean }) => void;
    navigateToToday?: () => void;
  };
  search: CalendarShellSearchController;
  availableCalendarViews: string[];
}

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
}: CalendarModalShellProps) {
  const { panelRef, scrollRef, contextRailRef, agendaRailRef } = refs;
  const { view, viewYear, viewMonth, currentYear, currentMonth, todayDate, suppressFocusRing = false } = viewState;
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
  const { navigateMonth, jumpToMonth, onViewChange, focusDeadlineTask, onDisplayMonthChange, onLabelMonthChange, onFetchSettle } = handlers;
  const floatingEditorOpen = !layout.stacked
    && !!floatingDetail?.open
    && (floatingDetail.mode === "edit" || floatingDetail.mode === "create");
  const floatingDeadlineDetail = floatingDetail?.detailKind === "deadline";
  const floatingDetailGridDateKey = floatingEditorOpen
    ? floatingDetail?.dateKey || null
    : ghostPreview?.targetDate || floatingDetail?.dateKey || null;
  const railEventEditor: CalendarEventEditor = floatingEditorOpen && view === "events" && !floatingDeadlineDetail
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
      ? `deadline-editor-${String(railDeadlineEditor.mode)}-${String(railDeadlineEditor.taskId || railDeadlineEditor.seedDate || "new")}`
      : showDetail
        ? `detail-${view}-${viewYear}-${viewMonth}-${selectedDay}-${selectedDayState.totalCount}`
        : showEmptySelection
          ? `empty-${view}-${viewYear}-${viewMonth}`
          : `summary-${view}-${viewYear}-${viewMonth}`;

  const contextWidth = workspaceMode === "editor" ? layout.editorWidth : layout.contextWidth;
  // Hoist the rail-facing callbacks to useCallback so the memoized agenda /
  // floating rails (and any memoized header descendants) are not re-rendered by
  // a fresh inline-arrow identity on every shell render.
  const handleOpenEventCreate: CalendarEventEditor["openCreate"] = useCallback(async () => {
    if (!layout.stacked) {
      if (!onOpenFloatingEventCreate) return { accepted: false, reason: "editor_unavailable" };
      onOpenFloatingEventCreate(selectedDateKey);
      return { accepted: true };
    }
    onCloseFloatingDetail?.();
    return eventEditor.openCreate();
  }, [eventEditor, layout.stacked, onCloseFloatingDetail, onOpenFloatingEventCreate, selectedDateKey]);
  const handleCreateTask = useCallback((seedDate?: string | null) => {
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
  const headerEventEditor: CalendarEventEditor = view === "events"
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
    <CalendarModalFrame
      refs={{ panelRef, scrollRef }}
      layout={{
        panelWidth,
        panelMaxWidth: layout.panelMaxWidth,
        shellMaxHeight: layout.shellMaxHeight,
        shellPadding: layout.shellPadding,
        contentGap: layout.contentGap,
      }}
      suppressFocusRing={suppressFocusRing}
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
        setDeadlineEditor={(next: Record<string, unknown> | null) => {
          if (!layout.stacked && next?.mode === "create") {
            const seedDate = typeof next.seedDate === "string" ? next.seedDate : null;
            onOpenFloatingDeadlineCreate?.(seedDate || selectedDateKey || null);
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
              <CalendarQuickActionLayer quickActions={eventQuickActions || null} />
              <DeadlineQuickActionLayer quickActions={deadlineQuickActions as unknown as ComponentProps<typeof DeadlineQuickActionLayer>["quickActions"]} />
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
    </CalendarModalFrame>
  );
}
