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
});
