import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    batch: (...args) => testState.db.current.batch(...args),
  },
}));
vi.mock("./encryption.js", () => ({ decrypt: (value) => value }));

const {
  getTodoistMirrorHealth,
  listTodoistMirrorActiveTaskIds,
  listTodoistMirrorActiveTasks,
  listTodoistMirrorLabels,
  listTodoistMirrorProjects,
  markTodoistMirrorItemCompleted,
  markTodoistMirrorItemDeleted,
  syncTodoistMirror,
  upsertTodoistMirrorItem,
} = await import("./todoist-mirror.js");

async function createTodoistMirrorTestDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_settings (
      user_id TEXT PRIMARY KEY,
      todoist_api_token_encrypted TEXT
    );

    CREATE TABLE ea_todoist_sync_state (
      user_id TEXT PRIMARY KEY,
      sync_token TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      last_sync_at TEXT,
      last_success_at TEXT,
      last_full_sync_at TEXT,
      last_incremental_sync_at TEXT,
      last_error TEXT,
      sync_started_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE ea_todoist_items (
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      project_id TEXT,
      section_id TEXT,
      parent_id TEXT,
      content TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      checked INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      due_datetime TEXT,
      due_timezone TEXT,
      due_is_recurring INTEGER NOT NULL DEFAULT 0,
      priority INTEGER,
      labels_json TEXT NOT NULL DEFAULT '[]',
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at TEXT,
      deleted_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, item_id)
    );

    CREATE TABLE ea_todoist_projects (
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      color TEXT,
      is_inbox_project INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at TEXT,
      deleted_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, project_id)
    );

    CREATE TABLE ea_todoist_labels (
      user_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      color TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at TEXT,
      deleted_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, label_id)
    );
  `);
  return db;
}

async function seedTodoistToken(userId = "u1", token = "todoist-token") {
  await testState.db.current.execute({
    sql: "INSERT INTO ea_settings (user_id, todoist_api_token_encrypted) VALUES (?, ?)",
    args: [userId, token],
  });
}

async function seedSyncState(fields) {
  await testState.db.current.execute({
    sql: `INSERT INTO ea_todoist_sync_state
            (user_id, sync_token, status, last_success_at, last_error, sync_started_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      fields.userId || "u1",
      fields.syncToken || "sync-token",
      fields.status || "idle",
      fields.lastSuccessAt || null,
      fields.lastError || null,
      fields.syncStartedAt || null,
      fields.updatedAt || fields.lastSuccessAt || "2026-05-04T15:00:00.000Z",
    ],
  });
}

beforeEach(async () => {
  testState.db.current = await createTodoistMirrorTestDb();
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
});

