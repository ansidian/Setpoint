import { describe, expect, it } from "vitest";
import { orderDetailEvents } from "./EventsDetailRail.jsx";
import { orderPlanningItems } from "./eventsPlanningModel.js";

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
    due_date: overrides.due_date,
    due_time: overrides.due_time || null,
    status: overrides.status || "incomplete",
    ...overrides,
  };
}

describe("orderDetailEvents", () => {
  it("matches orderPlanningItems ordering when deadlines are present", () => {
    const items = [
      deadline({ id: "complete", title: "Complete", due_date: "2026-05-12", status: "complete" }),
      deadline({ id: "active", title: "Active", due_date: "2026-05-12", due_time: "5pm" }),
      event({ id: "timed", title: "Timed", start: "2026-05-12T18:00:00Z" }),
      event({ id: "all-day", title: "All day", start: "2026-05-12T07:00:00Z", allDay: true }),
    ];

    const detailOrder = orderDetailEvents(items).map((item) => item.id);
    const planningOrder = orderPlanningItems(items).map((item) => item.id);

    expect(detailOrder).toEqual(planningOrder);
    expect(detailOrder).toEqual(["all-day", "timed", "active", "complete"]);
  });

  it("produces a consistent, stable order for deadline items tying on bucket/time/title", () => {
    // Two active deadlines that tie on bucket (active, same day), time (same due
    // moment), and title. A non-antisymmetric per-pair comparator could yield
    // different results depending on input order; the order must be deterministic
    // and agree with orderPlanningItems.
    const first = deadline({ id: "a", title: "Same", due_date: "2026-05-12", due_time: "5pm" });
    const second = deadline({ id: "b", title: "Same", due_date: "2026-05-12", due_time: "5pm" });

    const forward = orderDetailEvents([first, second]).map((item) => item.id);
    const reverse = orderDetailEvents([second, first]).map((item) => item.id);

    // Stable: forward input keeps insertion order on a full tie.
    expect(forward).toEqual(["a", "b"]);
    // Reverse input is also stable (no spurious re-ordering from a broken comparator).
    expect(reverse).toEqual(["b", "a"]);
    // And both agree with the shared planning sort on a full tie.
    expect(forward).toEqual(orderPlanningItems([first, second]).map((item) => item.id));
    expect(reverse).toEqual(orderPlanningItems([second, first]).map((item) => item.id));
  });

  it("leaves the non-deadline path ordering events all-day-first then by start time", () => {
    const items = [
      event({ id: "late", title: "Late", start: "2026-05-12T20:00:00Z" }),
      event({ id: "early", title: "Early", start: "2026-05-12T08:00:00Z" }),
      event({ id: "all-day", title: "All day", start: "2026-05-12T07:00:00Z", allDay: true }),
    ];

    expect(orderDetailEvents(items).map((item) => item.id)).toEqual(["all-day", "early", "late"]);
  });
});
