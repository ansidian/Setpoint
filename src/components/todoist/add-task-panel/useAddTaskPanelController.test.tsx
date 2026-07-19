import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef } from "react";
import AddTaskPanel from "../AddTaskPanel";
import useAddTaskPanelController from "./useAddTaskPanelController";
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
