import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./modal/CalendarModalAgendaRailContent.jsx", () => ({
  default: () => <div data-testid="agenda-content" />,
}));
vi.mock("./modal/CalendarFloatingDetailContent.jsx", () => ({
  default: () => <div data-testid="detail-content">detail</div>,
}));

import CalendarMobileAgenda from "./CalendarMobileAgenda.jsx";

afterEach(cleanup);

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
    handlers: { navigateMonth: vi.fn(), onViewChange: vi.fn(), focusDeadlineTask: vi.fn() },
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
    expect(screen.getByTestId("agenda-content")).toBeTruthy();
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
});
