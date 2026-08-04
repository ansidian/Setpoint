import { describe, expect, it } from "vitest";
import express from "express";
import request from "../test-utils/supertest.ts";
import { createBriefingTasksRouter } from "./briefing/tasks.ts";

process.env.EA_USER_ID = "user-1";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/briefing", createBriefingTasksRouter({
    listProjects: async (userId) => [{ id: `project-${userId}`, name: "Home", color: "blue" }],
    listLabels: async (userId) => [{ id: `label-${userId}`, name: "urgent", color: "red" }],
  }));
  return app;
}

describe("briefing Todoist metadata routes", () => {
  it("keeps the Todoist project metadata endpoint available", async () => {
    const res = await request(makeApp()).get("/api/briefing/todoist/projects");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "project-user-1", name: "Home", color: "blue" }]);
  });

  it("keeps the Todoist label metadata endpoint available", async () => {
    const res = await request(makeApp()).get("/api/briefing/todoist/labels");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "label-user-1", name: "urgent", color: "red" }]);
  });
});

describe("retired public task mutation routes", () => {
  it.each([
    ["post", "/api/briefing/complete-task/td-1"],
    ["delete", "/api/briefing/tombstone/td-1"],
    ["post", "/api/briefing/todoist/tasks"],
    ["post", "/api/briefing/todoist/tasks/td-1"],
    ["delete", "/api/briefing/todoist/tasks/td-1"],
  ] as const)("returns 404 for %s %s", async (method, path) => {
    const agent = request(makeApp());
    const res = await (method === "post" ? agent.post(path) : agent.delete(path)).send({});

    expect(res.status).toBe(404);
  });
});
