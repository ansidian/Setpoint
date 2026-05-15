import { describe, it, expect, vi } from "vitest";

vi.mock("../db/connection.js", () => ({ default: {} }));
vi.mock("./encryption.js", () => ({ decrypt: () => "mocked" }));
vi.mock("./gmail.js", () => ({ fetchEmails: async () => [] }));
vi.mock("./icloud.js", () => ({ fetchEmails: async () => [] }));
vi.mock("./calendar.js", () => ({ fetchCalendar: async () => [] }));
vi.mock("./weather.js", () => ({ fetchWeather: async () => ({}) }));
vi.mock("./actual.js", () => ({ getCategories: async () => [] }));

const { carryForwardCompletedTodoist } = await import("./deadline-helpers.js");

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
