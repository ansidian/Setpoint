import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardItemDetailSheet from "./DashboardItemDetailSheet.jsx";

const handleCompleteTask = vi.fn();
vi.mock("../../context/DashboardContext", () => ({
  useDashboard: () => ({ handleCompleteTask, handleUpdateTask: vi.fn() }),
}));
// Force the bottom-sheet branch so the panel renders without desktop anchor math.
vi.mock("@/hooks/useIsMobile", () => ({ default: () => true }));

afterEach(() => { cleanup(); handleCompleteTask.mockClear(); });

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
});
