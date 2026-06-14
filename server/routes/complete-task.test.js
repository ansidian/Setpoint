import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const taskService = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listLabels: vi.fn(),
}));

vi.mock("../tasks/tasks-service.js", () => ({
  listProjects: (...args) => taskService.listProjects(...args),
  listLabels: (...args) => taskService.listLabels(...args),
}));

process.env.EA_USER_ID = "user-1";

const { default: tasksRouter } = await import("./briefing/tasks.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/briefing", tasksRouter);
  return app;
}

describe("briefing Todoist metadata routes", () => {
  beforeEach(() => {
    taskService.listProjects.mockReset().mockResolvedValue([{ id: "project-1", name: "Home" }]);
    taskService.listLabels.mockReset().mockResolvedValue([{ id: "label-1", name: "urgent" }]);
  });

  it("keeps the Todoist project metadata endpoint available", async () => {
    const res = await request(makeApp()).get("/api/briefing/todoist/projects");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "project-1", name: "Home" }]);
    expect(taskService.listProjects).toHaveBeenCalledWith("user-1");
  });

  it("keeps the Todoist label metadata endpoint available", async () => {
    const res = await request(makeApp()).get("/api/briefing/todoist/labels");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "label-1", name: "urgent" }]);
    expect(taskService.listLabels).toHaveBeenCalledWith("user-1");
  });
});

describe("retired public task mutation routes", () => {
  beforeEach(() => {
    taskService.listProjects.mockReset().mockResolvedValue([]);
    taskService.listLabels.mockReset().mockResolvedValue([]);
  });

  it.each([
    ["post", "/api/briefing/complete-task/td-1"],
    ["delete", "/api/briefing/tombstone/td-1"],
    ["post", "/api/briefing/todoist/tasks"],
    ["post", "/api/briefing/todoist/tasks/td-1"],
    ["delete", "/api/briefing/todoist/tasks/td-1"],
  ])("returns 404 for %s %s", async (method, path) => {
    const res = await request(makeApp())[method](path).send({});

    expect(res.status).toBe(404);
    expect(taskService.listProjects).not.toHaveBeenCalled();
    expect(taskService.listLabels).not.toHaveBeenCalled();
  });
});
