import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef } from "react";
import AddTaskPanel from "../AddTaskPanel";
import useAddTaskPanelController from "./useAddTaskPanelController";
import { ensureChrono } from "../../calendar/events/parseCalendarTitle";
import { invalidateTodoistReferenceCache } from "./todoistReferenceCache";
import type { AddTaskPanelProps } from "./types";
import type * as Api from "../../../api";

const mockCreateDeadline = vi.fn();
const mockUpdateDeadline = vi.fn();
const mockGetTodoistProjects = vi.fn();
const mockGetTodoistLabels = vi.fn();
const mockDeleteDeadline = vi.fn();
const mockListReminders = vi.fn();
const mockCreateReminder = vi.fn();
const mockDeleteReminder = vi.fn();

vi.mock("../../../api", () => ({
  createDeadline: (...args: Parameters<typeof Api.createDeadline>) => mockCreateDeadline(...args),
  updateDeadline: (...args: Parameters<typeof Api.updateDeadline>) => mockUpdateDeadline(...args),
  getTodoistProjects: (...args: Parameters<typeof Api.getTodoistProjects>) => mockGetTodoistProjects(...args),
  getTodoistLabels: (...args: Parameters<typeof Api.getTodoistLabels>) => mockGetTodoistLabels(...args),
  deleteDeadline: (...args: Parameters<typeof Api.deleteDeadline>) => mockDeleteDeadline(...args),
  listReminders: (...args: Parameters<typeof Api.listReminders>) => mockListReminders(...args),
  createReminder: (...args: Parameters<typeof Api.createReminder>) => mockCreateReminder(...args),
  deleteReminder: (...args: Parameters<typeof Api.deleteReminder>) => mockDeleteReminder(...args),
}));

beforeEach(() => {
  invalidateTodoistReferenceCache();
});

function PanelHarness(props: Omit<Partial<AddTaskPanelProps>, "anchorRef" | "onClose"> = {}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    anchorRef.current.getBoundingClientRect = () => new DOMRect(140, 120, 120, 36);
  }, []);

  return (
    <div>
      <button ref={anchorRef} type="button">anchor</button>
      <AddTaskPanel
        anchorRef={anchorRef}
        onClose={() => {}}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
        {...props}
      />
    </div>
  );
}

// The submit failure paths (provider-create rejection, reminder-create rejection)
// settle their error state across several promise-resolution + React-commit ticks.
// A single `runAllTimersAsync` flushes that chain only when a sibling test has
// already warmed the path; run cold (or under shuffled order) it can return with
// the `setError`/`setReminderError` re-render still pending, so the error notice
// is not yet in the DOM. Flush repeatedly until the timer/microtask queue is
// fully drained so these tests assert on a settled UI regardless of order.
async function flushSubmitSettled() {
  for (let i = 0; i < 5; i += 1) {
    await vi.runAllTimersAsync();
  }
}

