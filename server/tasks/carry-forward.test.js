import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../db/connection.ts", () => ({ default: {} }));
vi.mock("../platform/encryption.ts", () => ({ decrypt: () => "mocked" }));
vi.mock("../email/gmail.js", () => ({ fetchEmails: async () => [] }));
vi.mock("../email/icloud.js", () => ({ fetchEmails: async () => [] }));
vi.mock("../calendar/calendar.js", () => ({ fetchCalendar: async () => [] }));
vi.mock("../platform/weather.ts", () => ({ fetchWeather: async () => ({}) }));
vi.mock("../actual/actual.ts", () => ({ getCategories: async () => [] }));

const { carryForwardCompletedTodoist, computeDeadlineStats } = await import("./deadline-helpers.js");

describe("carryForwardCompletedTodoist", () => {
  it("carries completed rows forward when their due_date >= boundary", () => {
    const newList = [];
    const prev = [
      { id: "td-1", title: "Today complete", status: "complete", due_date: "2026-04-18" },
      { id: "td-2", title: "Still open", status: "incomplete", due_date: "2026-04-18" },
    ];
    const out = carryForwardCompletedTodoist(newList, prev, "2026-04-18");
    expect(out.map((t) => t.id)).toEqual(["td-1"]);
  });

  it("drops completed rows whose due_date is before the boundary (deadlines: today)", () => {
    const newList = [];
    const prev = [
      { id: "td-1", title: "Yesterday complete", status: "complete", due_date: "2026-04-17" },
    ];
    const out = carryForwardCompletedTodoist(newList, prev, "2026-04-18");
    expect(out).toEqual([]);
  });

  it("keeps yesterday's completed under the lenient calendar boundary", () => {
    const newList = [];
    const prev = [
      { id: "td-1", title: "Yesterday complete", status: "complete", due_date: "2026-04-17" },
      { id: "td-2", title: "Two-days-ago complete", status: "complete", due_date: "2026-04-16" },
    ];
    const out = carryForwardCompletedTodoist(newList, prev, "2026-04-17");
    expect(out.map((t) => t.id)).toEqual(["td-1"]);
  });

  it("skips tombstone rows — recurring path owns those", () => {
    const newList = [];
    const prev = [
      { id: "td-1", status: "complete", due_date: "2026-04-18", _tombstone: true },
      { id: "td-2", status: "complete", due_date: "2026-04-18" },
    ];
    const out = carryForwardCompletedTodoist(newList, prev, "2026-04-18");
    expect(out.map((t) => t.id)).toEqual(["td-2"]);
  });

  it("dedupes against newList by (id, due_date) so a recurring live row isn't duplicated", () => {
    const newList = [
      { id: "td-1", status: "incomplete", due_date: "2026-04-19" },
    ];
    const prev = [
      { id: "td-1", status: "complete", due_date: "2026-04-19" },
    ];
    const out = carryForwardCompletedTodoist(newList, prev, "2026-04-18");
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("incomplete");
  });

  it("returns newList untouched when prev is empty or missing", () => {
    const newList = [{ id: "td-1", status: "incomplete" }];
    expect(carryForwardCompletedTodoist(newList, null, "2026-04-18")).toBe(newList);
    expect(carryForwardCompletedTodoist(newList, [], "2026-04-18")).toBe(newList);
  });
});

describe("computeDeadlineStats: DST-safe due-this-week window", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("excludes an 8th day that a fixed 168h shift would wrongly include across spring-forward", () => {
    // 2026-03-07 23:30 PST (the night before spring-forward). now + 7*86400000ms
    // lands at 2026-03-15 00:30 PDT (only 167h of wall-clock elapsed since the
    // DST jump loses an hour), so a fixed-ms shift would format weekFromNow as
    // 2026-03-15 — an 8-day window. Calendar-day math must stay at 2026-03-14.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T07:30:00.000Z"));

    const included = { id: "in", due_date: "2026-03-14", status: "incomplete" };
    const excluded = { id: "out", due_date: "2026-03-15", status: "incomplete" };

    const stats = computeDeadlineStats([included, excluded]);

    expect(stats.dueThisWeek).toBe(1);
  });
});
