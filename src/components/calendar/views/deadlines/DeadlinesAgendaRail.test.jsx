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
    ]);
    expect(rows[0].style.background).not.toContain("color-mix");
    expect(rows[1].style.background).toContain("color-mix");

    fireEvent.click(rows[1]);
    expect(onDeadlineAction).toHaveBeenCalledWith(expect.objectContaining({
      dateKey: "2026-05-09",
      item: expect.objectContaining({
        id: "repeat-1",
        agendaItemId: "todoist:repeat-1-2026-05-09",
      }),
    }));
  });
});