describe("AddTaskPanel due picker", () => {
  // The NLP/recurring path (controller -> add-task-panel/parsing) reuses the
  // same lazily-imported chrono-node singleton as the calendar editor
  // (../../calendar/events/parseCalendarTitle). parsing.ts calls the
  // SYNCHRONOUS parseCalendarTitle, which only returns the full natural-language
  // result once chrono has finished loading; a cold singleton degrades to "no
  // temporal match", so the recurring `due_string`/preview is wrong. The
  // singleton persists across files/tests and is only warm if an earlier test
  // already triggered NLP parsing — under shuffled full-suite order this test can
  // run cold. Warm it once here so the whole file is order-independent. beforeAll
  // runs before beforeEach installs fake timers, so the dynamic import resolves on
  // real timers.
  beforeAll(async () => {
    await ensureChrono();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T17:00:10.000Z"));
    mockCreateDeadline.mockResolvedValue({ id: "todo-new" });
    mockUpdateDeadline.mockResolvedValue({ id: "todo-1" });
    mockGetTodoistProjects.mockResolvedValue([]);
    mockGetTodoistLabels.mockResolvedValue([]);
    mockDeleteDeadline.mockResolvedValue({});
    mockListReminders.mockResolvedValue({ reminders: [] });
    mockCreateReminder.mockResolvedValue({ reminder: { id: "rem-created" } });
    mockDeleteReminder.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("flushes pending Todoist reminders only after provider task creation succeeds", async () => {
    const onTaskAdded = vi.fn();
    mockCreateDeadline.mockResolvedValueOnce({
      id: "todo-new",
      title: "Call dentist",
      due_date: "2026-04-20",
      due_time: "10:00 AM",
      class_name: "Inbox",
      url: "https://todoist.example/todo-new",
    });

    render(<PanelHarness onTaskAdded={onTaskAdded} />);
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Call dentist tomorrow at 10am" },
    });
    fireEvent.click(screen.getByTestId("todoist-reminder-preset-30"));
    expect(screen.getByTestId("todoist-reminder-chip").textContent).toContain("30 minutes before");

    fireEvent.click(screen.getByText("Add task"));
    await vi.runAllTimersAsync();

    expect(mockCreateDeadline).toHaveBeenCalledWith(expect.objectContaining({
      title: "Call dentist",
      dueString: "2026-04-20 at 10 AM",
    }));
    expect(mockCreateReminder).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "todoist_task",
      sourceItemId: "todo-new",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-04-20T17:00:00.000Z",
      offsetMinutes: -30,
    }));
    expect(onTaskAdded).toHaveBeenCalledWith(expect.objectContaining({
      id: "todo-new",
      hasUpcomingReminder: true,
      upcomingReminderCount: 1,
      nextReminderAt: "2026-04-20T16:30:00.000Z",
      reminderState: {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt: "2026-04-20T16:30:00.000Z",
      },
    }));
  });

  it("does not create pending reminders when provider task creation fails", async () => {
    mockCreateDeadline.mockRejectedValueOnce(new Error("Todoist unavailable"));

    render(<PanelHarness />);
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Call dentist tomorrow at 10am" },
    });
    fireEvent.click(screen.getByTestId("todoist-reminder-preset-30"));
    fireEvent.click(screen.getByText("Add task"));
    await flushSubmitSettled();

    expect(mockCreateDeadline).toHaveBeenCalled();
    expect(mockCreateReminder).not.toHaveBeenCalled();
    expect(screen.getByText("Todoist unavailable")).toBeTruthy();
  });

  it("does not re-create the task on retry after a reminder failure (no duplicate)", async () => {
    mockCreateDeadline.mockResolvedValueOnce({
      id: "todo-new",
      title: "Call dentist",
      due_date: "2026-04-20",
      due_time: "10:00 AM",
      class_name: "Inbox",
    });
    // The reminder create throws on the first attempt, after the task is created.
    mockCreateReminder.mockRejectedValueOnce(new Error("Reminder service down"));

    render(<PanelHarness />);
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Call dentist tomorrow at 10am" },
    });
    fireEvent.click(screen.getByTestId("todoist-reminder-preset-30"));

    // First submit: task is created, reminder create fails. Per P3-29 the deadline
    // is already committed, so reminder failures are collected (not thrown) and the
    // panel stays open with a "task saved, reminders failed" notice instead of the
    // raw error. P2-14's no-duplicate-on-retry guarantee (below) is unaffected.
    fireEvent.click(screen.getByText("Add task"));
    await flushSubmitSettled();
    expect(mockCreateDeadline).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Task saved, but reminders could not be updated.")).toBeTruthy();

    // Retry: must UPDATE the already-committed task, never create a second one.
    fireEvent.click(screen.getByText("Add task"));
    await flushSubmitSettled();
    expect(mockCreateDeadline).toHaveBeenCalledTimes(1);
    expect(mockUpdateDeadline).toHaveBeenCalledWith("todo-new", expect.objectContaining({
      title: "Call dentist",
    }));
  });

  it("loads existing reminders when editing a Todoist task", async () => {
    mockListReminders.mockResolvedValueOnce({
      reminders: [
        { id: "rem-sent", offset_minutes: -60, status: "sent" },
        { id: "rem-pending", offset_minutes: -30, status: "pending" },
      ],
    });

    render(
      <PanelHarness
        editingTask={{
          id: "todo-1",
          title: "Follow up",
          description: "",
          class_name: "Inbox",
          priority: 4,
          labels: [],
          due_date: "2026-04-21",
          due_time: "2:30 PM",
        }}
      />,
    );
    await vi.runAllTimersAsync();

    expect(mockListReminders).toHaveBeenCalledWith({
      sourceType: "todoist_task",
      sourceItemId: "todo-1",
    });
    expect(screen.getAllByTestId("todoist-reminder-chip").map((chip) => chip.textContent)).toEqual([
      expect.stringContaining("1 hour before"),
      expect.stringContaining("30 minutes before"),
    ]);
    expect(screen.getAllByTestId("todoist-reminder-chip")[0]!.textContent).toContain("sent");
  });

  it("submits a manual due_string when creating a task", async () => {
    render(<PanelHarness />);
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Send invoice" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Set due date" }));
    vi.runOnlyPendingTimers();
    const picker = screen.getByRole("dialog", { name: "Todoist due date picker" });
    fireEvent.click(within(picker).getByRole("button", { name: "Set due date" }));
    fireEvent.click(screen.getByText("Add task"));
    await vi.runAllTimersAsync();

    expect(mockCreateDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Send invoice",
        dueString: "2026-04-19 at 10:01 AM",
      }),
    );
  });

  it("allows creating a task with an overdue manual due date", async () => {
    render(<PanelHarness />);
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Backfill notes" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Set due date" }));
    vi.runOnlyPendingTimers();
    const picker = screen.getByRole("dialog", { name: "Todoist due date picker" });
    const pastDay = within(picker).getByRole("button", { name: "18" });

    expect((pastDay as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(pastDay);
    fireEvent.click(within(picker).getByRole("button", { name: "Set due date" }));
    fireEvent.click(screen.getByText("Add task"));
    await vi.runAllTimersAsync();

    expect(mockCreateDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Backfill notes",
        dueString: "2026-04-18 at 10:01 AM",
      }),
    );
  });

  it("submits parsed overdue NLP times as explicit Todoist due strings", async () => {
    vi.setSystemTime(new Date("2026-04-20T19:45:00.000Z"));
    render(<PanelHarness />);
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Backfill notes today at 9am" },
    });

    expect(screen.getByText("Today, Apr 20 at 9 AM")).toBeTruthy();

    fireEvent.click(screen.getByText("Add task"));
    await vi.runAllTimersAsync();

    expect(mockCreateDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Backfill notes",
        dueString: "2026-04-20 at 9 AM",
      }),
    );
  });

  it("submits recurring NLP as cleaned content plus Todoist due_string", async () => {
    render(<PanelHarness />);
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Water plants every weekday at 9am !2" },
    });

    expect(screen.getByTestId("todoist-recurring-preview").textContent).toContain("Every Mon, Tue, Wed, Thu, Fri at 9 AM");

    fireEvent.click(screen.getByText("Add task"));
    await vi.runAllTimersAsync();

    expect(mockCreateDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Water plants",
        priority: 2,
        dueString: "every weekday at 9am",
      }),
    );
  });

  it("toggles the due picker closed when the due trigger is clicked again", () => {
    render(<PanelHarness />);
    vi.runOnlyPendingTimers();

    const trigger = screen.getByRole("button", { name: "Set due date" });
    fireEvent.click(trigger);
    vi.runOnlyPendingTimers();
    expect(screen.getByRole("dialog", { name: "Todoist due date picker" })).toBeTruthy();

    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog", { name: "Todoist due date picker" })).toBeNull();
  });

  it("seeds edit mode from the existing due date and sends the updated due_string", async () => {
    render(
      <PanelHarness
        editingTask={{
          id: "todo-1",
          title: "Follow up",
          description: "",
          class_name: "Inbox",
          priority: 4,
          labels: [],
          due_date: "2026-04-21",
          due_time: "2:30 PM",
        }}
      />,
    );
    vi.runOnlyPendingTimers();

    expect(screen.getByText("Tuesday, Apr 21 at 2:30 PM")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Set due date" }));
    vi.runOnlyPendingTimers();
    const picker = screen.getByRole("dialog", { name: "Todoist due date picker" });
    fireEvent.click(within(picker).getByRole("button", { name: "Set due date" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.runAllTimersAsync();

    expect(mockUpdateDeadline).toHaveBeenCalledWith(
      "todo-1",
      expect.objectContaining({
        title: "Follow up",
        dueString: "2026-04-21 at 2:30 PM",
      }),
    );
  });

  it("preserves retained Todoist reminders after an edit without explicit reminder changes", async () => {
    const onTaskUpdated = vi.fn();
    mockListReminders.mockResolvedValueOnce({
      reminders: [
        { id: "at-start", offset_minutes: 0, remind_at: "2026-04-21T21:30:00.000Z", status: "pending" },
      ],
    });
    mockUpdateDeadline.mockResolvedValueOnce({
      id: "todo-1",
      title: "Follow up",
      due_date: "2026-04-21",
      due_time: "3:30 PM",
    });

    render(
      <PanelHarness
        onTaskUpdated={onTaskUpdated}
        editingTask={{
          id: "todo-1",
          title: "Follow up",
          description: "",
          class_name: "Inbox",
          priority: 4,
          labels: [],
          due_date: "2026-04-21",
          due_time: "2:30 PM",
        }}
      />,
    );
    await vi.runAllTimersAsync();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.runAllTimersAsync();

    expect(onTaskUpdated).toHaveBeenCalledWith(expect.objectContaining({
      id: "todo-1",
      hasUpcomingReminder: true,
      upcomingReminderCount: 1,
      nextReminderAt: "2026-04-21T22:30:00.000Z",
      reminderState: {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt: "2026-04-21T22:30:00.000Z",
      },
    }));
  });

  it("supports the inline host and seeds a selected calendar day for new tasks", async () => {
    const onDraftPreviewChange = vi.fn();
    render(
      <AddTaskPanel
        host="inline"
        initialDueDate="2026-04-22"
        onClose={() => {}}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
        onDraftPreviewChange={onDraftPreviewChange}
      />,
    );
    vi.runOnlyPendingTimers();

    expect(screen.getByTestId("todoist-draft-preview-summary").textContent).toContain("April 22, 2026 · 9 AM");
    expect(onDraftPreviewChange).toHaveBeenCalledWith(expect.objectContaining({
      dueDate: "2026-04-22",
      placementChanged: true,
    }));

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Plan sprint" },
    });
    fireEvent.click(screen.getByText("Add task"));
    await vi.runAllTimersAsync();

    expect(mockCreateDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Plan sprint",
        dueString: "2026-04-22 at 9:00 AM",
      }),
    );
  });

  it("uses the slim event-workspace layout for inline deadline editing", async () => {
    mockGetTodoistProjects.mockResolvedValue([
      { id: "inbox", name: "Inbox", isInbox: true },
      { id: "school", name: "School", color: "#89b4fa" },
    ]);
    mockGetTodoistLabels.mockResolvedValue([
      { id: "urgent", name: "urgent" },
    ]);

    render(
      <AddTaskPanel
        host="inline"
        initialDueDate="2026-04-22"
        onClose={() => {}}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
      />,
    );
    vi.runOnlyPendingTimers();

    const editor = screen.getByTestId("todoist-inline-editor");
    expect(screen.getByTestId("todoist-compact-toolbar")).toBeTruthy();
    expect(screen.getByTestId("todoist-due-trigger")).toBeTruthy();
    expect(screen.getByTestId("todoist-project-trigger")).toBeTruthy();
    expect(screen.getByTestId("todoist-priority-trigger")).toBeTruthy();
    expect(screen.getByTestId("todoist-labels-trigger")).toBeTruthy();
    expect(within(screen.getByTestId("todoist-compact-toolbar")).queryByText(/April 22|Apr 22|2026-04-22/i)).toBeNull();
    expect(within(editor).queryByText("Description")).toBeNull();
    expect(within(editor).queryByText("Due")).toBeNull();
    expect(within(editor).queryByText("Labels")).toBeNull();
  });

  it("keeps project, priority, and labels editable from compact controls", async () => {
    mockGetTodoistProjects.mockResolvedValue([
      { id: "inbox", name: "Inbox", isInbox: true },
      { id: "school", name: "School", color: "#89b4fa" },
    ]);
    mockGetTodoistLabels.mockResolvedValue([
      { id: "lab", name: "lab" },
    ]);

    render(
      <AddTaskPanel
        host="inline"
        onClose={() => {}}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
      />,
    );
    await vi.runAllTimersAsync();
    screen.getByTestId("todoist-project-trigger");

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Submit lab notes" },
    });
    fireEvent.click(screen.getByTestId("todoist-project-trigger"));
    fireEvent.click(screen.getByRole("option", { name: "School" }));
    fireEvent.click(screen.getByTestId("todoist-priority-trigger"));
    fireEvent.click(screen.getByRole("option", { name: "P2 High" }));
    fireEvent.click(screen.getByTestId("todoist-labels-trigger"));
    fireEvent.click(screen.getByRole("option", { name: "lab" }));
    fireEvent.click(screen.getByText("Add task"));
    await vi.runAllTimersAsync();

    expect(mockCreateDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Submit lab notes",
        projectId: "school",
        priority: 2,
        labelIds: ["lab"],
      }),
    );
  });

  it("suppresses unchanged edit previews until the due placement changes", () => {
    const onDraftPreviewChange = vi.fn();

    render(
      <AddTaskPanel
        host="inline"
        editingTask={{
          id: "todo-1",
          title: "Follow up",
          description: "",
          class_name: "Inbox",
          priority: 4,
          labels: [],
          due_date: "2026-04-21",
          due_time: "2:30 PM",
        }}
        onClose={() => {}}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
        onDraftPreviewChange={onDraftPreviewChange}
      />,
    );
    vi.runOnlyPendingTimers();

    expect(screen.queryByTestId("todoist-draft-preview-summary")).toBeNull();
    expect(onDraftPreviewChange).toHaveBeenCalledWith(expect.objectContaining({
      dueDate: "2026-04-21",
      placementChanged: false,
    }));

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Follow up tomorrow at 9am" },
    });

    expect(screen.getByTestId("todoist-draft-preview-summary").textContent).toContain("April 20, 2026 · 9 AM");
    expect(onDraftPreviewChange).toHaveBeenLastCalledWith(expect.objectContaining({
      dueDate: "2026-04-20",
      dueTime: "9 AM",
      placementChanged: true,
    }));
  });

  it("keeps original due metadata visible when an edit draft changes due placement", () => {
    render(
      <AddTaskPanel
        host="inline"
        editingTask={{
          id: "todo-1",
          title: "Follow up",
          description: "",
          class_name: "Inbox",
          priority: 4,
          labels: [],
          due_date: "2026-04-21",
          due_time: "2:30 PM",
        }}
        onClose={() => {}}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
      />,
    );
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Follow up tomorrow at 9am" },
    });

    expect(screen.getByTestId("todoist-draft-preview-summary").textContent).toContain("April 20, 2026 · 9 AM");
    const metadata = screen.getByTestId("todoist-edit-metadata");
    const originalDueChip = within(metadata).getByText("April 21, 2026 · 2:30 PM");
    expect(originalDueChip.style.flex).toBe("0 0 auto");
    expect(metadata.textContent).toContain("April 21, 2026 · 2:30 PM");
    expect(metadata.textContent).not.toContain("April 20, 2026 · 9 AM");
  });

  it("shows existing Todoist metadata as edit-only chips when no draft preview is needed", () => {
    render(
      <AddTaskPanel
        host="inline"
        editingTask={{
          id: "todo-1",
          title: "Follow up",
          description: "",
          class_name: "Inbox",
          priority: 4,
          labels: ["IHSS"],
          due_date: "2026-04-21",
          due_time: "2:30 PM",
        }}
        onClose={() => {}}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
      />,
    );
    vi.runOnlyPendingTimers();

    expect(screen.queryByTestId("todoist-draft-preview-summary")).toBeNull();
    const metadata = screen.getByTestId("todoist-edit-metadata");
    expect(metadata.textContent).toContain("April 21, 2026 · 2:30 PM");
    expect(metadata.textContent).toContain("Inbox");
    expect(metadata.textContent).toContain("P4");
    expect(metadata.textContent).toContain("IHSS");
  });

  it("shows a quiet no-due metadata chip for edits without a due date", () => {
    render(
      <AddTaskPanel
        host="inline"
        editingTask={{
          id: "todo-no-due",
          title: "Follow up",
          description: "",
          labels: [],
        }}
        onClose={() => {}}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
      />,
    );
    vi.runOnlyPendingTimers();

    expect(screen.queryByTestId("todoist-draft-preview-summary")).toBeNull();
    const metadata = screen.getByTestId("todoist-edit-metadata");
    expect(metadata.textContent).toContain("No due date");
    expect(metadata.textContent).not.toContain("No labels");
    expect(metadata.textContent).not.toContain("No priority");
  });

  it("uses inline cancel actions instead of the floating close chrome", () => {
    render(
      <AddTaskPanel
        host="inline"
        editingTask={{
          id: "todo-1",
          title: "Follow up",
          description: "",
          class_name: "Inbox",
          priority: 4,
          labels: [],
          due_date: "2026-04-21",
          due_time: "2:30 PM",
        }}
        onClose={() => {}}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
      />,
    );
    vi.runOnlyPendingTimers();

    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByLabelText("Close")).toBeNull();
    expect(screen.queryByText(/Esc to cancel/i)).toBeNull();
  });

  it("closes the inline editor immediately when cancel is pressed", () => {
    const onClose = vi.fn();

    render(
      <AddTaskPanel
        host="inline"
        onClose={onClose}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
      />,
    );
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses inline Confirm / Cancel controls when cancelling a dirty workspace", () => {
    const onClose = vi.fn();
    const confirmSpy = vi.fn();
    vi.stubGlobal("confirm", confirmSpy);

    render(
      <AddTaskPanel
        host="inline"
        confirmDirtyCloseInline
        onClose={onClose}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
      />,
    );
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), { target: { value: "Changed task" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Add task" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("does not prevent downward wheel input while the description can still scroll", () => {
    render(
      <AddTaskPanel
        host="inline"
        descriptionVariant="email-context"
        initialDescription={Array.from({ length: 20 }, (_, index) => `Context line ${index + 1}`).join("\n")}
        onClose={() => {}}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
      />,
    );
    vi.runOnlyPendingTimers();

    const panel = screen.getByTestId("todoist-inline-editor");
    const description = screen.getByRole("textbox", { name: "Task description" });
    Object.defineProperties(panel, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    Object.defineProperties(description, {
      scrollHeight: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });

    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 });
    description.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(false);
  });

  it("uses a two-step delete confirmation instead of hold-to-delete", async () => {
    const onTaskDeleted = vi.fn();

    render(
      <AddTaskPanel
        host="inline"
        editingTask={{
          id: "todo-delete",
          title: "Remove me",
          description: "",
          class_name: "Inbox",
          priority: 4,
          labels: [],
          due_date: "2026-04-21",
          due_time: "2:30 PM",
        }}
        onClose={() => {}}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={onTaskDeleted}
      />,
    );
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByTestId("todoist-delete"));
    expect(mockDeleteDeadline).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByTestId("todoist-delete-confirm")).toBeTruthy();

    fireEvent.click(screen.getByTestId("todoist-delete-confirm"));
    await vi.runAllTimersAsync();

    expect(mockDeleteDeadline).toHaveBeenCalledWith("todo-delete");
    expect(onTaskDeleted).toHaveBeenCalledWith("todo-delete");
  });
});

