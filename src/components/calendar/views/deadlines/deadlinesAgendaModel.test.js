import { describe, expect, it } from "vitest";
import { compute } from "./deadlinesModel.js";
import { buildDeadlinesAgendaGroups } from "./deadlinesAgendaModel.js";

function buildAgenda(showCompleted) {
  const computed = compute({
    viewYear: 2026,
    viewMonth: 4,
    data: {
      upcoming: [
        {
          id: "open-1",
          title: "Open deadline",
          due_date: "2026-05-05",
          status: "open",
        },
        {
          id: "done-1",
          title: "Completed deadline",
          due_date: "2026-05-05",
          status: "complete",
        },
        {
          id: "done-2",
          title: "Completed only day",
          due_date: "2026-05-06",
          status: "complete",
        },
      ],
    },
  });

  return buildDeadlinesAgendaGroups({
    computed,
    viewYear: 2026,
    viewMonth: 4,
    todayKey: "2026-05-01",
    showCompleted,
  });
}

describe("buildDeadlinesAgendaGroups", () => {
  it("filters completed agenda deadlines when completed items are hidden", () => {
    const agenda = buildAgenda(false);
    const may5 = agenda.groups.find((group) => group.dateKey === "2026-05-05");
    const may6 = agenda.groups.find((group) => group.dateKey === "2026-05-06");

    expect(may5.items.map((item) => item.agendaTitle)).toEqual(["Open deadline"]);
    expect(may5.hasDeadlines).toBe(true);
    expect(may6.items).toEqual([]);
    expect(may6.hasDeadlines).toBe(false);
    expect(agenda.visibleGroups.some((group) => group.dateKey === "2026-05-06")).toBe(false);
  });

  it("shows completed agenda deadlines by default", () => {
    const agenda = buildAgenda(undefined);
    const may5 = agenda.groups.find((group) => group.dateKey === "2026-05-05");

    expect(may5.items.map((item) => item.agendaTitle)).toEqual([
      "Open deadline",
      "Completed deadline",
    ]);
  });
});
