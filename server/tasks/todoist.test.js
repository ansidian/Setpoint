import { beforeEach, describe, it, expect, vi } from "vitest";

const testState = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  fetchFn: vi.fn(),
  mirror: {
    getTodoistMirrorHealth: vi.fn(),
    listTodoistMirrorActiveTaskIds: vi.fn(),
    listTodoistMirrorActiveTasks: vi.fn(),
    listTodoistMirrorCompletedTasks: vi.fn(),
    listTodoistMirrorDueTaskIds: vi.fn(),
    listTodoistMirrorProjects: vi.fn(),
    listTodoistMirrorLabels: vi.fn(),
    markTodoistMirrorItemCompleted: vi.fn(),
    markTodoistMirrorItemDeleted: vi.fn(),
    syncTodoistMirror: vi.fn(),
    upsertTodoistMirrorItem: vi.fn(),
  },
  requestTodoistMirrorSync: vi.fn(),
}));

vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (...args) => testState.dbExecute(...args),
  },
}));
vi.mock("../platform/encryption.ts", () => ({ decrypt: (value) => value }));
vi.mock("./todoist-mirror.js", () => testState.mirror);
vi.mock("./todoist-webhook.js", () => ({
  requestTodoistMirrorSync: testState.requestTodoistMirrorSync,
}));

beforeEach(() => {
  vi.resetModules();
  testState.dbExecute.mockReset();
  testState.fetchFn.mockReset();
  testState.requestTodoistMirrorSync.mockReset();
  global.fetch = testState.fetchFn;
  for (const mock of Object.values(testState.mirror)) mock.mockReset();
  testState.dbExecute.mockResolvedValue({
    rows: [{ todoist_api_token_encrypted: "todoist-token" }],
  });
  testState.mirror.getTodoistMirrorHealth.mockResolvedValue({
    state: "current",
    configured: true,
    lastSuccessAt: "2026-05-04T15:00:00.000Z",
    ageMs: 30_000,
  });
  testState.mirror.listTodoistMirrorProjects.mockResolvedValue([
    { id: "p1", name: "School", color: "blue", isInbox: false },
  ]);
  testState.mirror.listTodoistMirrorLabels.mockResolvedValue([
    { id: "l1", name: "writing", color: "grape" },
  ]);
  testState.mirror.listTodoistMirrorActiveTaskIds.mockResolvedValue(new Set());
  testState.mirror.listTodoistMirrorDueTaskIds.mockResolvedValue(new Set());
  testState.mirror.listTodoistMirrorActiveTasks.mockResolvedValue([]);
  testState.mirror.listTodoistMirrorCompletedTasks.mockResolvedValue([]);
});

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

  it("maps completed-by-due-date rows into complete Todoist deadline items", async () => {
    const { __testing__ } = await import("./todoist.js");
    const projects = new Map([["p1", { name: "School", color: "blue" }]]);
    const raw = {
      task_id: "t3",
      content: "Submit draft",
      project_id: "p1",
      due: { date: "2026-04-18T14:30:00", is_recurring: true },
      priority: 4,
      labels: ["writing"],
      description: "Final pass",
    };

    expect(__testing__.mapCompletedTodoistTask(raw, projects)).toMatchObject({
      id: "t3",
      title: "Submit draft",
      due_date: "2026-04-18",
      due_time: "2:30 PM",
      class_name: "School",
      status: "complete",
      source: "todoist",
      priority: 1,
      labels: ["writing"],
      is_recurring: true,
    });
  });

  it("keeps the literal (no-Z) due datetime path byte-identical", async () => {
    const { __testing__ } = await import("./todoist.js");
    const projects = new Map([["p1", { name: "Home", color: "grape" }]]);
    const raw = {
      id: "t4",
      content: "Floating due",
      project_id: "p1",
      due: { date: "2026-01-15T19:00:00" },
      priority: 1,
      labels: [],
    };
    const out = __testing__.mapTodoistTask(raw, projects);
    expect(out.due_time).toBe("7:00 PM");
    expect(out.due_date).toBe("2026-01-15");
  });

  it("converts a Z-suffixed due datetime to Pacific time/date", async () => {
    const { __testing__ } = await import("./todoist.js");
    const projects = new Map([["p1", { name: "Home", color: "grape" }]]);
    const raw = {
      id: "t5",
      content: "Fixed-timezone due",
      project_id: "p1",
      // 2026-01-16T03:00:00Z = 2026-01-15 7:00 PM PST
      due: { date: "2026-01-16T03:00:00Z" },
      priority: 1,
      labels: [],
    };
    const out = __testing__.mapTodoistTask(raw, projects);
    expect(out.due_time).toBe("7:00 PM");
    expect(out.due_date).toBe("2026-01-15");
  });

  it("dedupes recurring Todoist range rows by id and due date", async () => {
    const { __testing__ } = await import("./todoist.js");
    const rows = [
      { id: "t1", due_date: "2026-04-18", status: "incomplete" },
      { id: "t1", due_date: "2026-04-18", status: "complete" },
      { id: "t1", due_date: "2026-04-25", status: "complete" },
    ];

    expect(__testing__.dedupeTodoistRangeTasks(rows)).toEqual([
      { id: "t1", due_date: "2026-04-18", status: "incomplete" },
      { id: "t1", due_date: "2026-04-25", status: "complete" },
    ]);
  });
});

