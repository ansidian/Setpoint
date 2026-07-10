import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const appCss = readFileSync("src/index.css", "utf8");

const agendaContentSpy = vi.hoisted(() => vi.fn());

vi.mock("./modal/CalendarModalAgendaRailContent.jsx", () => ({
  default: (props) => {
    agendaContentSpy(props);
    return <div data-testid="agenda-content" />;
  },
}));
vi.mock("./modal/CalendarFloatingDetailContent.jsx", () => ({
  default: () => <div data-testid="detail-content">detail</div>,
}));

import CalendarMobileAgenda from "./CalendarMobileAgenda.jsx";

afterEach(() => {
  cleanup();
  agendaContentSpy.mockClear();
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
    expect(screen.getByTestId("agenda-content")).toBeTruthy();
    expect(screen.queryByTestId("detail-content")).toBeNull();
  });

  it("marks the agenda rail content as the mobile agenda", () => {
    render(<CalendarMobileAgenda {...shellProps()} />);

    expect(agendaContentSpy).toHaveBeenCalledWith(expect.objectContaining({
      hideMiniCalendar: true,
      mobileAgenda: true,
    }));
  });

  it("fires navigateMonth and onViewChange from the chrome", () => {
    const props = shellProps();
    render(<CalendarMobileAgenda {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(props.handlers.navigateMonth).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("tab", { name: "Bills" }));
    expect(props.handlers.onViewChange).toHaveBeenCalledWith("bills");
    expect(screen.getByRole("tab", { name: "Events" }).classList.contains("sp-mobile-agenda-control")).toBe(true);
    expect(screen.getByRole("tab", { name: "Bills" }).classList.contains("sp-mobile-agenda-control")).toBe(true);
  });

  it("keeps agenda touch sizing and interaction states mobile-scoped", () => {
    expect(appCss).toMatch(/@media \(max-width: 639px\)[\s\S]*?\.sp-agenda-touch\s*\{\s*min-height:\s*var\(--sp-touch-min\)\s*!important;\s*\}/);
    expect(appCss).toMatch(/@media \(max-width: 639px\)[\s\S]*?\.sp-mobile-agenda-control:hover,[\s\S]*?\.sp-mobile-agenda-control:focus-visible/);
    expect(appCss).toMatch(/\.sp-mobile-agenda-control:active\s*\{[\s\S]*?scale\(0\.98\)/);
    expect(appCss).toMatch(/@media \(max-width: 639px\) and \(prefers-reduced-motion: reduce\)[\s\S]*?\.sp-mobile-agenda-control[\s\S]*?transition:\s*none/);
  });

  it("opens the detail BottomSheet when a floatingDetail is open", () => {
    render(<CalendarMobileAgenda {...shellProps({ floating: { floatingDetail: { open: true, detailKind: "deadline" }, onCloseFloatingDetail: vi.fn() } })} />);
    expect(screen.getByTestId("detail-content")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("does nothing when re-tapping the active view tab", () => {
    const props = shellProps();
    render(<CalendarMobileAgenda {...props} />);
    // Events is the active view in the fixture; re-tapping it must not change
    // either the date or the selected calendar view.
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect(props.handlers.navigateToToday).not.toHaveBeenCalled();
    expect(props.handlers.onViewChange).not.toHaveBeenCalled();
  });

  it("shows the Today affordance only when off the current month, and it jumps to today", () => {
    const onCurrent = shellProps();
    const { rerender } = render(<CalendarMobileAgenda {...onCurrent} />);
    expect(screen.queryByRole("button", { name: "Jump to today" })).toBeNull();

    const offMonth = shellProps({
      viewState: { view: "events", viewYear: 2026, viewMonth: 8, currentYear: 2026, currentMonth: 5, todayDate: 24 },
      viewModel: { ...onCurrent.viewModel, monthName: "September", monthYear: "2026" },
    });
    rerender(<CalendarMobileAgenda {...offMonth} />);
    const todayButton = screen.getByRole("button", { name: "Jump to today" });
    expect(todayButton.style.minHeight).toBe("var(--sp-touch-min)");
    fireEvent.click(todayButton);
    expect(offMonth.handlers.navigateToToday).toHaveBeenCalledTimes(1);
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
