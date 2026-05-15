import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import CalendarModal from "./CalendarModal.jsx";

const mockDeleteDeadline = vi.fn();

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
  deleteDeadline: (...args) => mockDeleteDeadline(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.innerWidth = 1600;
  mockDeleteDeadline.mockResolvedValue({});
});

function renderDeadlineModal({ deadlines = [], deadlineActions = {} } = {}) {
  return render(
    <DashboardProvider
      briefing={{ emails: { accounts: [] }, deadlines: { upcoming: deadlines, stats: null } }}
      setBriefing={() => {}}
      setCalendarDeadlines={() => {}}
    >
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: deadlines,
          stats: null,
        }}
        deadlineActions={deadlineActions}
      />
    </DashboardProvider>,
  );
}

describe("Calendar deadline quick actions", () => {
  it("opens a right-click menu for domain deadlines and confirms delete", async () => {
    const onDeleteTask = vi.fn();
    renderDeadlineModal({
      deadlines: [{
        id: "todo-context-delete",
        title: "Renew parking permit",
        due_date: "2026-04-20",
        due_time: "9:00 AM",
        status: "incomplete",
        url: "https://todoist.com/showTask?id=todo-context-delete",
      }],
      deadlineActions: { onDeleteTask },
    });

    fireEvent.contextMenu(await screen.findByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });

    expect(await screen.findByTestId("calendar-deadline-context-menu")).toBeTruthy();
    expect(screen.getByTestId("calendar-deadline-context-edit").textContent).toBe("Edit deadline");
    fireEvent.click(screen.getByTestId("calendar-deadline-context-delete"));
    fireEvent.click(screen.getByTestId("calendar-deadline-context-confirm-delete"));

    await waitFor(() => {
      expect(mockDeleteDeadline).toHaveBeenCalledWith("todo-context-delete");
    });
    expect(onDeleteTask).toHaveBeenCalledWith("todo-context-delete");
  });

  it("uses domain completion without provider-status actions", async () => {
    const onCompleteTask = vi.fn();
    renderDeadlineModal({
      deadlines: [{
        id: "deadline-context-status",
        title: "Submit lab report",
        class_name: "Chemistry",
        due_date: "2026-04-20",
        status: "incomplete",
      }],
      deadlineActions: { onCompleteTask },
    });

    fireEvent.contextMenu(await screen.findByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });

    expect(await screen.findByTestId("calendar-deadline-context-menu")).toBeTruthy();
    expect(screen.queryByText("Mark in progress")).toBeNull();
    fireEvent.click(screen.getByTestId("calendar-deadline-context-complete"));

    expect(onCompleteTask).toHaveBeenCalledWith("deadline-context-status", expect.objectContaining({
      id: "deadline-context-status",
    }));
  });
});
