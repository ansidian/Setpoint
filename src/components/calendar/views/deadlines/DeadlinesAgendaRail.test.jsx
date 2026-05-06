import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeadlinesAgendaRail from "./DeadlinesAgendaRail.jsx";
import { compute } from "./deadlinesModel.js";

afterEach(() => {
  cleanup();
});

function renderRail(props = {}) {
  const data = {
    ctm: { upcoming: [] },
    todoist: {
      upcoming: [
        {
          id: "repeat-1",
          title: "Recurring review",
          due_date: "2026-05-05",
          due_time: "9:00 AM",
          source: "todoist",
          project_name: "Ops",
          status: "open",
          is_recurring: true,
        },
        {
          id: "repeat-1",
          title: "Recurring review",
          due_date: "2026-05-09",
          due_time: "9:00 AM",
          source: "todoist",
          project_name: "Ops",
          status: "open",
          is_recurring: true,
        },
        {
          id: "done-1",
          title: "Completed review",
          due_date: "2026-05-09",
          due_time: "10:00 AM",
          source: "todoist",
          project_name: "Ops",
          status: "complete",
        },
      ],
    },
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
  it("keys recurring Todoist occurrence selection by source id and due date", () => {
    const onDeadlineAction = vi.fn();
    renderRail({
      selectedItemId: "todoist:repeat-1-2026-05-09",
      onDeadlineAction,
    });

    const rows = screen.getAllByTestId("calendar-agenda-deadline-row");
    expect(rows.map((row) => row.getAttribute("data-item-id"))).toEqual([
      "todoist:repeat-1-2026-05-05",
      "todoist:repeat-1-2026-05-09",
      "todoist:done-1",
    ]);
    expect(rows[0].getAttribute("data-selected")).toBe("false");
    expect(rows[1].getAttribute("data-selected")).toBe("true");
    expect(rows[1].getAttribute("aria-current")).toBe("true");

    fireEvent.click(rows[1]);
    expect(onDeadlineAction).toHaveBeenCalledWith(expect.objectContaining({
      dateKey: "2026-05-09",
      item: expect.objectContaining({
        id: "repeat-1",
        agendaItemId: "todoist:repeat-1-2026-05-09",
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

  it("notifies when hiding completed deadlines removes the selected row", () => {
    const onFilteredSelectedDeadlineHidden = vi.fn();
    renderRail({
      selectedItemId: "done-1",
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
