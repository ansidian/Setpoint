import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import CalendarMobileAgenda from "./CalendarMobileAgenda.tsx";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

const selectedEvent = {
  id: "event-1",
  title: "Planning block",
  startMs: new Date("2026-06-24T16:00:00.000Z").getTime(),
  endMs: new Date("2026-06-24T17:00:00.000Z").getTime(),
  allDay: false,
  color: "#89b4fa",
};

function shellProps(overrides: Record<string, unknown> = {}) {
  return {
    refs: {},
    viewState: { view: "events", viewYear: 2026, viewMonth: 5, currentYear: 2026, currentMonth: 5, todayDate: 24 },
    viewModel: {
      layout: { stacked: true }, monthName: "June", monthYear: "2026", canGoPrev: true, computed: {},
      selectedItems: [selectedEvent], selectedDayState: { items: [selectedEvent] }, effectiveSelectedItemId: "event-1", ghostPreview: null,
      floatingDetailLabel: "Wed, Jun 24",
    },
    data: {
      activeView: {
        getItemId: (item: typeof selectedEvent) => item.id,
        renderFloatingDetail: () => <div data-testid="detail-content">Planning block</div>,
      },
      viewData: { events: [], agendaEntryReady: true, isLoading: false },
      weatherData: null,
      getMonthEvents: null,
      eventsRange: null,
      deadlinesRange: null,
      dataRevision: 0,
    },
    selection: { selectedDay: 24, selectedDateKey: "2026-06-24", setSelectedItemId: () => {} },
    editors: { eventEditor: {}, deadlineEditor: null, setDeadlineEditor: () => {}, onDeadlineDraftPreviewChange: () => {} },
    quickActions: { eventQuickActions: {} },
    agenda: {
      agendaScrollCommand: null, agendaEntryTargetDateKey: null, onAgendaPassiveDateChange: () => {},
      onAgendaDateAction: () => {}, onAgendaEventAction: () => {}, miniCalendarActions: {}, onAgendaDirtyBlocked: () => {},
    },
    floating: { floatingDetail: { open: false }, onCloseFloatingDetail: () => {} },
    handlers: { navigateMonth: () => {}, onViewChange: () => {}, focusDeadlineTask: () => {}, navigateToToday: () => {} },
    availableCalendarViews: ["events", "bills"],
    ...overrides,
  };
}

function StatefulMobileAgenda({ mounted = true, initialOpen = false }: { mounted?: boolean; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const close = () => {
    setOpen(false);
  };

  return (
    <>
      {mounted ? (
        <CalendarMobileAgenda {...shellProps({
          floating: {
            floatingDetail: open
              ? { open: true, detailKind: "event", view: "events", itemId: "event-1" }
              : { open: false },
            onCloseFloatingDetail: close,
          },
        })} />
      ) : null}
    </>
  );
}

describe("CalendarMobileAgenda", () => {

  it("dismisses the detail sheet on browser back", () => {
    render(<StatefulMobileAgenda initialOpen />);

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    });

    expect(screen.queryByTestId("detail-content")).toBeNull();
  });

  it("keeps the detail sheet open when popstate retains its history token", () => {
    render(<StatefulMobileAgenda initialOpen />);

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    });

    expect(screen.getByTestId("detail-content")).toBeTruthy();
  });
});
