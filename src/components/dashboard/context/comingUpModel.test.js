import { describe, it, expect, vi, afterEach } from "vitest";
import { buildComingUp } from "./comingUpModel.js";

afterEach(() => { vi.useRealTimers(); });

function freezeToJan15() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T20:00:00Z"));
}

describe("buildComingUp", () => {
  it("merges deadlines and bills into one list sorted soonest-first within the window", () => {
    freezeToJan15();
    const liveDeadlines = [
      { id: "d1", title: "Finalize notes", due_date: "2026-01-16", status: "open", class_name: "Portfolio" },
      { id: "d2", title: "Runbook", due_date: "2026-01-17", status: "open", project_name: "Engineering" },
    ];
    const liveBills = [{ id: "b1", name: "Demo Electric", payee: "PG&E", amount: 146.32, next_date: "2026-01-18", paid: false }];
    const out = buildComingUp({ liveDeadlines, liveBills, days: 7 });
    expect(out.map((x) => x.id)).toEqual(["deadline:d1", "deadline:d2", "bill:b1"]);
    expect(out.map((x) => x.kind)).toEqual(["deadline", "deadline", "bill"]);
  });

  it("derives the time-anchored chipLabel and chipTone from days-until", () => {
    freezeToJan15();
    const liveDeadlines = [
      { id: "today", title: "T", due_date: "2026-01-15", status: "open" },
      { id: "tom", title: "M", due_date: "2026-01-16", status: "open" },
      { id: "soon", title: "S", due_date: "2026-01-18", status: "open" },
    ];
    const out = buildComingUp({ liveDeadlines, liveBills: [], days: 7 });
    expect(out.map((x) => [x.chipLabel, x.chipTone])).toEqual([
      ["Today", "rose"], ["Tomorrow", "cream"], ["In 3d", "muted"],
    ]);
  });

  it("gives a chipTooltip short date for future rows, and none (null) for due-today rows", () => {
    freezeToJan15();
    const out = buildComingUp({
      liveDeadlines: [
        { id: "today", title: "T", due_date: "2026-01-15", due_time: "2:00 PM", status: "open" },
        { id: "tom", title: "M", due_date: "2026-01-16", status: "open" },
      ],
      liveBills: [{ id: "b", name: "Rent", amount: 2450, next_date: "2026-01-18", paid: false }],
      days: 7,
    });
    const byId = Object.fromEntries(out.map((x) => [x.id, x.chipTooltip]));
    expect(byId["deadline:today"]).toBeNull(); // due today → chip already says "Today"
    expect(byId["deadline:tom"]).toBe("1/16/26");
    expect(byId["bill:b"]).toBe("1/18/26");
  });

  it("excludes paid bills, completed deadlines, overdue items, and anything past the window", () => {
    freezeToJan15();
    const liveDeadlines = [
      { id: "done", title: "Done", due_date: "2026-01-16", status: "complete" },
      { id: "overdue", title: "Late", due_date: "2026-01-14", status: "open" },
      { id: "far", title: "Far", due_date: "2026-02-01", status: "open" },
      { id: "ok", title: "OK", due_date: "2026-01-17", status: "open" },
    ];
    const liveBills = [
      { id: "paid", name: "Paid bill", amount: 10, next_date: "2026-01-16", paid: true },
      { id: "unpaid", name: "Rent", amount: 2450, next_date: "2026-01-19", paid: false },
    ];
    const out = buildComingUp({ liveDeadlines, liveBills, days: 7 });
    expect(out.map((x) => x.id)).toEqual(["deadline:ok", "bill:unpaid"]);
  });

  it("formats bill meta with amount and payee, deadline meta with class/project fallback", () => {
    freezeToJan15();
    const out = buildComingUp({
      liveDeadlines: [{ id: "d", title: "D", due_date: "2026-01-16", status: "open" }],
      liveBills: [{ id: "b", name: "Electric", payee: "PG&E", amount: 146.32, next_date: "2026-01-16", paid: false }],
      days: 7,
    });
    const byId = Object.fromEntries(out.map((x) => [x.id, x.meta]));
    expect(byId["deadline:d"]).toBe("Deadline");
    expect(byId["bill:b"]).toBe("$146.32 · PG&E");
  });

  it("accepts the { upcoming } wrapper for liveDeadlines as well as a raw array", () => {
    freezeToJan15();
    const wrapped = { upcoming: [{ id: "w", title: "W", due_date: "2026-01-16", status: "open" }] };
    const out = buildComingUp({ liveDeadlines: wrapped, liveBills: [], days: 7 });
    expect(out.map((x) => x.id)).toEqual(["deadline:w"]);
  });
});