describe("syncTodoistMirror", () => {
  it("initializes the mirror from a full Todoist Sync response", async () => {
    await seedTodoistToken();
    const syncApiClient = vi.fn(async () => ({
      full_sync: true,
      sync_token: "sync-token-1",
      items: [{
        id: "item-1",
        project_id: "project-1",
        content: "Submit worksheet",
        description: "Chapter 3",
        checked: false,
        is_deleted: false,
        due: {
          date: "2026-05-05T09:30:00",
          timezone: "America/Los_Angeles",
          is_recurring: true,
        },
        priority: 4,
        labels: ["school"],
      }],
      projects: [{
        id: "project-1",
        name: "School",
        color: "blue",
        is_inbox_project: false,
      }],
      labels: [{
        id: "label-1",
        name: "school",
        color: "blue",
      }],
    }));

    const result = await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-05-04T15:00:00.000Z"),
    });

    expect(syncApiClient).toHaveBeenCalledWith({
      token: "todoist-token",
      syncToken: "*",
      resourceTypes: ["items", "projects", "labels"],
    });
    expect(result).toMatchObject({
      status: "current",
      syncToken: "sync-token-1",
      fullSync: true,
      counts: { items: 1, projects: 1, labels: 1 },
    });

    const state = await testState.db.current.execute("SELECT * FROM ea_todoist_sync_state WHERE user_id = 'u1'");
    expect(state.rows[0]).toMatchObject({
      sync_token: "sync-token-1",
      status: "idle",
      last_sync_at: "2026-05-04T15:00:00.000Z",
      last_success_at: "2026-05-04T15:00:00.000Z",
      last_full_sync_at: "2026-05-04T15:00:00.000Z",
      last_error: null,
    });

    const items = await testState.db.current.execute("SELECT * FROM ea_todoist_items WHERE user_id = 'u1'");
    expect(items.rows[0]).toMatchObject({
      item_id: "item-1",
      project_id: "project-1",
      content: "Submit worksheet",
      description: "Chapter 3",
      checked: 0,
      is_deleted: 0,
      due_date: "2026-05-05",
      due_datetime: "2026-05-05T09:30:00",
      due_timezone: "America/Los_Angeles",
      due_is_recurring: 1,
      priority: 4,
      labels_json: JSON.stringify(["school"]),
      synced_at: "2026-05-04T15:00:00.000Z",
      deleted_at: null,
    });

    const projects = await testState.db.current.execute("SELECT * FROM ea_todoist_projects WHERE user_id = 'u1'");
    expect(projects.rows[0]).toMatchObject({
      project_id: "project-1",
      name: "School",
      color: "blue",
      is_inbox_project: 0,
      is_deleted: 0,
    });

    const labels = await testState.db.current.execute("SELECT * FROM ea_todoist_labels WHERE user_id = 'u1'");
    expect(labels.rows[0]).toMatchObject({
      label_id: "label-1",
      name: "school",
      color: "blue",
      is_deleted: 0,
    });
  });

  it("applies incremental updates without deleting absent resources", async () => {
    await seedTodoistToken();
    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient: vi.fn(async () => ({
        full_sync: true,
        sync_token: "sync-token-1",
        items: [
          { id: "item-1", project_id: "project-1", content: "Keep me", checked: false, due: { date: "2026-05-05" } },
          { id: "item-2", project_id: "project-1", content: "Delete me", checked: false, due: { date: "2026-05-06" } },
        ],
        projects: [{ id: "project-1", name: "School" }],
        labels: [{ id: "label-1", name: "school" }],
      })),
      now: new Date("2026-05-04T15:00:00.000Z"),
    });

    const syncApiClient = vi.fn(async () => ({
      full_sync: false,
      sync_token: "sync-token-2",
      items: [
        { id: "item-2", project_id: "project-1", content: "Delete me", checked: false, is_deleted: true },
      ],
      projects: [],
      labels: [],
    }));

    const result = await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-05-04T15:05:00.000Z"),
    });

    expect(syncApiClient).toHaveBeenCalledWith({
      token: "todoist-token",
      syncToken: "sync-token-1",
      resourceTypes: ["items", "projects", "labels"],
    });
    expect(result).toMatchObject({
      syncToken: "sync-token-2",
      fullSync: false,
      counts: { items: 1, projects: 0, labels: 0 },
    });

    const items = await testState.db.current.execute("SELECT item_id, content, is_deleted, deleted_at FROM ea_todoist_items WHERE user_id = 'u1' ORDER BY item_id");
    expect(items.rows).toEqual([
      expect.objectContaining({
        item_id: "item-1",
        content: "Keep me",
        is_deleted: 0,
        deleted_at: null,
      }),
      expect.objectContaining({
        item_id: "item-2",
        content: "Delete me",
        is_deleted: 1,
        deleted_at: "2026-05-04T15:05:00.000Z",
      }),
    ]);

    const projects = await testState.db.current.execute("SELECT project_id, is_deleted FROM ea_todoist_projects WHERE user_id = 'u1'");
    expect(projects.rows).toEqual([
      expect.objectContaining({ project_id: "project-1", is_deleted: 0 }),
    ]);

    const state = await testState.db.current.execute("SELECT * FROM ea_todoist_sync_state WHERE user_id = 'u1'");
    expect(state.rows[0]).toMatchObject({
      sync_token: "sync-token-2",
      last_full_sync_at: "2026-05-04T15:00:00.000Z",
      last_incremental_sync_at: "2026-05-04T15:05:00.000Z",
    });
  });

  it("falls back to a full sync when Todoist rejects the stored sync token", async () => {
    await seedTodoistToken();
    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient: vi.fn(async () => ({
        full_sync: true,
        sync_token: "expired-sync-token",
        items: [{ id: "old-item", content: "Old task", checked: false, due: { date: "2026-05-05" } }],
        projects: [],
        labels: [],
      })),
      now: new Date("2026-05-04T15:00:00.000Z"),
    });

    const invalidTokenError = new Error("Invalid sync token");
    invalidTokenError.status = 400;
    const syncApiClient = vi.fn()
      .mockRejectedValueOnce(invalidTokenError)
      .mockResolvedValueOnce({
        full_sync: true,
        sync_token: "replacement-sync-token",
        items: [{ id: "new-item", content: "New task", checked: false, due: { date: "2026-05-07" } }],
        projects: [],
        labels: [],
      });

    const result = await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-05-04T15:10:00.000Z"),
    });

    expect(syncApiClient).toHaveBeenNthCalledWith(1, {
      token: "todoist-token",
      syncToken: "expired-sync-token",
      resourceTypes: ["items", "projects", "labels"],
    });
    expect(syncApiClient).toHaveBeenNthCalledWith(2, {
      token: "todoist-token",
      syncToken: "*",
      resourceTypes: ["items", "projects", "labels"],
    });
    expect(result).toMatchObject({
      fullSync: true,
      syncToken: "replacement-sync-token",
    });

    const items = await testState.db.current.execute("SELECT item_id, is_deleted FROM ea_todoist_items WHERE user_id = 'u1' ORDER BY item_id");
    expect(items.rows).toEqual([
      expect.objectContaining({ item_id: "new-item", is_deleted: 0 }),
      expect.objectContaining({ item_id: "old-item", is_deleted: 1 }),
    ]);

    const state = await testState.db.current.execute("SELECT * FROM ea_todoist_sync_state WHERE user_id = 'u1'");
    expect(state.rows[0]).toMatchObject({
      sync_token: "replacement-sync-token",
      last_full_sync_at: "2026-05-04T15:10:00.000Z",
      last_error: null,
    });
  });

  it("records sync failures without corrupting mirror rows or sync token", async () => {
    await seedTodoistToken();
    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient: vi.fn(async () => ({
        full_sync: true,
        sync_token: "good-sync-token",
        items: [{ id: "item-1", content: "Still here", checked: false, due: { date: "2026-05-05" } }],
        projects: [],
        labels: [],
      })),
      now: new Date("2026-05-04T15:00:00.000Z"),
    });

    const failure = new Error("Todoist API 502: upstream");
    failure.status = 502;
    await expect(syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient: vi.fn().mockRejectedValue(failure),
      now: new Date("2026-05-04T15:15:00.000Z"),
    })).rejects.toThrow("Todoist API 502");

    const state = await testState.db.current.execute("SELECT * FROM ea_todoist_sync_state WHERE user_id = 'u1'");
    expect(state.rows[0]).toMatchObject({
      sync_token: "good-sync-token",
      status: "idle",
      last_success_at: "2026-05-04T15:00:00.000Z",
      last_error: "Todoist API 502: upstream",
      sync_started_at: null,
    });

    const items = await testState.db.current.execute("SELECT item_id, content, is_deleted FROM ea_todoist_items WHERE user_id = 'u1'");
    expect(items.rows).toEqual([
      expect.objectContaining({
        item_id: "item-1",
        content: "Still here",
        is_deleted: 0,
      }),
    ]);
  });
});

