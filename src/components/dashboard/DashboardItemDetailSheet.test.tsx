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

  it("renders a bill with its pay/actual links when urls resolve", () => {
    const bill = { id: "b1", scheduleId: "s1", name: "Electric", amount: 120, next_date: "2026-07-15", paid: false, type: "bill" };
    renderSheet({
      kind: "bill",
      item: bill,
      ctx: { actualBudgetUrl: "https://actual.example", payLinksByScheduleId: { s1: "https://pay.example/s1" } },
      onClose: () => {},
      onOpenInCalendar: () => {},
    });
    expect(screen.getByText("Electric")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Actual" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pay online" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in calendar" })).toBeTruthy();
  });

  it("renders an event with Edit Event first, followed by Open in Google Calendar", () => {
    const event = { id: "e1", title: "Standup", startMs: new Date("2026-07-15T17:00:00Z").getTime(), endMs: new Date("2026-07-15T17:30:00Z").getTime(), writable: true, eventType: "default", htmlLink: "https://calendar.google.com/event?eid=abc" };
    renderSheet({ kind: "event", item: event, onClose: () => {}, onOpenInCalendar: () => {} });
    expect(screen.getByText("Standup")).toBeTruthy();
    const editEvent = screen.getByRole("button", { name: "Edit Event" });
    const googleCalendar = screen.getByRole("link", { name: "Open in Google Calendar" });
    expect(editEvent.compareDocumentPosition(googleCalendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("closes the glance sheet while the deadline editor is open on mobile, and reopens it on cancel (ARCH-04)", async () => {
    mobile = true;
    renderSheet({ kind: "deadline", item: deadline, onClose: () => {}, onOpenInCalendar: () => {} });

    expect(screen.getByRole("dialog", { name: "Deadline" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("dialog", { name: "Deadline" })).toBeNull();

    // The editor has no in-panel Cancel button on mobile — it dismisses via
    // Escape/backdrop, same as any other overlay.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findByRole("dialog", { name: "Deadline" })).toBeTruthy();
  });

  it("keeps the anchored panel mounted while editing on desktop (unchanged contract)", () => {
    mobile = false;
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    renderSheet({ kind: "deadline", item: deadline, anchorRef: { current: anchor }, onClose: () => {}, onOpenInCalendar: () => {} });

    expect(screen.getByTestId("anchored-floating-panel-drag-handle").textContent).toContain("Deadline");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Submit report")).toBeTruthy();

    anchor.remove();
  });

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
