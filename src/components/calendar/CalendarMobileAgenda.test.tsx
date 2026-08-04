import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./modal/CalendarModalAgendaRailContent", () => ({
  default: ({ hideMiniCalendar, mobileAgenda }: { hideMiniCalendar?: boolean; mobileAgenda?: boolean }) => (
    <div data-testid="agenda-content" data-mobile-agenda={mobileAgenda ? "true" : undefined}>
      {hideMiniCalendar ? null : <div data-testid="mock-mini-calendar" />}
    </div>
  ),
}));
vi.mock("./modal/CalendarFloatingDetailContent", () => ({
  default: () => <div data-testid="detail-content">detail</div>,
}));

import CalendarMobileAgenda from "./CalendarMobileAgenda.tsx";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

function shellProps(overrides = {}) {
  return {
    refs: {},
    viewState: { view: "events", viewYear: 2026, viewMonth: 5, currentYear: 2026, currentMonth: 5, todayDate: 24 },
    viewModel: {
      layout: { stacked: true }, monthName: "June", monthYear: "2026", canGoPrev: true, computed: {},
      selectedItems: [], selectedDayState: {}, effectiveSelectedItemId: null, ghostPreview: null,
      floatingDetailLabel: "Wed, Jun 24",
    },
    data: { activeView: {}, viewData: {}, weatherData: null, getMonthEvents: null, eventsRange: null, deadlinesRange: null, dataRevision: 0 },
    selection: { selectedDay: 24, selectedDateKey: "2026-06-24", setSelectedItemId: vi.fn() },
    editors: { eventEditor: {}, deadlineEditor: null, setDeadlineEditor: vi.fn(), onDeadlineDraftPreviewChange: vi.fn() },
    quickActions: { eventQuickActions: {} },
    agenda: {
      agendaScrollCommand: null, agendaEntryTargetDateKey: null, onAgendaPassiveDateChange: vi.fn(),
      onAgendaDateAction: vi.fn(), onAgendaEventAction: vi.fn(), miniCalendarActions: {}, onAgendaDirtyBlocked: vi.fn(),
    },
    floating: { floatingDetail: { open: false }, onCloseFloatingDetail: vi.fn() },
    handlers: { navigateMonth: vi.fn(), onViewChange: vi.fn(), focusDeadlineTask: vi.fn(), navigateToToday: vi.fn() },
    availableCalendarViews: ["events", "bills"],
    ...overrides,
  };
}

describe("CalendarMobileAgenda", () => {
  it("renders the month strip, the events/bills toggle, and the agenda (no detail sheet when closed)", () => {
    render(<CalendarMobileAgenda {...shellProps()} />);
    expect(screen.getByText("June 2026")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Events" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Bills" })).toBeTruthy();
    expect(screen.getByTestId("agenda-content").getAttribute("data-mobile-agenda")).toBe("true");
    expect(screen.queryByTestId("mock-mini-calendar")).toBeNull();
    expect(screen.queryByTestId("detail-content")).toBeNull();
  });

  it("fires navigateMonth and onViewChange from the chrome", () => {
    const props = shellProps();
    render(<CalendarMobileAgenda {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(props.handlers.navigateMonth).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("tab", { name: "Bills" }));
    expect(props.handlers.onViewChange).toHaveBeenCalledWith("bills");
  });

  it("opens the detail BottomSheet when a floatingDetail is open", () => {
    render(<CalendarMobileAgenda {...shellProps({ floating: { floatingDetail: { open: true, detailKind: "deadline" }, onCloseFloatingDetail: vi.fn() } })} />);
    expect(screen.getByTestId("detail-content")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  // The calendar mounts inside a KeepAliveTab (React Activity): switching to
  // another shell tab hides it, which runs effect cleanup exactly like an
  // unmount would, without floatingDetail.open ever flipping to false. Without
  // this, an open detail sheet stays open-and-history-latched in the frozen
  // tab, so the user's next Back press pops an invisible sheet.
  it("closes an open detail sheet when hidden (unmount, standing in for KeepAliveTab's Activity hide)", () => {
    const onCloseFloatingDetail = vi.fn();
    const { unmount } = render(
      <CalendarMobileAgenda {...shellProps({ floating: { floatingDetail: { open: true, detailKind: "deadline" }, onCloseFloatingDetail } })} />,
    );
    unmount();
    expect(onCloseFloatingDetail).toHaveBeenCalledTimes(1);
  });

  it("does not call onCloseFloatingDetail on unmount when the detail sheet was already closed", () => {
    const onCloseFloatingDetail = vi.fn();
    const { unmount } = render(
      <CalendarMobileAgenda {...shellProps({ floating: { floatingDetail: { open: false }, onCloseFloatingDetail } })} />,
    );
    unmount();
    expect(onCloseFloatingDetail).not.toHaveBeenCalled();
  });

  // UX-09: consumer-level confirmation that the detail sheet inherits UX-11's
  // BottomSheet history integration. Real Android-Back gesture/physics remain
  // TEST-01 e2e territory — this only pins the PopStateEvent contract in jsdom.
  it("dismisses the detail sheet on browser back", () => {
    const onCloseFloatingDetail = vi.fn();
    render(
      <CalendarMobileAgenda {...shellProps({ floating: { floatingDetail: { open: true, detailKind: "deadline" }, onCloseFloatingDetail } })} />,
    );

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    });

    expect(onCloseFloatingDetail).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss the detail sheet on a popstate that still carries its history token", () => {
    const onCloseFloatingDetail = vi.fn();
    render(
      <CalendarMobileAgenda {...shellProps({ floating: { floatingDetail: { open: true, detailKind: "deadline" }, onCloseFloatingDetail } })} />,
    );

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    });

    expect(onCloseFloatingDetail).not.toHaveBeenCalled();
  });
});
