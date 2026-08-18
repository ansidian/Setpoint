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

// test-architecture: allow-boundary-mock -- Todoist credential lookup is a database boundary; facade cases supply one controlled stored token while write-through durability is tested separately.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: testState.dbExecute,
  },
}));
// test-architecture: allow-boundary-mock -- Token decryption is the cryptographic storage boundary used before outbound Todoist requests.
vi.mock("../platform/encryption.ts", () => ({ decrypt: (value: unknown) => value }));
// test-architecture: allow-boundary-mock -- The local Todoist mirror is the facade's durable cache boundary; cases verify provider writes project into controlled mirror state and reads never fall through live.
vi.mock("./todoist-mirror.ts", () => testState.mirror);
// test-architecture: allow-boundary-mock -- Mirror wake-up is the process/timer boundary following provider mutations; exact coalescing is owned by webhook worker tests.
vi.mock("./todoist-webhook.ts", () => ({
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
    const { createTodoistTask } = await import("./todoist.ts");

    await createTodoistTask("u1", {
      content: "Draft essay",
      due_string: "tomorrow at 9am",
    });
    await createTodoistTask("u1", { content: "Draft essay", due_string: "" });

    // test-architecture: allow-boundary-interaction -- Todoist fetch is an irreversible provider-write boundary; task payloads are the compatibility contract.
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
    const { updateTodoistTask } = await import("./todoist.ts");

    await updateTodoistTask("u1", "task-1", {
      content: "Revised essay",
      due_string: "every weekday at 9am",
    });
    await updateTodoistTask("u1", "task-1", { content: "Revised essay", due_string: "" });

    // test-architecture: allow-boundary-interaction -- Todoist fetch is an irreversible provider-write boundary; task payloads are the compatibility contract.
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
    const { createTodoistTask } = await import("./todoist.ts");

    const result = await createTodoistTask("u1", {
      content: "Draft essay",
      description: "Outline first",
      project_id: "p1",
      priority: 1,
      labels: ["writing"],
      due_string: "tomorrow",
    });

    expect(result).toMatchObject({ id: "new-task", title: "Draft essay" });
    // test-architecture: allow-boundary-interaction -- Provider create success must write through to the durable local mirror for the exact owner/item.
    expect(testState.mirror.upsertTodoistMirrorItem).toHaveBeenCalledWith("u1", createdTask);
    // test-architecture: allow-boundary-interaction -- Post-create reconciliation crosses the background-worker boundary and must retain its exact reason.
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
    const { updateTodoistTask } = await import("./todoist.ts");

    await updateTodoistTask("u1", "task-1", {
      content: "Revised essay",
    });

    // test-architecture: allow-boundary-interaction -- Provider update success must write through to the durable local mirror for the exact owner/item.
    expect(testState.mirror.upsertTodoistMirrorItem).toHaveBeenCalledWith("u1", updatedTask);
    // test-architecture: allow-boundary-interaction -- Post-update reconciliation crosses the background-worker boundary and must retain its exact reason.
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
    const { completeTodoistTask } = await import("./todoist.ts");

    await completeTodoistTask("u1", "task-1", "2026-05-05");

    // test-architecture: allow-boundary-interaction -- Provider close success must durably remove the exact task from the active mirror before later reads.
    expect(testState.mirror.markTodoistMirrorItemCompleted).toHaveBeenCalledWith("u1", "task-1", "2026-05-05");
    // test-architecture: allow-boundary-interaction -- Post-close reconciliation crosses the background-worker boundary and must retain its exact reason.
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
    const { deleteTodoistTask } = await import("./todoist.ts");

    await deleteTodoistTask("u1", "task-1");

    // test-architecture: allow-boundary-interaction -- Provider delete success must durably tombstone the exact task in the local mirror.
    expect(testState.mirror.markTodoistMirrorItemDeleted).toHaveBeenCalledWith("u1", "task-1");
    // test-architecture: allow-boundary-interaction -- Post-delete reconciliation crosses the background-worker boundary and must retain its exact reason.
    expect(testState.requestTodoistMirrorSync).toHaveBeenCalledWith("u1", {
      reason: "todoist-write",
    });
  });
});

