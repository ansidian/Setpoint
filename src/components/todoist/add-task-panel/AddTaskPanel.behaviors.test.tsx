import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef } from "react";
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

describe("AddTaskPanel rendered behaviors", () => {
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
  });

  it("seeds create mode from the initial title and description at the panel boundary", () => {
    render(
      <PanelHarness
        initialInput="Buy a standing-desk mat"
        initialDescription="the cheap ones flatten out fast"
      />,
    );
    vi.runOnlyPendingTimers();

    expect((screen.getByRole("textbox", { name: "Task title" }) as HTMLInputElement).value)
      .toBe("Buy a standing-desk mat");
    expect((screen.getByRole("textbox", { name: "Task description" }) as HTMLTextAreaElement).value)
      .toBe("the cheap ones flatten out fast");
  });

  it("keeps required-due create actions disabled until a due value exists", () => {
    render(<PanelHarness initialInput="Follow up" requireDue />);
    vi.runOnlyPendingTimers();

    expect((screen.getByRole("button", { name: "Add task" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("allows required-due create actions with a seeded due value", () => {
    render(
      <PanelHarness
        initialInput="Follow up"
        requireDue
        initialDueEpochMs={Date.parse("2026-04-20T16:00:00.000Z")}
      />,
    );
    vi.runOnlyPendingTimers();

    expect((screen.getByRole("button", { name: "Add task" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders email-context descriptions with their link affordances", () => {
    render(
      <PanelHarness
        host="inline"
        descriptionVariant="email-context"
        initialDescription={"From: Sender\nSource: https://mail.google.com/mail/u/0/#inbox/message"}
      />,
    );

    const description = screen.getByRole("textbox", { name: "Task description" }) as HTMLTextAreaElement;
    expect(description.getAttribute("rows")).toBe("7");
    expect(screen.getByRole("link", { name: "https://mail.google.com/mail/u/0/#inbox/message" }).getAttribute("href"))
      .toBe("https://mail.google.com/mail/u/0/#inbox/message");
  });

  it("keeps the panel open after a provider failure and supports retry", async () => {
    mockCreateDeadline
      .mockRejectedValueOnce(new Error("Todoist unavailable"))
      .mockResolvedValueOnce({ id: "todo-recovered", title: "Follow up" });

    render(<PanelHarness initialInput="Follow up" />);
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await vi.runAllTimersAsync();

    expect(screen.getByText("Todoist unavailable")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Task title" }) as HTMLInputElement).value).toBe("Follow up");

    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await vi.runAllTimersAsync();

    expect(screen.queryByText("Todoist unavailable")).toBeNull();
  });

  it("retains a required provenance suffix when submitting an edited description", async () => {
    render(
      <PanelHarness
        initialInput="Follow up"
        initialDescription="Manual notes"
        requiredDescriptionSuffix="Source: https://mail.google.com/mail/message"
      />,
    );
    vi.runOnlyPendingTimers();

    fireEvent.change(screen.getByRole("textbox", { name: "Task description" }), {
      target: { value: "Edited notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await vi.runAllTimersAsync();

    // test-architecture: allow-boundary-interaction -- submitted description is the public src/api.ts payload contract.
    expect(mockCreateDeadline).toHaveBeenCalledWith(expect.objectContaining({
      description: "Edited notes\n\nSource: https://mail.google.com/mail/message",
    }));
  });
});
