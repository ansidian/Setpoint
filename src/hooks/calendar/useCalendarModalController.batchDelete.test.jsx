import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import useCalendarModalController from "./useCalendarModalController.jsx";

let latestShellProps = null;
const quickActions = vi.hoisted(() => ({ args: null }));

vi.mock("../../components/calendar/modal/CalendarModalShell.jsx", () => ({
  default: vi.fn((props) => {
    latestShellProps = props;
    return <div ref={props.panelRef} data-testid="calendar-modal-shell" />;
  }),
}));

// Capture the props the controller wires into the quick-actions hook so the test
// can invoke onBatchDeleted directly with the succeeded subset, mirroring the
// batch-delete flow's partial-failure callback (onBatchDeleted(succeededEvents)).
vi.mock("../../components/calendar/events/useCalendarQuickActions.js", () => ({
  default: vi.fn((args) => {
    quickActions.args = args;
    return {};
  }),
}));

vi.mock("@/api", () => ({
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

vi.mock("../../api", () => ({
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

const ms = (iso) => new Date(iso).getTime();

function selectableEvent(overrides = {}) {
  return {
    id: "event-1",
    title: "Standup",
    accountId: "gmail-main",
    calendarId: "primary",
    startMs: ms("2026-05-18T16:00:00.000Z"),
    endMs: ms("2026-05-18T16:30:00.000Z"),
    allDay: false,
    writable: true,
    ...overrides,
  };
}

function Harness(props) {
  return useCalendarModalController(props);
}

function renderHarness(overrides = {}) {
  return render(
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
        {...overrides}
      />
    </DashboardProvider>,
  );
}

describe("useCalendarModalController batch-delete selection pruning", () => {
  beforeEach(() => {
    latestShellProps = null;
    quickActions.args = null;
    window.innerWidth = 1440;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("prunes only the succeeded identities from the selection and leaves the failed one selected", () => {
    renderHarness();

    const first = selectableEvent({ id: "event-first", title: "First" });
    const second = selectableEvent({ id: "event-second", title: "Second" });
    const failed = selectableEvent({ id: "event-failed", title: "Failed" });

    act(() => {
      latestShellProps.quickActions.eventQuickActions.toggleEventSelection({ event: first });
      latestShellProps.quickActions.eventQuickActions.toggleEventSelection({ event: second });
      latestShellProps.quickActions.eventQuickActions.toggleEventSelection({ event: failed });
    });

    expect(latestShellProps.quickActions.eventQuickActions.eventSelectionCount).toBe(3);

    // The batch-delete flow reports only the events that actually deleted; the
    // failed event stays live and must remain selected.
    act(() => {
      quickActions.args.onBatchDeleted([first, second]);
    });

    expect(latestShellProps.quickActions.eventQuickActions.eventSelectionCount).toBe(1);
    expect(latestShellProps.quickActions.eventQuickActions.isEventSelectionSelected(first)).toBe(false);
    expect(latestShellProps.quickActions.eventQuickActions.isEventSelectionSelected(second)).toBe(false);
    expect(latestShellProps.quickActions.eventQuickActions.isEventSelectionSelected(failed)).toBe(true);
  });
});
