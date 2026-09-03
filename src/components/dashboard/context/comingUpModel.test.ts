import { describe, it, expect, vi, afterEach } from "vitest";
import { buildComingUp } from "./comingUpModel";

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

  it("accepts the { upcoming } wrapper for liveDeadlines as well as a raw array", () => {
    freezeToJan15();
    const wrapped = { upcoming: [{ id: "w", title: "W", due_date: "2026-01-16", status: "open" }] };
    const out = buildComingUp({ liveDeadlines: wrapped, liveBills: [], days: 7 });
    expect(out.map((x) => x.id)).toEqual(["deadline:w"]);
  });

  it("can reserve Coming Up for future days while preserving the default window", () => {
    freezeToJan15();
    const liveDeadlines = [
      { id: "today", due_date: "2026-01-15" },
      { id: "tomorrow", due_date: "2026-01-16" },
      { id: "boundary", due_date: "2026-01-22" },
      { id: "outside", due_date: "2026-01-23" },
    ];
    const liveBills = [
      { id: "today", next_date: "2026-01-15" },
      { id: "tomorrow", next_date: "2026-01-16" },
    ];
    expect(buildComingUp({ liveDeadlines, liveBills, includeToday: false }).map((row) => row.id))
      .toEqual(["deadline:tomorrow", "bill:tomorrow", "deadline:boundary"]);
    expect(buildComingUp({ liveDeadlines, liveBills }).filter((row) => row.sortDays === 0).map((row) => row.id))
      .toEqual(["deadline:today", "bill:today"]);
  });

});
