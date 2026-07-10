import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardItemDetailSheet from "./DashboardItemDetailSheet.jsx";
import useIsMobile from "@/hooks/useIsMobile";

const handleCompleteTask = vi.fn();
const handleUpdateTask = vi.fn();
vi.mock("../../context/DashboardContext", () => ({
  useDashboard: () => ({ handleCompleteTask, handleUpdateTask }),
}));
// Force the bottom-sheet branch by default so the panel renders without desktop anchor math;
// individual tests override via useIsMobile.mockReturnValue(false) for the desktop contract.
vi.mock("@/hooks/useIsMobile", () => ({ default: vi.fn(() => true) }));
// AddTaskPanel (mounted while editing a deadline) fetches projects/labels/reminders on mount.
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

afterEach(() => {
  cleanup();
  handleCompleteTask.mockClear();
  handleUpdateTask.mockClear();
  useIsMobile.mockReturnValue(true);
});

describe("DashboardItemDetailSheet", () => {
  const deadline = { id: "t1", title: "Submit report", status: "open", due_date: "2026-07-15", priority: 1, url: "https://todoist.com/app/task/1" };

  it("renders a deadline with complete, edit, todoist, and open-in-calendar", () => {
    render(<DashboardItemDetailSheet kind="deadline" item={deadline} onClose={() => {}} onOpenInCalendar={() => {}} />);
    expect(screen.getByText("Submit report")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark complete" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in calendar" })).toBeTruthy();
  });

  it("routes Mark complete through the dashboard completer", () => {
    render(<DashboardItemDetailSheet kind="deadline" item={deadline} onClose={() => {}} onOpenInCalendar={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(handleCompleteTask).toHaveBeenCalledWith("t1", deadline);
  });

  it("fires the deep-link from Open in calendar", () => {
    const onOpenInCalendar = vi.fn();
    render(<DashboardItemDetailSheet kind="deadline" item={deadline} onClose={() => {}} onOpenInCalendar={onOpenInCalendar} />);
    fireEvent.click(screen.getByRole("button", { name: "Open in calendar" }));
    expect(onOpenInCalendar).toHaveBeenCalled();
  });

  it("renders a bill with its pay/actual links when urls resolve", () => {
    const bill = { id: "b1", scheduleId: "s1", name: "Electric", amount: 120, next_date: "2026-07-15", paid: false, type: "bill" };
    render(
      <DashboardItemDetailSheet
        kind="bill"
        item={bill}
        ctx={{ actualBudgetUrl: "https://actual.example", payLinksByScheduleId: { s1: "https://pay.example/s1" } }}
        onClose={() => {}}
        onOpenInCalendar={() => {}}
      />,
    );
    expect(screen.getByText("Electric")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Actual" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pay online" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in calendar" })).toBeTruthy();
  });

  it("renders an event with open-in-calendar and no edit", () => {
    const event = { id: "e1", title: "Standup", startMs: new Date("2026-07-15T17:00:00Z").getTime(), endMs: new Date("2026-07-15T17:30:00Z").getTime(), writable: true, eventType: "default" };
    render(<DashboardItemDetailSheet kind="event" item={event} onClose={() => {}} onOpenInCalendar={() => {}} />);
    expect(screen.getByText("Standup")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in calendar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("closes the glance sheet while the deadline editor is open on mobile, and reopens it on cancel (ARCH-04)", async () => {
    useIsMobile.mockReturnValue(true);
    render(<DashboardItemDetailSheet kind="deadline" item={deadline} onClose={() => {}} onOpenInCalendar={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Deadline" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("dialog", { name: "Deadline" })).toBeNull();

    // The editor has no in-panel Cancel button on mobile — it dismisses via
    // Escape/backdrop, same as any other overlay.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findByRole("dialog", { name: "Deadline" })).toBeTruthy();
  });

  it("keeps the anchored panel mounted while editing on desktop (unchanged contract)", () => {
    useIsMobile.mockReturnValue(false);
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(
      <DashboardItemDetailSheet
        kind="deadline"
        item={deadline}
        anchorRef={{ current: anchor }}
        onClose={() => {}}
        onOpenInCalendar={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Submit report")).toBeTruthy();

    anchor.remove();
  });
});
