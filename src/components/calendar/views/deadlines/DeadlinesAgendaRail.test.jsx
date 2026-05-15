import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeadlinesAgendaRail from "./DeadlinesAgendaRail.jsx";
import { compute } from "./deadlinesModel.js";

afterEach(() => {
  cleanup();
});

function renderRail(props = {}) {
  const data = {
    upcoming: [
      {
        id: "repeat-1",
        title: "Recurring review",
        due_date: "2026-05-05",
        due_time: "9:00 AM",
        project_name: "Ops",
        status: "open",
        is_recurring: true,
        hasUpcomingReminder: true,
        upcomingReminderCount: 2,
        nextReminderAt: "2026-05-09T15:30:00.000Z",
      },
      {
        id: "repeat-1",
        title: "Recurring review",
        due_date: "2026-05-09",
        due_time: "9:00 AM",
        project_name: "Ops",
        status: "open",
        is_recurring: true,
      },
      {
        id: "done-1",
        title: "Completed review",
        due_date: "2026-05-09",
        due_time: "10:00 AM",
        project_name: "Ops",
        status: "complete",
      },
    ],
  };

  return render(
    <DeadlinesAgendaRail
      viewYear={2026}
      viewMonth={4}
      currentYear={2026}
      currentMonth={4}
      todayDate={1}
      selectedDateKey="2026-05-09"
      computed={compute({ data, viewYear: 2026, viewMonth: 4 })}
      {...props}
    />,
  );
}

describe("DeadlinesAgendaRail", () => {
  it("keys deadline occurrence selection by id and due date", () => {
    const onDeadlineAction = vi.fn();
    renderRail({
      selectedItemId: "deadline:repeat-1:2026-05-09",
      onDeadlineAction,
    });

    const rows = screen.getAllByTestId("calendar-agenda-deadline-row");
    expect(rows.map((row) => row.getAttribute("data-item-id"))).toEqual([
      "deadline:repeat-1:2026-05-05",
      "deadline:repeat-1:2026-05-09",
      "deadline:done-1:2026-05-09",
    ]);
    expect(rows[0].getAttribute("data-selected")).toBe("false");
    expect(rows[1].getAttribute("data-selected")).toBe("true");
    expect(rows[1].getAttribute("aria-current")).toBe("true");

    fireEvent.click(rows[1]);
    expect(onDeadlineAction).toHaveBeenCalledWith(expect.objectContaining({
      dateKey: "2026-05-09",
      item: expect.objectContaining({
        id: "repeat-1",
        agendaItemId: "deadline:repeat-1:2026-05-09",
      }),
    }));
  });

  it("toggles completed deadline rows for the mounted rail session", () => {
    renderRail();

    expect(screen.getByText("Completed review")).toBeTruthy();

    const toggle = screen.getByRole("button", { name: /hide completed deadlines/i });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(screen.queryByText("Completed review")).toBeNull();
    expect(screen.getAllByTestId("calendar-agenda-deadline-row")).toHaveLength(2);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);
    expect(screen.getByText("Completed review")).toBeTruthy();
    expect(screen.getAllByTestId("calendar-agenda-deadline-row")).toHaveLength(3);
  });

  it("shows compact reminder timing in deadline agenda rows", () => {
    renderRail();

    expect(screen.getByTestId("calendar-agenda-reminder-label").textContent).toContain("Reminder");
    expect(screen.getByTestId("calendar-agenda-reminder-label").textContent).toContain("May 9");
  });

  it("notifies when hiding completed deadlines removes the selected row", () => {
    const onFilteredSelectedDeadlineHidden = vi.fn();
    renderRail({
      selectedItemId: "deadline:done-1:2026-05-09",
      onFilteredSelectedDeadlineHidden,
    });

    fireEvent.click(screen.getByRole("button", { name: /hide completed deadlines/i }));

    expect(onFilteredSelectedDeadlineHidden).toHaveBeenCalledTimes(1);
  });

  it("renders today's header and empty target when today has no deadlines", () => {
    renderRail({
      todayDate: 2,
      selectedDateKey: "2026-05-05",
    });

    expect(screen.getByRole("button", { name: /select saturday, may 2/i })).toBeTruthy();
    expect(screen.getByText("TODAY 5/2/26")).toBeTruthy();
    expect(screen.getByText("No Deadlines")).toBeTruthy();
  });
});
