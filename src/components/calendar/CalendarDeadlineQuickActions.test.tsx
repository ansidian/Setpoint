import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext";
import type { ComponentType, ReactNode } from "react";
import CalendarModal from "./CalendarModal.tsx";

const mockDeleteDeadline = vi.fn();
const DashboardProviderCompat = DashboardProvider as unknown as ComponentType<Record<string, unknown> & { children: ReactNode }>;

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
  deleteDeadline: (...args: unknown[]) => mockDeleteDeadline(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.innerWidth = 1600;
  mockDeleteDeadline.mockResolvedValue({});
});

function renderDeadlineModal({ deadlines = [], deadlineActions = {} }: { deadlines?: Array<Record<string, unknown>>; deadlineActions?: Record<string, unknown> } = {}) {
  return render(
    <DashboardProviderCompat
      deadlines={{ upcoming: deadlines, stats: null }}
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
    </DashboardProviderCompat>,
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

  it("hides completion from the context menu for a completed deadline", async () => {
    renderDeadlineModal({
      deadlines: [{
        id: "deadline-context-complete",
        title: "Submitted report",
        due_date: "2026-04-20",
        status: "complete",
      }],
    });

    fireEvent.contextMenu(await screen.findByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });

    const menu = await screen.findByTestId("calendar-deadline-context-menu");
    expect(within(menu).getByTestId("calendar-deadline-context-edit")).toBeTruthy();
    expect(within(menu).getByTestId("calendar-deadline-context-delete")).toBeTruthy();
    expect(within(menu).queryByTestId("calendar-deadline-context-complete")).toBeNull();
  });

  it("routes a desktop deadline drag to the Dashboard deadline action boundary", async () => {
    const onMoveTask = vi.fn();
    renderDeadlineModal({
      deadlines: [{
        id: "todo-drag",
        title: "Move planning task",
        due_date: "2026-04-20",
        due_time: "3:00 PM",
        is_recurring: false,
        status: "incomplete",
      }],
      deadlineActions: { onMoveTask },
    });

    const dataTransfer = {
      effectAllowed: "",
      getData: vi.fn((type: string) => type === "application/x-ea-calendar-deadline"
        ? JSON.stringify({
            id: "todo-drag",
            due_date: "2026-04-20",
            due_time: "3:00 PM",
            is_recurring: false,
            status: "incomplete",
          })
        : ""),
      setData: vi.fn(),
    };
    const sourceChip = await screen.findByTestId("calendar-cell-item-chip");
    expect(sourceChip.getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(sourceChip, { dataTransfer });
    const targetCell = screen.getByTestId("calendar-cell-21");
    fireEvent.dragEnter(targetCell, { dataTransfer });
    expect(targetCell.getAttribute("data-drop-target")).toBe("true");
    fireEvent.drop(targetCell, { dataTransfer });

    // test-architecture: allow-boundary-interaction -- Calendar forwards the rendered drag result to the Dashboard deadline mutation boundary.
    await waitFor(() => expect(onMoveTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "todo-drag", due_time: "3:00 PM" }),
      "2026-04-21",
    ));
  });

  it("dismisses the context menu on an outside pointerdown", async () => {
    renderDeadlineModal({
      deadlines: [{
        id: "todo-outside-dismiss",
        title: "Renew parking permit",
        due_date: "2026-04-20",
        status: "incomplete",
      }],
    });

    fireEvent.contextMenu(await screen.findByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });
    expect(await screen.findByTestId("calendar-deadline-context-menu")).toBeTruthy();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-deadline-context-menu")).toBeNull();
    });
  });

  it("dismisses the context menu on Escape", async () => {
    renderDeadlineModal({
      deadlines: [{
        id: "todo-escape-dismiss",
        title: "Renew parking permit",
        due_date: "2026-04-20",
        status: "incomplete",
      }],
    });

    fireEvent.contextMenu(await screen.findByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });
    expect(await screen.findByTestId("calendar-deadline-context-menu")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-deadline-context-menu")).toBeNull();
    });
  });
});
