import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardItemDetailSheet from "./DashboardItemDetailSheet";
import { DashboardProvider } from "../../context/DashboardContext";
import type { ComponentProps } from "react";

let mobile = true;
// AddTaskPanel (mounted while editing a deadline) fetches projects/labels/reminders on mount.
// test-architecture: allow-boundary-mock -- deadline editor integration crosses the authenticated browser HTTP boundary; controlled empty provider data keeps the real editor and dashboard sheet mounted together.
vi.mock("@/api", () => ({
  getTodoistProjects: () => Promise.resolve([]),
  getTodoistLabels: () => Promise.resolve([]),
  listReminders: () => Promise.resolve([]),
  createDeadline: () => Promise.resolve({}),
  updateDeadline: () => Promise.resolve({}),
  deleteDeadline: () => Promise.resolve({}),
  createReminder: () => Promise.resolve({}),
  deleteReminder: () => Promise.resolve({}),
}));

beforeEach(() => {
  mobile = true;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? mobile : false,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSheet(props: ComponentProps<typeof DashboardItemDetailSheet>) {
  return render(
    <DashboardProvider deadlines={{ upcoming: [], stats: null }} setCalendarDeadlines={() => {}}>
      <DashboardItemDetailSheet {...props} />
    </DashboardProvider>,
  );
}

describe("DashboardItemDetailSheet", () => {
  const deadline = { id: "t1", title: "Submit report", status: "open", due_date: "2026-07-15", priority: 1, url: "https://todoist.com/app/task/1" };





  it("does not dismiss the dashboard detail when interacting with its deadline editor", async () => {
    mobile = false;
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    renderSheet({ kind: "deadline", item: deadline, anchorRef: { current: anchor }, onClose: () => {}, onOpenInCalendar: () => {} });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const taskTitle = await screen.findByRole("textbox", { name: "Task title" });
    fireEvent.pointerDown(taskTitle);

    expect(screen.getByRole("dialog", { name: "Edit deadline" })).toBeTruthy();

    anchor.remove();
  });
});