describe("Todoist mirror-backed facade", () => {
  it("maps active tasks from the mirror without calling the live filter endpoint", async () => {
    testState.mirror.listTodoistMirrorActiveTasks.mockImplementationOnce(async (userId, range) => (
      userId === "u1" && range.start === null && range.end === null ? [
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
    ] : []));
    const { fetchTodoistTasks } = await import("./todoist.ts");

    const tasks = await fetchTodoistTasks("u1");

    // test-architecture: allow-boundary-interaction -- Mirror-backed reads must never fall through to Todoist's live filter endpoint.
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
    testState.mirror.listTodoistMirrorCompletedTasks.mockImplementationOnce(async (userId, range) => (
      userId === "u1" && range.start === "2026-05-05" && range.end === null ? [
      {
        id: "single-done",
        content: "Check-in IHSS",
        checked: true,
        project_id: "p1",
        due: { date: "2026-05-05T09:00:00", is_recurring: false },
        priority: 1,
        labels: [],
      },
    ] : []));
    const { fetchTodoistTasks } = await import("./todoist.ts");

    const tasks = await fetchTodoistTasks("u1");

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
    testState.mirror.listTodoistMirrorCompletedTasks.mockImplementationOnce(async (userId, range) => (
      userId === "u1" && range.start === "2026-05-05" && range.end === null ? [
      {
        id: "single-done",
        content: "Check-in IHSS",
        checked: true,
        project_id: "p1",
        due: { date: "2026-05-05T09:00:00", is_recurring: false },
        priority: 1,
        labels: [],
      },
    ] : []));
    const { fetchTodoistTasksAll } = await import("./todoist.ts");

    const tasks = await fetchTodoistTasksAll("u1");

    expect(tasks.map((task) => [task.id, task.status, task.due_date, task.is_recurring])).toEqual([
      ["recurring-next", "incomplete", "2026-05-07", true],
      ["single-done", "complete", "2026-05-05", false],
    ]);
    vi.useRealTimers();
  });

  it("reads non-deleted due Todoist ids for tombstone orphan pruning", async () => {
    testState.mirror.listTodoistMirrorDueTaskIds.mockImplementationOnce(async (userId) => (
      userId === "u1" ? new Set(["active-1", "completed-1"]) : new Set()
    ));
    const { fetchTodoistDueTaskIdSet } = await import("./todoist.ts");

    const ids = await fetchTodoistDueTaskIdSet("u1");

    expect(ids).toEqual(new Set(["active-1", "completed-1"]));
  });

  it("reads historical range rows from active and completed mirror tables without live Todoist lookup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T18:00:00.000Z"));
    testState.mirror.listTodoistMirrorActiveTasks.mockImplementationOnce(async (userId, range) => (
      userId === "u1" && range.start === "2026-05-01" && range.end === "2026-05-10" ? [
      {
        id: "active-1",
        content: "Active deadline",
        project_id: "p1",
        due: { date: "2026-05-05" },
        priority: 1,
        labels: [],
      },
    ] : []));
    testState.mirror.listTodoistMirrorCompletedTasks.mockImplementationOnce(async (userId, range) => (
      userId === "u1" && range.start === "2026-05-01" && range.end === "2026-05-10" ? [
      {
        task_id: "completed-1",
        content: "Completed deadline",
        project_id: "p1",
        due: { date: "2026-05-02" },
        priority: 1,
        labels: [],
      },
    ] : []));
    testState.fetchFn.mockRejectedValue(new Error("network should not be used"));
    const { fetchTodoistTasksRange } = await import("./todoist.ts");

    const tasks = await fetchTodoistTasksRange("u1", { start: "2026-05-01", end: "2026-05-10" });

    // test-architecture: allow-boundary-interaction -- Historical range reads must not use Todoist's live active-task endpoint.
    expect(testState.fetchFn).not.toHaveBeenCalledWith(
      expect.stringContaining("/tasks/filter"),
      expect.anything(),
    );
    // test-architecture: allow-boundary-interaction -- Historical range reads must not use Todoist's live completed-task endpoint.
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
    const { fetchTodoistProjects, fetchTodoistLabels } = await import("./todoist.ts");

    await expect(fetchTodoistProjects("u1")).resolves.toEqual([
      { id: "p1", name: "School", color: "#4073ff", isInbox: false },
    ]);
    await expect(fetchTodoistLabels("u1")).resolves.toEqual([
      { id: "l1", name: "writing", color: "#884dff" },
    ]);
    // test-architecture: allow-boundary-interaction -- Project/label picker reads must remain local and issue no outbound Todoist HTTP request.
    expect(testState.fetchFn).not.toHaveBeenCalled();
  });

  it("falls back to empty mirror data when bootstrap sync fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    const { fetchTodoistTasks } = await import("./todoist.ts");

    await expect(fetchTodoistTasks("u1")).resolves.toEqual([]);
    // test-architecture: allow-boundary-interaction -- Missing mirror bootstrap crosses the outbound background-sync boundary with an explicit full-sync request.
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
    const { fetchTodoistTasksRange } = await import("./todoist.ts");

    const tasks = await fetchTodoistTasksRange("u1", { start: "2026-05-01", end: "2026-05-10" });

    // test-architecture: allow-boundary-interaction -- Mirror-backed range reads must issue no outbound Todoist HTTP request, including the deprecated completed endpoint.
    expect(testState.fetchFn).not.toHaveBeenCalled();
    expect(tasks.map((task) => [task.id, task.status])).toEqual([
      ["active-1", "incomplete"],
      ["completed-1", "complete"],
    ]);
  });
});
