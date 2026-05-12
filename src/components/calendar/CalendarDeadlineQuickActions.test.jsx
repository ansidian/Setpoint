import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import CalendarModal from "./CalendarModal.jsx";

const mockDeleteTodoistTask = vi.fn();

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
  deleteTodoistTask: (...args) => mockDeleteTodoistTask(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.innerWidth = 1600;
  mockDeleteTodoistTask.mockResolvedValue({});
});

function renderDeadlineModal({ ctm = [], todoist = [], deadlineActions = {} } = {}) {
  return render(
    <DashboardProvider
      briefing={{ emails: { accounts: [] }, ctm: { upcoming: ctm }, todoist: { upcoming: todoist } }}
      setBriefing={() => {}}
      setCalendarDeadlines={() => {}}
    >
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          ctm: { upcoming: ctm, stats: null },
          todoist: { upcoming: todoist, stats: null },
        }}
        deadlineActions={deadlineActions}
      />
    </DashboardProvider>,
  );
}

describe("Calendar deadline quick actions", () => {
  it("opens a right-click menu for Todoist deadlines and confirms delete", async () => {
    const onDeleteTask = vi.fn();
    renderDeadlineModal({
      todoist: [{
        id: "todo-context-delete",
        source: "todoist",
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
    expect(screen.getByTestId("calendar-deadline-context-edit").textContent).toBe("Edit task");
    fireEvent.click(screen.getByTestId("calendar-deadline-context-delete"));
    fireEvent.click(screen.getByTestId("calendar-deadline-context-confirm-delete"));

    await waitFor(() => {
      expect(mockDeleteTodoistTask).toHaveBeenCalledWith("todo-context-delete");
    });
    expect(onDeleteTask).toHaveBeenCalledWith("todo-context-delete");
  });

  it("mirrors CTM status actions without exposing Todoist-only delete", async () => {
    const onUpdateTaskStatus = vi.fn();
    renderDeadlineModal({
      ctm: [{
        id: "canvas-context-status",
        source: "canvas",
        title: "Submit lab report",
        class_name: "Chemistry",
        due_date: "2026-04-20",
        status: "incomplete",
        url: "https://canvas.example/assignments/1",
      }],
      deadlineActions: { onUpdateTaskStatus },
    });

    fireEvent.contextMenu(await screen.findByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });

    expect(await screen.findByTestId("calendar-deadline-context-menu")).toBeTruthy();
    expect(screen.queryByTestId("calendar-deadline-context-delete")).toBeNull();
    fireEvent.click(screen.getByTestId("calendar-deadline-context-complete"));

    expect(onUpdateTaskStatus).toHaveBeenCalledWith("canvas-context-status", "complete");
  });
});
