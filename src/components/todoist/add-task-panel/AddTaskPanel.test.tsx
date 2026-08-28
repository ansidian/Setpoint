import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef, useState } from "react";
import AddTaskPanel from "../AddTaskPanel";
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

// test-architecture: allow-boundary-mock -- src/api.ts is the client/server Todoist boundary; provider responses stay deterministic.
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
  const [lastTaskEvent, setLastTaskEvent] = useState("");

  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    anchorRef.current.getBoundingClientRect = () => new DOMRect(140, 120, 120, 36);
  }, []);

  return (
    <div>
      <button ref={anchorRef} type="button">anchor</button>
      <output aria-label="Last task event">{lastTaskEvent}</output>
      <AddTaskPanel
        anchorRef={anchorRef}
        onClose={() => {}}
        {...props}
        onTaskAdded={(task) => { setLastTaskEvent(`added:${JSON.stringify(task)}`); props.onTaskAdded?.(task); }}
        onTaskUpdated={(task) => { setLastTaskEvent(`updated:${JSON.stringify(task)}`); props.onTaskUpdated?.(task); }}
        onTaskDeleted={(id) => { setLastTaskEvent(`deleted:${id}`); props.onTaskDeleted?.(id); }}
      />
    </div>
  );
}

describe("AddTaskPanel behaviors", () => {
  // Warm the shared lazy chrono singleton before fake timers so NLP behavior is
  // independent of shuffled test order.
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
    mockCreateDeadline.mockResolvedValueOnce({
      id: "todo-new",
      title: "Call dentist",
      due_date: "2026-04-20",
      due_time: "10:00 AM",
      class_name: "Inbox",
      url: "https://todoist.example/todo-new",
    });

    render(<PanelHarness />);
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Call dentist tomorrow at 10am" },
    });
    fireEvent.click(screen.getByTestId("todoist-reminder-preset-0"));
    expect(screen.getByTestId("todoist-reminder-chip").textContent).toContain("At start");

    fireEvent.click(screen.getByText("Add task"));
    await vi.runAllTimersAsync();

    // test-architecture: allow-boundary-interaction -- the created Todoist title and due string are the outbound client/server payload; closing the panel cannot expose malformed request fields.
    expect(mockCreateDeadline).toHaveBeenCalledWith(expect.objectContaining({
      title: "Call dentist",
      dueString: "2026-04-20 at 10 AM",
    }));
    // test-architecture: allow-boundary-interaction -- reminder anchor, task identity, and offset are the persisted outbound reminder contract and have no independent DOM projection.
    expect(mockCreateReminder).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "todoist_task",
      sourceItemId: "todo-new",
      anchorKind: "todoist_due_datetime",
      anchorAt: "2026-04-20T17:00:00.000Z",
      offsetMinutes: 0,
    }));
    expect(screen.getByLabelText("Last task event").textContent).toContain('"hasUpcomingReminder":true');
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

    // test-architecture: allow-boundary-interaction -- reminder loading must query the exact Todoist task identity; rendered chips cannot reveal a mis-scoped provider request.
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

    // test-architecture: allow-boundary-interaction -- the manual due string is an outbound Todoist mutation field with no post-submit DOM projection.
    expect(mockCreateDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Send invoice",
        dueString: "2026-04-19 at 10:01 AM",
      }),
    );
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

    // test-architecture: allow-boundary-interaction -- edit identity and due payload are the outbound Todoist update contract; the editor closes after success.
    expect(mockUpdateDeadline).toHaveBeenCalledWith(
      "todo-1",
      expect.objectContaining({
        title: "Follow up",
        dueString: "2026-04-21 at 2:30 PM",
      }),
    );
  });

  it("supports the inline host and seeds a selected calendar day for new tasks", async () => {
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

    expect(screen.getByTestId("todoist-draft-preview-summary").textContent).toContain("April 22, 2026 · 9 AM");

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Plan sprint" },
    });
    fireEvent.click(screen.getByText("Add task"));
    await vi.runAllTimersAsync();

    // test-architecture: allow-boundary-interaction -- the seeded calendar day must cross the client/server mutation boundary as the exact due string.
    expect(mockCreateDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Plan sprint",
        dueString: "2026-04-22 at 9:00 AM",
      }),
    );
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

    // test-architecture: allow-boundary-interaction -- selected project, priority, and label IDs are outbound Todoist payload fields not recoverable from the closed editor.
    expect(mockCreateDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Submit lab notes",
        projectId: "school",
        priority: 2,
        labelIds: ["lab"],
      }),
    );
  });




  it("uses inline Confirm / Cancel controls when cancelling a dirty workspace", () => {
    function CloseHarness() {
      const [open, setOpen] = useState(true);
      return <>{open ? <AddTaskPanel host="inline" confirmDirtyCloseInline onClose={() => setOpen(false)} onTaskAdded={() => {}} onTaskUpdated={() => {}} onTaskDeleted={() => {}} /> : <output>Editor closed</output>}</>;
    }
    render(<CloseHarness />);
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), { target: { value: "Changed task" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(screen.queryByText("Editor closed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Add task" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(screen.getByText("Editor closed")).toBeTruthy();
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
        onTaskDeleted={() => {}}
      />,
    );
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByTestId("todoist-delete"));
    // test-architecture: allow-boundary-interaction -- the first click must not issue the destructive Todoist delete before explicit confirmation.
    expect(mockDeleteDeadline).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByTestId("todoist-delete-confirm")).toBeTruthy();

    fireEvent.click(screen.getByTestId("todoist-delete-confirm"));
    await vi.runAllTimersAsync();

    // test-architecture: allow-boundary-interaction -- confirmed deletion must target the exact provider task ID; removal leaves no remaining editor state to inspect.
    expect(mockDeleteDeadline).toHaveBeenCalledWith("todo-delete");
  });
});