describe("useAddTaskPanelController seeding", () => {
  beforeEach(() => {
    mockGetTodoistProjects.mockResolvedValue([]);
    mockGetTodoistLabels.mockResolvedValue([]);
    mockListReminders.mockResolvedValue({ reminders: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("seeds a NEW task's title/description from initialInput/initialDescription", () => {
    const { result } = renderHook(() =>
      useAddTaskPanelController({
        host: "floating",
        onClose: () => {},
        initialInput: "Buy a standing-desk mat",
        initialDescription: "the cheap ones flatten out fast",
      }),
    );
    expect(result.current.input).toBe("Buy a standing-desk mat");
    expect(result.current.description).toBe("the cheap ones flatten out fast");
    expect(result.current.isEdit).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it("expands email context, removes native resizing, and exposes description URLs as links", () => {
    render(<PanelHarness
      host="inline"
      descriptionVariant="email-context"
      initialDescription={"From: Sender\nSource: https://mail.google.com/mail/u/0/#inbox/message"}
    />);

    const description = screen.getByRole("textbox", { name: "Task description" }) as HTMLTextAreaElement;
    expect(description.getAttribute("rows")).toBe("7");
    expect(description.style.minHeight).toBe("152px");
    expect(description.style.maxHeight).toBe("240px");
    expect(description.style.overflowY).toBe("auto");
    expect(description.style.resize).toBe("none");
    expect(screen.getByRole("link", { name: "https://mail.google.com/mail/u/0/#inbox/message" }).getAttribute("href"))
      .toBe("https://mail.google.com/mail/u/0/#inbox/message");
  });

  it("requires an effective due value when the embedding flow requests one", () => {
    const withoutDue = renderHook(() => useAddTaskPanelController({
      host: "floating", onClose: () => {}, initialInput: "Follow up", requireDue: true,
    }));
    expect(withoutDue.result.current.canSubmit).toBe(false);
    withoutDue.unmount();
    const withDue = renderHook(() => useAddTaskPanelController({
      host: "floating", onClose: () => {}, initialInput: "Follow up", requireDue: true,
      initialDueEpochMs: Date.parse("2126-08-01T16:00:00Z"),
    }));
    expect(withDue.result.current.canSubmit).toBe(true);
  });

  it("enforces a required provenance suffix at submission even if it was removed from the editable description", async () => {
    mockCreateDeadline.mockResolvedValueOnce({ id: "todo-source", title: "Follow up" });
    const { result } = renderHook(() => useAddTaskPanelController({
      host: "floating", onClose: () => {}, initialInput: "Follow up", initialDescription: "Manual notes",
      requiredDescriptionSuffix: "Source: https://mail.google.com/mail/message",
    }));
    act(() => result.current.setDescription("Edited notes"));
    await result.current.handleSubmit();
    expect(mockCreateDeadline).toHaveBeenCalledWith(expect.objectContaining({
      description: "Edited notes\n\nSource: https://mail.google.com/mail/message",
    }));
  });
});