describe("Todoist write mirror coherence", () => {
  it("sends due_lang only when creating a task with a truthy due_string", async () => {
    const createdTask = {
      id: "new-task",
      content: "Draft essay",
      project_id: "p1",
      priority: 1,
      labels: [],
    };
    testState.fetchFn.mockImplementation(async (url) => {
      if (url.endsWith("/tasks")) {
        return {
          ok: true,
          status: 200,
          json: async () => createdTask,
        };
      }
      if (url.includes("/projects")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ id: "p1", name: "School", color: "blue" }] }),
        };
      }
      throw new Error(`Unexpected Todoist URL ${url}`);
    });
    const { createTodoistTask } = await import("./todoist.js");

    await createTodoistTask("u1", {
      content: "Draft essay",
      due_string: "tomorrow at 9am",
    });
    await createTodoistTask("u1", { content: "Draft essay", due_string: "" });

    const taskBodies = testState.fetchFn.mock.calls
      .filter(([url]) => url.endsWith("/tasks"))
      .map(([, options]) => JSON.parse(options.body));
    expect(taskBodies).toEqual([
      {
        content: "Draft essay",
        due_string: "tomorrow at 9am",
        due_lang: "en",
      },
      { content: "Draft essay" },
    ]);
  });

  it("sends due_lang only when updating a task with a truthy due_string", async () => {
    const updatedTask = {
      id: "task-1",
      content: "Revised essay",
      project_id: "p1",
      priority: 1,
      labels: [],
    };
    testState.fetchFn.mockImplementation(async (url) => {
      if (url.endsWith("/tasks/task-1")) {
        return {
          ok: true,
          status: 200,
          json: async () => updatedTask,
        };
      }
      if (url.includes("/projects")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ id: "p1", name: "School", color: "blue" }] }),
        };
      }
      throw new Error(`Unexpected Todoist URL ${url}`);
    });
    const { updateTodoistTask } = await import("./todoist.js");

    await updateTodoistTask("u1", "task-1", {
      content: "Revised essay",
      due_string: "every weekday at 9am",
    });
    await updateTodoistTask("u1", "task-1", { content: "Revised essay", due_string: "" });

    const taskBodies = testState.fetchFn.mock.calls
      .filter(([url]) => url.endsWith("/tasks/task-1"))
      .map(([, options]) => JSON.parse(options.body));
    expect(taskBodies).toEqual([
      {
        content: "Revised essay",
        due_string: "every weekday at 9am",
        due_lang: "en",
      },
      { content: "Revised essay", due_string: "" },
    ]);
  });

  it("upserts created tasks into the mirror and requests reconciliation sync", async () => {
    const createdTask = {
      id: "new-task",
      content: "Draft essay",
      description: "Outline first",
      project_id: "p1",
      due: { date: "2026-05-06", is_recurring: false },
      priority: 4,
      labels: ["writing"],
    };
    testState.fetchFn.mockImplementation(async (url) => {
      if (url.endsWith("/tasks")) {
        return {
          ok: true,
          status: 200,
          json: async () => createdTask,
        };
      }
      if (url.includes("/projects")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ id: "p1", name: "School", color: "blue" }] }),
        };
      }
      throw new Error(`Unexpected Todoist URL ${url}`);
    });
    const { createTodoistTask } = await import("./todoist.js");

    const result = await createTodoistTask("u1", {
      content: "Draft essay",
      description: "Outline first",
      project_id: "p1",
      priority: 1,
      labels: ["writing"],
      due_string: "tomorrow",
    });

    expect(result).toMatchObject({ id: "new-task", title: "Draft essay" });
    expect(testState.mirror.upsertTodoistMirrorItem).toHaveBeenCalledWith("u1", createdTask);
    expect(testState.requestTodoistMirrorSync).toHaveBeenCalledWith("u1", {
      reason: "todoist-write",
    });
  });

  it("upserts updated tasks into the mirror and requests reconciliation sync", async () => {
    const updatedTask = {
      id: "task-1",
      content: "Revised essay",
      description: "",
      project_id: "p1",
      due: { date: "2026-05-07" },
      priority: 3,
      labels: [],
    };
    testState.fetchFn.mockImplementation(async (url) => {
      if (url.endsWith("/tasks/task-1")) {
        return {
          ok: true,
          status: 200,
          json: async () => updatedTask,
        };
      }
      if (url.includes("/projects")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ id: "p1", name: "School", color: "blue" }] }),
        };
      }
      throw new Error(`Unexpected Todoist URL ${url}`);
    });
    const { updateTodoistTask } = await import("./todoist.js");

    await updateTodoistTask("u1", "task-1", {
      content: "Revised essay",
    });

    expect(testState.mirror.upsertTodoistMirrorItem).toHaveBeenCalledWith("u1", updatedTask);
    expect(testState.requestTodoistMirrorSync).toHaveBeenCalledWith("u1", {
      reason: "todoist-write",
    });
  });

  it("marks completed tasks out of the active mirror and requests reconciliation sync", async () => {
    testState.fetchFn.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => null,
    });
    const { completeTodoistTask } = await import("./todoist.js");

    await completeTodoistTask("u1", "task-1");

    expect(testState.mirror.markTodoistMirrorItemCompleted).toHaveBeenCalledWith("u1", "task-1");
    expect(testState.requestTodoistMirrorSync).toHaveBeenCalledWith("u1", {
      reason: "todoist-write",
    });
  });

  it("soft-deletes deleted tasks from the active mirror and requests reconciliation sync", async () => {
    testState.fetchFn.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => null,
    });
    const { deleteTodoistTask } = await import("./todoist.js");

    await deleteTodoistTask("u1", "task-1");

    expect(testState.mirror.markTodoistMirrorItemDeleted).toHaveBeenCalledWith("u1", "task-1");
    expect(testState.requestTodoistMirrorSync).toHaveBeenCalledWith("u1", {
      reason: "todoist-write",
    });
  });
});

