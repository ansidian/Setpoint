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
  const [closeCount, setCloseCount] = useState(0);
  const close = () => {
    setOpen(false);
    setCloseCount((count) => count + 1);
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
      <output data-testid="mobile-detail-close-count">{closeCount}</output>
    </>
  );
}

describe("CalendarMobileAgenda", () => {
  it("renders real mobile chrome and agenda composition without a detail sheet", () => {
    render(<CalendarMobileAgenda {...shellProps()} />);
    expect(screen.getByText("June 2026")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Events" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Bills" })).toBeTruthy();
    expect(screen.getByTestId("events-agenda-rail")).toBeTruthy();
    expect(screen.queryByTestId("calendar-mini-calendar")).toBeNull();
    expect(screen.queryByTestId("detail-content")).toBeNull();
  });

  it("opens the real detail composition in a BottomSheet", () => {
    render(<StatefulMobileAgenda initialOpen />);
    expect(screen.getByTestId("detail-content").textContent).toContain("Planning block");
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("closes an open detail sheet when the KeepAlive content is hidden", () => {
    const { rerender } = render(<StatefulMobileAgenda initialOpen />);
    rerender(<StatefulMobileAgenda initialOpen mounted={false} />);
    expect(screen.getByTestId("mobile-detail-close-count").textContent).toBe("1");
  });

  it("does not close on hide when the detail sheet was already closed", () => {
    const { rerender } = render(<StatefulMobileAgenda />);
    rerender(<StatefulMobileAgenda mounted={false} />);
    expect(screen.getByTestId("mobile-detail-close-count").textContent).toBe("0");
  });

  it("dismisses the detail sheet on browser back", () => {
    render(<StatefulMobileAgenda initialOpen />);

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    });

    expect(screen.queryByTestId("detail-content")).toBeNull();
    expect(screen.getByTestId("mobile-detail-close-count").textContent).toBe("1");
  });

  it("keeps the detail sheet open when popstate retains its history token", () => {
    render(<StatefulMobileAgenda initialOpen />);

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    });

    expect(screen.getByTestId("detail-content")).toBeTruthy();
    expect(screen.getByTestId("mobile-detail-close-count").textContent).toBe("0");
  });
});