describe("optimistic Todoist write mirror updates", () => {
  it("makes created and updated tasks visible to immediate active mirror reads", async () => {
    await upsertTodoistMirrorItem("u1", {
      id: "task-1",
      project_id: "p1",
      content: "Draft essay",
      description: "Outline first",
      checked: false,
      due: { date: "2026-05-06", is_recurring: false },
      priority: 4,
      labels: ["writing"],
    }, {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T18:00:00.000Z"),
    });

    expect(await listTodoistMirrorActiveTasks("u1", { dbClient: testState.db.current })).toEqual([
      expect.objectContaining({
        id: "task-1",
        content: "Draft essay",
        due: { date: "2026-05-06", timezone: null, is_recurring: false },
        labels: ["writing"],
      }),
    ]);

    await upsertTodoistMirrorItem("u1", {
      id: "task-1",
      project_id: "p1",
      content: "Revised essay",
      checked: false,
      due: { date: "2026-05-07" },
      labels: [],
    }, {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T18:01:00.000Z"),
    });

    expect(await listTodoistMirrorActiveTasks("u1", { dbClient: testState.db.current })).toEqual([
      expect.objectContaining({
        id: "task-1",
        content: "Revised essay",
        due: { date: "2026-05-07", timezone: null, is_recurring: false },
        labels: [],
      }),
    ]);
  });

  it("removes completed and deleted task writes from immediate active mirror reads", async () => {
    await upsertTodoistMirrorItem("u1", {
      id: "complete-me",
      content: "Complete me",
      checked: false,
      due: { date: "2026-05-06" },
    }, { dbClient: testState.db.current });
    await upsertTodoistMirrorItem("u1", {
      id: "delete-me",
      content: "Delete me",
      checked: false,
      due: { date: "2026-05-07" },
    }, { dbClient: testState.db.current });

    await markTodoistMirrorItemCompleted("u1", "complete-me", {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T18:02:00.000Z"),
    });
    await markTodoistMirrorItemDeleted("u1", "delete-me", {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T18:03:00.000Z"),
    });

    expect(await listTodoistMirrorActiveTasks("u1", { dbClient: testState.db.current })).toEqual([]);
    expect(await listTodoistMirrorActiveTaskIds("u1", { dbClient: testState.db.current })).toEqual(new Set());
  });
});