describe("Todoist mirror-backed facade", () => {
  it("maps active tasks from the mirror without calling the live filter endpoint", async () => {
    testState.mirror.listTodoistMirrorActiveTasks.mockResolvedValueOnce([
      {
        id: "t1",
        content: "Submit lab",
        description: "Chapter 8",
        project_id: "p1",
        due: {
          date: "2026-05-05T09:30:00",
          is_recurring: true,
        },
        priority: 4,
        labels: ["school"],
      },
    ]);
    const { fetchTodoistTasks } = await import("./todoist.js");

    const tasks = await fetchTodoistTasks("u1");

    expect(testState.mirror.listTodoistMirrorActiveTasks).toHaveBeenCalledWith("u1", {
      start: null,
      end: null,
    });
    expect(testState.fetchFn).not.toHaveBeenCalledWith(
      expect.stringContaining("/tasks/filter"),
      expect.anything(),
    );
    expect(tasks).toEqual([
      expect.objectContaining({
        id: "t1",
        title: "Submit lab",
        due_date: "2026-05-05",
        due_time: "9:30 AM",
        class_name: "School",
        class_color: "#4073ff",
        status: "incomplete",
        source: "todoist",
        description: "Chapter 8",
        priority: 1,
        labels: ["school"],
        is_recurring: true,
      }),
    ]);
  });

  it("keeps checked mirror tasks due today visible as completed dashboard deadlines", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T18:00:00.000Z"));
    testState.mirror.listTodoistMirrorActiveTasks.mockResolvedValueOnce([
      {
        id: "recurring-next",
        content: "Check-in IHSS",
        project_id: "p1",
        due: { date: "2026-05-07T09:00:00", is_recurring: true },
        priority: 1,
        labels: [],
      },
    ]);
    testState.mirror.listTodoistMirrorCompletedTasks.mockResolvedValueOnce([
      {
        id: "single-done",
        content: "Check-in IHSS",
        checked: true,
        project_id: "p1",
        due: { date: "2026-05-05T09:00:00", is_recurring: false },
        priority: 1,
        labels: [],
      },
    ]);
    const { fetchTodoistTasks } = await import("./todoist.js");

    const tasks = await fetchTodoistTasks("u1");

    expect(testState.mirror.listTodoistMirrorCompletedTasks).toHaveBeenCalledWith("u1", {
      start: "2026-05-05",
      end: null,
    });
    expect(tasks.map((task) => [task.id, task.status, task.due_date, task.is_recurring])).toEqual([
      ["recurring-next", "incomplete", "2026-05-07", true],
      ["single-done", "complete", "2026-05-05", false],
    ]);
    vi.useRealTimers();
  });

  it("keeps checked mirror tasks due today visible in full calendar deadline reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T18:00:00.000Z"));
    testState.mirror.listTodoistMirrorActiveTasks.mockResolvedValueOnce([
      {
        id: "recurring-next",
        content: "Check-in IHSS",
        project_id: "p1",
        due: { date: "2026-05-07T09:00:00", is_recurring: true },
        priority: 1,
        labels: [],
      },
    ]);
    testState.mirror.listTodoistMirrorCompletedTasks.mockResolvedValueOnce([
      {
        id: "single-done",
        content: "Check-in IHSS",
        checked: true,
        project_id: "p1",
        due: { date: "2026-05-05T09:00:00", is_recurring: false },
        priority: 1,
        labels: [],
      },
    ]);
    const { fetchTodoistTasksAll } = await import("./todoist.js");

    const tasks = await fetchTodoistTasksAll("u1");

    expect(testState.mirror.listTodoistMirrorCompletedTasks).toHaveBeenCalledWith("u1", {
      start: "2026-05-05",
      end: null,
    });
    expect(tasks.map((task) => [task.id, task.status, task.due_date, task.is_recurring])).toEqual([
      ["recurring-next", "incomplete", "2026-05-07", true],
      ["single-done", "complete", "2026-05-05", false],
    ]);
    vi.useRealTimers();
  });

  it("derives mapped tasks and active id set from one mirror task read", async () => {
    testState.mirror.listTodoistMirrorActiveTasks.mockResolvedValueOnce([
      {
        id: "t1",
        content: "Submit lab",
        project_id: "p1",
        due: { date: "2026-05-05" },
        priority: 1,
        labels: [],
      },
    ]);
    const { fetchTodoistTasksAndIdSet } = await import("./todoist.js");

    const result = await fetchTodoistTasksAndIdSet("u1");

    expect(testState.mirror.listTodoistMirrorActiveTasks).toHaveBeenCalledTimes(1);
    expect(testState.mirror.listTodoistMirrorActiveTaskIds).not.toHaveBeenCalled();
    expect(result.tasks.map((task) => task.id)).toEqual(["t1"]);
    expect(result.idSet).toEqual(new Set(["t1"]));
  });

  it("reads non-deleted due Todoist ids for tombstone orphan pruning", async () => {
    testState.mirror.listTodoistMirrorDueTaskIds.mockResolvedValueOnce(new Set(["active-1", "completed-1"]));
    const { fetchTodoistDueTaskIdSet } = await import("./todoist.js");

    const ids = await fetchTodoistDueTaskIdSet("u1");

    expect(testState.mirror.listTodoistMirrorDueTaskIds).toHaveBeenCalledWith("u1");
    expect(ids).toEqual(new Set(["active-1", "completed-1"]));
  });

  it("reads historical range rows from active and completed mirror tables without live Todoist lookup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T18:00:00.000Z"));
    testState.mirror.listTodoistMirrorActiveTasks.mockResolvedValueOnce([
      {
        id: "active-1",
        content: "Active deadline",
        project_id: "p1",
        due: { date: "2026-05-05" },
        priority: 1,
        labels: [],
      },
    ]);
    testState.mirror.listTodoistMirrorCompletedTasks.mockResolvedValueOnce([
      {
        task_id: "completed-1",
        content: "Completed deadline",
        project_id: "p1",
        due: { date: "2026-05-02" },
        priority: 1,
        labels: [],
      },
    ]);
    testState.fetchFn.mockRejectedValue(new Error("network should not be used"));
    const { fetchTodoistTasksRange } = await import("./todoist.js");

    const tasks = await fetchTodoistTasksRange("u1", { start: "2026-05-01", end: "2026-05-10" });

    expect(testState.mirror.listTodoistMirrorActiveTasks).toHaveBeenCalledWith("u1", {
      start: "2026-05-01",
      end: "2026-05-10",
    });
    expect(testState.mirror.listTodoistMirrorCompletedTasks).toHaveBeenCalledWith("u1", {
      start: "2026-05-01",
      end: "2026-05-10",
    });
    expect(testState.fetchFn).not.toHaveBeenCalledWith(
      expect.stringContaining("/tasks/filter"),
      expect.anything(),
    );
    expect(testState.fetchFn).not.toHaveBeenCalledWith(
      expect.stringContaining("/tasks/completed/by_due_date"),
      expect.anything(),
    );
    expect(tasks.map((task) => [task.id, task.status])).toEqual([
      ["active-1", "incomplete"],
      ["completed-1", "complete"],
    ]);
    vi.useRealTimers();
  });

  it("reads project and label pickers from mirror tables", async () => {
    const { fetchTodoistProjects, fetchTodoistLabels } = await import("./todoist.js");

    await expect(fetchTodoistProjects("u1")).resolves.toEqual([
      { id: "p1", name: "School", color: "#4073ff", isInbox: false },
    ]);
    await expect(fetchTodoistLabels("u1")).resolves.toEqual([
      { id: "l1", name: "writing", color: "#884dff" },
    ]);
    expect(testState.fetchFn).not.toHaveBeenCalled();
  });

  it("falls back to empty mirror data when bootstrap sync fails", async () => {
    testState.mirror.getTodoistMirrorHealth
      .mockResolvedValueOnce({
        state: "unavailable",
        configured: true,
        lastSuccessAt: null,
        ageMs: null,
      })
      .mockResolvedValueOnce({
        state: "unavailable",
        configured: true,
        lastSuccessAt: null,
        ageMs: null,
      });
    testState.mirror.syncTodoistMirror.mockRejectedValueOnce(new Error("Todoist down"));
    testState.mirror.listTodoistMirrorActiveTasks.mockResolvedValueOnce([]);
    const { fetchTodoistTasks } = await import("./todoist.js");

    await expect(fetchTodoistTasks("u1")).resolves.toEqual([]);
    expect(testState.mirror.syncTodoistMirror).toHaveBeenCalledWith("u1", { forceFull: true });
  });

  it("does not require the live completed endpoint for range reads", async () => {
    testState.mirror.listTodoistMirrorActiveTasks.mockResolvedValueOnce([
      {
        id: "active-1",
        content: "Active deadline",
        project_id: "p1",
        due: { date: "2026-05-05" },
        priority: 1,
        labels: [],
      },
    ]);
    testState.mirror.listTodoistMirrorCompletedTasks.mockResolvedValueOnce([
      {
        task_id: "completed-1",
        content: "Completed deadline",
        project_id: "p1",
        due: { date: "2026-05-05" },
        priority: 1,
        labels: [],
      },
    ]);
    testState.fetchFn.mockRejectedValue(new Error("Todoist live API unavailable"));
    const { fetchTodoistTasksRange } = await import("./todoist.js");

    const tasks = await fetchTodoistTasksRange("u1", { start: "2026-05-01", end: "2026-05-10" });

    expect(testState.fetchFn).not.toHaveBeenCalled();
    expect(tasks.map((task) => [task.id, task.status])).toEqual([
      ["active-1", "incomplete"],
      ["completed-1", "complete"],
    ]);
  });
});
