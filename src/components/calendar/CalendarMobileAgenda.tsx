import { useEffect, useRef, type ReactNode } from "react";
import { publicAssetUrl } from "@/publicAsset";
import "./CalendarMobileAgenda.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import BottomSheet from "../ui/BottomSheet";
import CalendarModalAgendaRailContent from "./modal/CalendarModalAgendaRailContent";
import CalendarFloatingDetailContent from "./modal/CalendarFloatingDetailContent";
import type { CalendarModalShellProps } from "./modal/CalendarModalShell";

const VIEW_LABELS = { events: "Events", bills: "Bills" };

// Mobile-only calendar root (rendered by useCalendarModalController when useIsMobile()).
// Agenda-only: compact page/view header + month navigation + the full-width agenda
// (CalendarModalAgendaRailContent with the MiniCalendar suppressed), and tap-to-open
// detail in a BottomSheet (CalendarFloatingDetailContent, edit suppressed). Desktop is
// unaffected — this component only mounts on a phone.
export default function CalendarMobileAgenda(input: Record<string, unknown>) {
  const shellProps = input as unknown as CalendarModalShellProps;
  const { viewState, viewModel, data, selection, editors, quickActions, agenda, floating, handlers, availableCalendarViews, refs } = shellProps;
  const { view, viewYear, viewMonth, currentYear, currentMonth, todayDate } = viewState;
  const {
    layout, monthName, monthYear, canGoPrev, computed,
    selectedItems, selectedDayState, effectiveSelectedItemId, ghostPreview, floatingDetailLabel,
  } = viewModel;
  const { activeView, viewData, weatherData, getMonthEvents, eventsRange, deadlinesRange, dataRevision, getMonthBills, billsRange, billsDataRevision } = data;
  const { selectedDay, selectedDateKey, setSelectedItemId } = selection;
  const { eventEditor, deadlineEditor, setDeadlineEditor, onDeadlineDraftPreviewChange } = editors;
  const { eventQuickActions } = quickActions;
  const {
    agendaScrollCommand, agendaEntryTargetDateKey, onAgendaPassiveDateChange,
    onAgendaDateAction, onAgendaEventAction, miniCalendarActions, onAgendaDirtyBlocked,
  } = agenda;
  const {
    floatingDetail, onCloseFloatingDetail, onOpenFloatingDeadlineEdit, onOpenFloatingEventEdit,
    onCancelFloatingEditor, onFloatingDeadlineDeleted,
    onFloatingDeadlineSaved, onFloatingEditorDirtyChange, onFloatingEditorSaveRequest,
  } = floating;
  const { navigateMonth, onViewChange, focusDeadlineTask, navigateToToday } = handlers;

  const detailOpen = !!floatingDetail?.open;
  const floatingDeadlineDetail = floatingDetail?.detailKind === "deadline";
  const views = (availableCalendarViews || ["events"]).filter((value): value is keyof typeof VIEW_LABELS => value === "events" || value === "bills");

  // This component mounts inside the calendar KeepAliveTab (Activity): switching
  // shell tabs hides it, which runs effect cleanup exactly like an unmount would,
  // without detailOpen ever flipping to false. Close the detail sheet on that
  // hide/unmount so it doesn't stay open-and-history-latched in the frozen tab —
  // otherwise the next Back press pops an invisible sheet.
  const detailOpenRef = useRef(detailOpen);
  const onCloseFloatingDetailRef = useRef(onCloseFloatingDetail);
  useEffect(() => {
    detailOpenRef.current = detailOpen;
    onCloseFloatingDetailRef.current = onCloseFloatingDetail;
  });
  useEffect(() => () => {
    if (detailOpenRef.current) onCloseFloatingDetailRef.current?.();
  }, []);

  return (
    <div className="mobile-calendar">
      <header className="mobile-calendar-header">
        <h1><img src={publicAssetUrl("favicon.svg")} alt="" width={22} height={22} />Calendar</h1>
        {views.length > 1 && (
          <div className="mobile-calendar-views" role="group" aria-label="Calendar view">
            {views.map((value) => (
              <button key={value} type="button" aria-pressed={value === view} onClick={() => { if (value !== view) onViewChange?.(value); }}>
                {VIEW_LABELS[value]}
              </button>
            ))}
          </div>
        )}
        {input.mobileShellActions as ReactNode}
      </header>
      <div className="mobile-calendar-navigation" aria-label="Month navigation">
        <h2 aria-live="polite">{monthName} <span>{monthYear}</span></h2>
        <button type="button" className="mobile-calendar-today" aria-label="Jump to today" onClick={() => navigateToToday?.()}>Today</button>
        <button type="button" aria-label="Previous month" disabled={!canGoPrev} onClick={() => navigateMonth(-1)}><ChevronLeft size={18} /></button>
        <button type="button" aria-label="Next month" onClick={() => navigateMonth(1)}><ChevronRight size={18} /></button>
      </div>

      {/* Full-width agenda */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <CalendarModalAgendaRailContent
          ref={refs?.agendaRailRef}
          hideMiniCalendar
          mobileAgenda
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
          floatingEditorDirty={false}
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
        />
      </div>

      {/* Tap-to-open detail sheet (view + complete/open; edit suppressed) */}
      <BottomSheet open={detailOpen} onClose={() => { onCloseFloatingDetail?.(); }} title={floatingDetailLabel || "Details"}>
        <div className="mobile-calendar-detail">
          <CalendarFloatingDetailContent
            mobileSheet
            hideEdit
            activeView={activeView}
            computed={computed}
            deadlineEditor={deadlineEditor}
            effectiveSelectedItemId={effectiveSelectedItemId}
            eventEditor={eventEditor}
            floatingDeadlineDetail={floatingDeadlineDetail}
            floatingDetail={floatingDetail}
            floatingEditorOpen={false}
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
        </div>
      </BottomSheet>
    </div>
  );
}
