import { describe, expect, it } from "vitest";
import {
  getDeadlineOverlayComputed,
  getPlanningItemId,
  isDeadlinePlanningItem,
  mergeDeadlineOverlayIntoEvents,
  orderPlanningItems,
} from "./eventsPlanningModel.js";

function event(overrides) {
  return {
    id: overrides.id,
    title: overrides.title,
    startMs: new Date(overrides.start).getTime(),
    endMs: new Date(overrides.end || overrides.start).getTime(),
    allDay: !!overrides.allDay,
    ...overrides,
  };
}

function deadline(overrides) {
  return {
    id: overrides.id,
    title: overrides.title,
    source: overrides.source || "todoist",
    due_date: overrides.due_date,
    due_time: overrides.due_time || null,
    status: overrides.status || "incomplete",
    ...overrides,
  };
}

describe("events planning model", () => {
  it("normalizes deadline range data into overlay items and honors completed filtering", () => {
    const active = deadline({ id: "active", title: "Active", due_date: "2026-05-12" });
    const completed = deadline({ id: "done", title: "Done", due_date: "2026-05-12", status: "complete" });

    const visible = getDeadlineOverlayComputed({
      deadlineData: { todoist: { upcoming: [active, completed] }, ctm: { upcoming: [] } },
      viewYear: 2026,
      viewMonth: 4,
      showCompleted: false,
    });

    expect(visible.itemsByDate["2026-05-12"]).toHaveLength(1);
    expect(visible.itemsByDate["2026-05-12"][0]).toMatchObject({
      id: "active",
      calendarItemKind: "deadline",
      agendaDateKey: "2026-05-12",
      agendaItemId: "todoist:active",
    });
    expect(visible.completedDeadlines).toBe(0);

    const withCompleted = getDeadlineOverlayComputed({
      deadlineData: { todoist: { upcoming: [active, completed] }, ctm: { upcoming: [] } },
      viewYear: 2026,
      viewMonth: 4,
      showCompleted: true,
    });
    expect(withCompleted.itemsByDate["2026-05-12"]).toHaveLength(2);
    expect(withCompleted.completedDeadlines).toBe(1);
  });

  it("orders event spans and timed events before active deadlines, with completed deadlines last", () => {
    const ordered = orderPlanningItems([
      deadline({ id: "complete", title: "Complete", due_date: "2026-05-12", status: "complete" }),
      deadline({ id: "active", title: "Active", due_date: "2026-05-12", due_time: "5pm" }),
      event({ id: "timed", title: "Timed", start: "2026-05-12T18:00:00Z" }),
      event({ id: "all-day", title: "All day", start: "2026-05-12T07:00:00Z", allDay: true }),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["all-day", "timed", "active", "complete"]);
  });

  it("merges deadline overlay items into events while preserving event item ids", () => {
    const timed = event({ id: "timed", title: "Timed", start: "2026-05-12T18:00:00Z" });
    const active = deadline({ id: "active", title: "Active", due_date: "2026-05-12" });
    const deadlineOverlay = getDeadlineOverlayComputed({
      deadlineData: { todoist: { upcoming: [active] }, ctm: { upcoming: [] } },
      viewYear: 2026,
      viewMonth: 4,
      showCompleted: true,
    });

    const merged = mergeDeadlineOverlayIntoEvents({
      eventComputed: {
        itemsByDay: { 12: [timed] },
        itemsByDate: { "2026-05-12": [timed] },
        totalEvents: 1,
        allDayEvents: 0,
      },
      deadlineOverlayComputed: deadlineOverlay,
    });

    expect(merged.itemsByDate["2026-05-12"]).toHaveLength(2);
    expect(merged.itemsByDate["2026-05-12"].map(getPlanningItemId)).toEqual(["timed", "todoist:active"]);
    expect(isDeadlinePlanningItem(merged.itemsByDate["2026-05-12"][1])).toBe(true);
    expect(merged.totalDeadlines).toBe(1);
  });

  it("keeps CTM and Todoist deadline planning ids source-distinct", () => {
    const todoist = deadline({ id: "same", title: "Todoist", due_date: "2026-05-12", source: "todoist" });
    const ctm = deadline({ id: "same", title: "CTM", due_date: "2026-05-12", source: "canvas" });
    const overlay = getDeadlineOverlayComputed({
      deadlineData: {
        todoist: { upcoming: [todoist] },
        ctm: { upcoming: [ctm] },
      },
      viewYear: 2026,
      viewMonth: 4,
      showCompleted: true,
    });

    expect(overlay.itemsByDate["2026-05-12"].map(getPlanningItemId).sort()).toEqual([
      "canvas:same",
      "todoist:same",
    ]);
  });
});
