import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext.jsx";

// Spy the scroll-sync reset the jump-to-today chain ultimately calls, and control
// the mobile gate. This proves the middle link the plan promised: a bumped
// jumpTodayRequestId (from re-tapping the active Calendar nav tab) drives
// sync.navigateToToday() on mobile, never on mount, and never on desktop.
const scrollSync = vi.hoisted(() => ({ navigateToToday: vi.fn() }));
let mockIsMobile = true;

vi.mock("../useIsMobile", () => ({ default: () => mockIsMobile }));

vi.mock("./useCalendarScrollSync.js", () => ({
  default: () => ({
    onAgendaScroll: vi.fn(),
    onGridScrollCrossing: vi.fn(),
    onGridScrollSettle: vi.fn(),
    syncAgendaToMonth: vi.fn(),
    navigateToDate: vi.fn(),
    navigateToMonth: vi.fn(),
    navigateToToday: scrollSync.navigateToToday,
    isAgendaDriven: vi.fn(() => false),
  }),
}));

vi.mock("../../components/calendar/modal/CalendarModalShell.jsx", () => ({
  default: (props) => <div ref={props.panelRef} data-testid="calendar-modal-shell" />,
}));
vi.mock("../../components/calendar/CalendarMobileAgenda.jsx", () => ({
  default: () => <div data-testid="calendar-mobile-agenda" />,
}));

const apiStub = vi.hoisted(() => ({
  getCalendarSearch: vi.fn(),
  getCalendarSources: vi.fn().mockResolvedValue({ accounts: [] }),
  getCalendarPlaceSuggestions: vi.fn(),
  getCalendarPlaceDetails: vi.fn(),
  createCalendarEvent: vi.fn(),
  createCalendarEventsBatch: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  listReminders: vi.fn().mockResolvedValue({ reminders: [] }),
  createReminder: vi.fn(),
  deleteReminder: vi.fn(),
  getGmailAuthUrl: vi.fn(),
  getTodoistProjects: vi.fn().mockResolvedValue([]),
  getTodoistLabels: vi.fn().mockResolvedValue([]),
  createTodoistTask: vi.fn(),
  updateTodoistTask: vi.fn(),
  deleteTodoistTask: vi.fn(),
}));
vi.mock("@/api", () => apiStub);
vi.mock("../../api", () => apiStub);

import useCalendarModalController from "./useCalendarModalController.jsx";

function Harness(props) {
  return useCalendarModalController(props);
}

function tree(jumpTodayRequestId) {
  return (
    <DashboardProvider
      briefing={{ emails: { accounts: [] }, deadlines: { upcoming: [] } }}
      setBriefing={() => {}}
      setCalendarDeadlines={() => {}}
    >
      <Harness
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-05-18"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{}}
        jumpTodayRequestId={jumpTodayRequestId}
      />
    </DashboardProvider>
  );
}

describe("useCalendarModalController jump-to-today counter", () => {
  beforeEach(() => {
    mockIsMobile = true;
    window.innerWidth = 390;
    window.localStorage.clear();
    scrollSync.navigateToToday.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not call navigateToToday on initial mount", () => {
    render(tree(0));
    expect(scrollSync.navigateToToday).not.toHaveBeenCalled();
  });

  it("calls navigateToToday once when the jump counter increments on mobile", () => {
    const { rerender } = render(tree(0));
    expect(scrollSync.navigateToToday).not.toHaveBeenCalled();
    act(() => { rerender(tree(1)); });
    expect(scrollSync.navigateToToday).toHaveBeenCalledTimes(1);
  });

  it("does not call navigateToToday when the counter increments on desktop", () => {
    mockIsMobile = false;
    const { rerender } = render(tree(0));
    act(() => { rerender(tree(1)); });
    expect(scrollSync.navigateToToday).not.toHaveBeenCalled();
  });
});
