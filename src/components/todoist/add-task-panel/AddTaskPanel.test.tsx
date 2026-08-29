import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef, useState } from "react";
import AddTaskPanel from "../AddTaskPanel";
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
        {...props}
        onTaskAdded={() => {}}
        onTaskUpdated={() => {}}
        onTaskDeleted={() => {}}
      />
    </div>
  );
}

describe("AddTaskPanel behaviors", () => {
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

  it("requires confirmation before discarding a dirty inline workspace", () => {
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
