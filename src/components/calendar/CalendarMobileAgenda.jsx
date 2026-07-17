import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import BottomSheet from "../ui/BottomSheet";
import CalendarModalAgendaRailContent from "./modal/CalendarModalAgendaRailContent.jsx";
import CalendarFloatingDetailContent from "./modal/CalendarFloatingDetailContent.jsx";

const VIEW_LABELS = { events: "Events", bills: "Bills" };

const STRIP_BTN = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "var(--sp-touch-min)",
  minHeight: "var(--sp-touch-min)",
  border: "none",
  background: "transparent",
  color: "var(--sp-text)",
  cursor: "pointer",
};

// Visible "jump to today" affordance, shown in the month strip only when the
// agenda has been scrolled/navigated off the current month — the discoverable
// escape from the "stranded months ahead" state.
function TodayPill({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Jump to today"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        minHeight: "var(--sp-touch-min)",
        padding: "0 12px",
        borderRadius: 999,
        border: "1px solid color-mix(in srgb, var(--sp-accent) " + (hover ? "55%" : "32%") + ", transparent)",
        background: "color-mix(in srgb, var(--sp-accent) " + (hover ? "22%" : "14%") + ", transparent)",
        color: "var(--sp-accent)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        transform: hover ? "translateY(-1px)" : "translateY(0)",
        transition: "background 150ms, border-color 150ms, transform 150ms",
      }}
    >
      Today
    </button>
  );
}

// Mobile-only calendar root (rendered by useCalendarModalController when useIsMobile()).
// Agenda-only: a slim month strip + events/bills toggle + the full-width agenda
// (CalendarModalAgendaRailContent with the MiniCalendar suppressed), and tap-to-open
// detail in a BottomSheet (CalendarFloatingDetailContent, edit suppressed). Desktop is
// unaffected — this component only mounts on a phone.
export default function CalendarMobileAgenda(shellProps) {
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

  const onCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;
  const detailOpen = !!floatingDetail?.open;
  const floatingDeadlineDetail = floatingDetail?.detailKind === "deadline";
  const views = availableCalendarViews || ["events"];

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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--sp-panel)" }}>
      {/* Slim month strip */}
      <div style={{
        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <button type="button" aria-label="Previous month" disabled={!canGoPrev} onClick={() => navigateMonth(-1)}
          style={{ ...STRIP_BTN, opacity: canGoPrev ? 1 : 0.4, cursor: canGoPrev ? "pointer" : "default" }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--sp-text)" }}>{monthName} {monthYear}</span>
          {!onCurrentMonth && <TodayPill onClick={() => navigateToToday()} />}
        </div>
        <button type="button" aria-label="Next month" onClick={() => navigateMonth(1)} style={STRIP_BTN}>
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Events / Bills toggle */}
      {views.length > 1 && (
        <div role="tablist" aria-label="Calendar view" style={{
          flexShrink: 0, display: "flex", gap: 4, padding: "6px 8px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          {views.map((v) => {
            const active = v === view;
            return (
              <button key={v} type="button" role="tab" aria-selected={active} className="sp-mobile-agenda-control"
                onClick={() => {
                  if (!active) onViewChange(v);
                }}
                style={{
                  flex: 1, minHeight: "var(--sp-touch-min)", borderRadius: 8, cursor: "pointer",
                  border: "1px solid " + (active ? "color-mix(in srgb, var(--sp-accent) 40%, transparent)" : "rgba(255,255,255,0.06)"),
                  background: active ? "color-mix(in srgb, var(--sp-accent) 14%, transparent)" : "transparent",
                  color: active ? "var(--sp-accent)" : "var(--color-text-faint)",
                  fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                }}>
                {VIEW_LABELS[v] || v}
              </button>
            );
          })}
        </div>
      )}

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
      <BottomSheet open={detailOpen} onClose={onCloseFloatingDetail} title={floatingDetailLabel || "Details"}>
        <div style={{ padding: 12 }}>
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
