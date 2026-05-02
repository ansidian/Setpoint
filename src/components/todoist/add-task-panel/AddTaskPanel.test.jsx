import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef } from "react";
import AddTaskPanel from "../AddTaskPanel";

const mockCreateTodoistTask = vi.fn();
const mockUpdateTodoistTask = vi.fn();
const mockGetTodoistProjects = vi.fn();
const mockGetTodoistLabels = vi.fn();
const mockDeleteTodoistTask = vi.fn();

vi.mock("../../../api", () => ({
  createTodoistTask: (...args) => mockCreateTodoistTask(...args),
  updateTodoistTask: (...args) => mockUpdateTodoistTask(...args),
  getTodoistProjects: (...args) => mockGetTodoistProjects(...args),
  getTodoistLabels: (...args) => mockGetTodoistLabels(...args),
  deleteTodoistTask: (...args) => mockDeleteTodoistTask(...args),
}));

function PanelHarness(props) {
  const anchorRef = useRef(null);

  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    anchorRef.current.getBoundingClientRect = () => ({
      left: 140,
      top: 120,
      right: 260,
      bottom: 156,
      width: 120,
      height: 36,
    });
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

describe("AddTaskPanel due picker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T17:00:10.000Z"));
    mockCreateTodoistTask.mockResolvedValue({ id: "todo-new" });
    mockUpdateTodoistTask.mockResolvedValue({ id: "todo-1" });
    mockGetTodoistProjects.mockResolvedValue([]);
    mockGetTodoistLabels.mockResolvedValue([]);
    mockDeleteTodoistTask.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
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

    expect(mockCreateTodoistTask).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Send invoice",
        due_string: "2026-04-19 at 10:01 AM",
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

    expect(pastDay.disabled).toBe(false);

    fireEvent.click(pastDay);
    fireEvent.click(within(picker).getByRole("button", { name: "Set due date" }));
    fireEvent.click(screen.getByText("Add task"));
    await vi.runAllTimersAsync();

    expect(mockCreateTodoistTask).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Backfill notes",
        due_string: "2026-04-18 at 10:01 AM",
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

    expect(mockCreateTodoistTask).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Backfill notes",
        due_string: "2026-04-20 at 9 AM",
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

    expect(mockCreateTodoistTask).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Water plants",
        priority: 2,
        due_string: "every weekday at 9am",
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

    expect(mockUpdateTodoistTask).toHaveBeenCalledWith(
      "todo-1",
      expect.objectContaining({
        content: "Follow up",
        due_string: "2026-04-21 at 2:30 PM",
      }),
    );
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

    expect(screen.getByTestId("todoist-draft-preview-summary").textContent).toMatch(/2026-04-22/);
    expect(onDraftPreviewChange).toHaveBeenCalledWith(expect.objectContaining({
      dueDate: "2026-04-22",
      placementChanged: true,
    }));

    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Plan sprint" },
    });
    fireEvent.click(screen.getByText("Add task"));
    await vi.runAllTimersAsync();

    expect(mockCreateTodoistTask).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Plan sprint",
        due_string: "2026-04-22 at 9:00 AM",
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

    expect(screen.getByTestId("todoist-draft-preview-summary").textContent).toMatch(/2026-04-20/);
    expect(onDraftPreviewChange).toHaveBeenLastCalledWith(expect.objectContaining({
      dueDate: "2026-04-20",
      dueTime: "9 AM",
      placementChanged: true,
    }));
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
    expect(mockDeleteTodoistTask).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByTestId("todoist-delete-confirm")).toBeTruthy();

    fireEvent.click(screen.getByTestId("todoist-delete-confirm"));
    await vi.runAllTimersAsync();

    expect(mockDeleteTodoistTask).toHaveBeenCalledWith("todo-delete");
    expect(onTaskDeleted).toHaveBeenCalledWith("todo-delete");
  });
});