describe("getTodoistMirrorHealth", () => {
  it("derives configured mirror health from sync state freshness", async () => {
    await expect(getTodoistMirrorHealth("u1", {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T15:00:30.000Z"),
    })).resolves.toMatchObject({
      state: "unconfigured",
      configured: false,
    });

    await seedTodoistToken("u1", "todoist-token");
    await expect(getTodoistMirrorHealth("u1", {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T15:00:30.000Z"),
    })).resolves.toMatchObject({
      state: "unavailable",
      configured: true,
    });

    await seedSyncState({
      userId: "syncing-user",
      status: "syncing",
      lastSuccessAt: "2026-05-04T14:59:00.000Z",
      syncStartedAt: "2026-05-04T15:00:10.000Z",
    });
    await seedTodoistToken("syncing-user", "todoist-token");
    await expect(getTodoistMirrorHealth("syncing-user", {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T15:00:30.000Z"),
    })).resolves.toMatchObject({
      state: "syncing",
      configured: true,
      lastSuccessAt: "2026-05-04T14:59:00.000Z",
      syncStartedAt: "2026-05-04T15:00:10.000Z",
    });

    await seedTodoistToken("current-user", "todoist-token");
    await seedSyncState({
      userId: "current-user",
      lastSuccessAt: "2026-05-04T15:00:00.000Z",
    });
    await expect(getTodoistMirrorHealth("current-user", {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T15:00:30.000Z"),
    })).resolves.toMatchObject({
      state: "current",
      ageMs: 30_000,
    });

    await seedTodoistToken("stale-user", "todoist-token");
    await seedSyncState({
      userId: "stale-user",
      lastSuccessAt: "2026-05-04T14:58:00.000Z",
    });
    await expect(getTodoistMirrorHealth("stale-user", {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T15:00:30.000Z"),
    })).resolves.toMatchObject({
      state: "stale",
      ageMs: 150_000,
    });

    await seedTodoistToken("unavailable-user", "todoist-token");
    await seedSyncState({
      userId: "unavailable-user",
      lastSuccessAt: "2026-05-04T14:40:00.000Z",
      lastError: "Todoist API 502: upstream",
    });
    await expect(getTodoistMirrorHealth("unavailable-user", {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T15:00:30.000Z"),
    })).resolves.toMatchObject({
      state: "unavailable",
      ageMs: 1_230_000,
      lastError: "Todoist API 502: upstream",
    });
  });
});

describe("Todoist mirror reads", () => {
  it("returns active task, id, project, and label rows from the mirror", async () => {
    await seedTodoistToken();
    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient: vi.fn(async () => ({
        full_sync: true,
        sync_token: "sync-token-1",
        items: [
          {
            id: "active-1",
            project_id: "project-1",
            content: "Active task",
            description: "Keep visible",
            checked: false,
            is_deleted: false,
            due: { date: "2026-05-05T09:30:00", timezone: "America/Los_Angeles", is_recurring: true },
            priority: 4,
            labels: ["school"],
          },
          {
            id: "undated-1",
            project_id: "project-1",
            content: "No due date",
            checked: false,
            is_deleted: false,
          },
          {
            id: "deleted-1",
            project_id: "project-1",
            content: "Deleted task",
            checked: false,
            is_deleted: true,
            due: { date: "2026-05-06" },
          },
        ],
        projects: [{ id: "project-1", name: "School", color: "blue", is_inbox_project: false }],
        labels: [{ id: "label-1", name: "school", color: "grape" }],
      })),
      now: new Date("2026-05-04T15:00:00.000Z"),
    });

    await expect(listTodoistMirrorActiveTasks("u1", {
      dbClient: testState.db.current,
      start: "2026-05-01",
      end: "2026-05-10",
    })).resolves.toEqual([
      expect.objectContaining({
        id: "active-1",
        content: "Active task",
        description: "Keep visible",
        project_id: "project-1",
        due: {
          date: "2026-05-05T09:30:00",
          timezone: "America/Los_Angeles",
          is_recurring: true,
        },
        priority: 4,
        labels: ["school"],
      }),
    ]);
    await expect(listTodoistMirrorActiveTaskIds("u1", {
      dbClient: testState.db.current,
    })).resolves.toEqual(new Set(["active-1"]));
    await expect(listTodoistMirrorProjects("u1", {
      dbClient: testState.db.current,
    })).resolves.toEqual([
      { id: "project-1", name: "School", color: "blue", isInbox: false },
    ]);
    await expect(listTodoistMirrorLabels("u1", {
      dbClient: testState.db.current,
    })).resolves.toEqual([
      { id: "label-1", name: "school", color: "grape" },
    ]);
  });
});
