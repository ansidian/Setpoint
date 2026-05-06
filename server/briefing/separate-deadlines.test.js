import { describe, it, expect, vi } from "vitest";

vi.mock("../db/connection.js", () => ({ default: {} }));
vi.mock("./encryption.js", () => ({ decrypt: () => "mocked" }));
vi.mock("./gmail.js", () => ({ fetchEmails: async () => [] }));
vi.mock("./icloud.js", () => ({ fetchEmails: async () => [] }));
vi.mock("./calendar.js", () => ({ fetchCalendar: async () => [] }));
vi.mock("./weather.js", () => ({ fetchWeather: async () => ({}) }));
vi.mock("./ctm.js", () => ({ fetchCTMDeadlines: async () => [] }));
vi.mock("./actual.js", () => ({ getCategories: async () => [] }));

const { separateDeadlines } = await import("./deadline-helpers.js");

describe("separateDeadlines", () => {
  it("keeps native CTM tasks regardless of completion status", () => {
    const ctm = [
      { id: 1, title: "Active", status: "incomplete", due_date: "2026-04-17" },
      { id: 2, title: "Done in CTM", status: "complete", due_date: "2026-04-17" },
    ];
    const todoist = [];
    const completedIds = new Set();

    const out = separateDeadlines(ctm, todoist, completedIds);

    expect(out.ctm.map((t) => t.id)).toEqual([1, 2]);
    expect(out.ctm.find((t) => t.id === 2).status).toBe("complete");
  });

  it("does not use CTM Todoist metadata to backfill missing Todoist rows", () => {
    const ctm = [
      { id: 1, title: "Linked", status: "complete", due_date: "2026-04-17", todoist_id: "td-1" },
    ];
    const todoist = [];
    const completedIds = new Set(["td-1"]);

    const out = separateDeadlines(ctm, todoist, completedIds);

    expect(out.ctm).toHaveLength(1);
    expect(out.ctm[0].status).toBe("complete");
    expect(out.todoist).toEqual([]);
  });

  it("keeps CTM and Todoist sections independent when ids overlap", () => {
    const ctm = [
      { id: 1, title: "From CTM", status: "incomplete", due_date: "2026-04-17", todoist_id: "td-1" },
      { id: 2, title: "Native CTM", status: "incomplete", due_date: "2026-04-17" },
    ];
    const todoist = [
      { id: "td-1", title: "Mirror in Todoist", due_date: "2026-04-17" },
      { id: "td-2", title: "Native Todoist", due_date: "2026-04-17" },
    ];

    const out = separateDeadlines(ctm, todoist, new Set());

    expect(out.ctm.map((t) => t.id)).toEqual([1, 2]);
    expect(out.todoist.map((t) => t.id)).toEqual(["td-1", "td-2"]);
  });

  it("does not let CTM todoist_id metadata suppress canonical Todoist rows", () => {
    const ctm = [
      { id: 1, title: "From CTM", status: "complete", due_date: "2026-04-17", todoist_id: 12345 },
    ];
    const todoist = [
      { id: "12345", title: "Mirror in Todoist", due_date: "2026-04-17", status: "complete" },
      { id: "native", title: "Native Todoist", due_date: "2026-04-17", status: "complete" },
    ];

    const out = separateDeadlines(ctm, todoist, new Set());

    expect(out.ctm.map((t) => t.id)).toEqual([1]);
    expect(out.todoist.map((t) => t.id)).toEqual(["12345", "native"]);
  });

  it("filters Todoist by completedIds (no API truth available for completed Todoist tasks)", () => {
    const ctm = [];
    const todoist = [
      { id: "td-1", title: "Active" },
      { id: "td-2", title: "Done in app" },
    ];
    const completedIds = new Set(["td-2"]);

    const out = separateDeadlines(ctm, todoist, completedIds);

    expect(out.todoist.map((t) => t.id)).toEqual(["td-1"]);
  });
});
