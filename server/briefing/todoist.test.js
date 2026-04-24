import { describe, it, expect, vi } from "vitest";

vi.mock("../db/connection.js", () => ({ default: {} }));
vi.mock("./encryption.js", () => ({ decrypt: () => "mocked" }));

describe("mapTodoistTask", () => {
  it("propagates is_recurring=true from due.is_recurring", async () => {
    const { __testing__ } = await import("./todoist.js");
    const projects = new Map([["p1", { name: "Home", color: "grape" }]]);
    const raw = {
      id: "t1",
      content: "Empty dishwasher",
      project_id: "p1",
      due: { date: "2026-04-18", is_recurring: true },
      priority: 1,
      labels: [],
    };
    const out = __testing__.mapTodoistTask(raw, projects);
    expect(out.is_recurring).toBe(true);
  });

  it("defaults is_recurring to false when due.is_recurring is absent", async () => {
    const { __testing__ } = await import("./todoist.js");
    const projects = new Map([["p1", { name: "Home", color: "grape" }]]);
    const raw = {
      id: "t2",
      content: "One-off task",
      project_id: "p1",
      due: { date: "2026-04-18" },
      priority: 1,
      labels: [],
    };
    const out = __testing__.mapTodoistTask(raw, projects);
    expect(out.is_recurring).toBe(false);
  });

  it("uses the all-dated Todoist filter instead of a short due window", async () => {
    const { __testing__ } = await import("./todoist.js");
    expect(__testing__.TODOIST_DUE_TASKS_QUERY).toBe("!no date");
  });
});
