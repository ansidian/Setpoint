import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");

const testState = vi.hoisted(() => ({
  db: { current: null as unknown as Client },
}));

// test-architecture: allow-boundary-mock -- Todoist mirror durability is exercised through a migrated in-memory database redirected at the shared connection seam.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement | string) => testState.db.current.execute(statement),
    batch: (statements: InStatement[]) => testState.db.current.batch(statements),
  },
}));
// test-architecture: allow-boundary-mock -- Token encryption is the cryptographic storage boundary; mirror protocol cases use one controlled decrypted provider token.
vi.mock("../platform/encryption.ts", () => ({ decrypt: (value: unknown) => value }));
const { getTodoistMirrorHealth, listTodoistMirrorActiveTasks, listTodoistMirrorLabels, listTodoistMirrorProjects, recordTodoistSyncRequest, syncTodoistMirror } = await import("./todoist-mirror.ts");
const { clearCurrentDashboardEventSubscribers, subscribeCurrentDashboardEvents } = await import("../dashboard/current-events.ts");

async function createTodoistMirrorTestDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(readFileSync(join(migrationsDir, "001_ea_tables.sql"), "utf8"));
  await db.executeMultiple(readFileSync(join(migrationsDir, "010_discord_reminders.sql"), "utf8"));
  return db;
}

async function seedTodoistToken(userId = "u1", token = "todoist-token") {
  await testState.db.current.execute({
    sql: "INSERT INTO ea_settings (user_id, todoist_api_token_encrypted) VALUES (?, ?)",
    args: [userId, token],
  });
}

interface SyncStateSeed {
  userId?: string;
  syncToken?: string;
  status?: string;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  syncStartedAt?: string | null;
  syncRequestedAt?: string | null;
  syncRequestReason?: string | null;
  lastCheckFailedAt?: string | null;
  failedCheckCount?: number;
  updatedAt?: string;
}

async function seedSyncState(fields: SyncStateSeed) {
  await testState.db.current.execute({
    sql: `INSERT INTO ea_todoist_sync_state
            (user_id, sync_token, status, last_success_at, last_error, sync_started_at,
             sync_requested_at, sync_request_reason, last_check_failed_at, failed_check_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      fields.userId || "u1",
      fields.syncToken || "sync-token",
      fields.status || "idle",
      fields.lastSuccessAt || null,
      fields.lastError || null,
      fields.syncStartedAt || null,
      fields.syncRequestedAt || null,
      fields.syncRequestReason || null,
      fields.lastCheckFailedAt || null,
      fields.failedCheckCount || 0,
      fields.updatedAt || fields.lastSuccessAt || "2026-05-04T15:00:00.000Z",
    ],
  });
}

async function seedCompletedOccurrence({ userId = "u1", todoistId, dueDate, completedAt = "2026-06-20T18:47:33.000Z" }: {
  userId?: string;
  todoistId: string;
  dueDate: string;
  completedAt?: string;
}) {
  await testState.db.current.execute({
    sql: `INSERT INTO ea_completed_tasks (user_id, todoist_id, completed_at, due_date, snapshot_json)
          VALUES (?, ?, ?, ?, ?)`,
    args: [userId, todoistId, completedAt, dueDate, "{}"],
  });
}

async function listCompletedOccurrences(userId = "u1") {
  const result = await testState.db.current.execute({
    sql: "SELECT todoist_id, due_date FROM ea_completed_tasks WHERE user_id = ? ORDER BY todoist_id, due_date",
    args: [userId],
  });
  return result.rows.map((row) => ({ todoistId: String(row.todoist_id), dueDate: String(row.due_date) }));
}

beforeEach(async () => {
  testState.db.current = await createTodoistMirrorTestDb();
});

afterEach(async () => {
  clearCurrentDashboardEventSubscribers();
  await testState.db.current?.close?.();
  testState.db.current = null as unknown as Client;
});

describe("recordTodoistSyncRequest", () => {
  it("publishes a current-dashboard refetch hint when pending Todoist work is recorded", async () => {
    const events: unknown[] = [];
    subscribeCurrentDashboardEvents("u1", (event) => events.push(event));

    await recordTodoistSyncRequest("u1", {
      dbClient: testState.db.current,
      reason: "todoist-webhook",
      now: new Date("2026-05-05T00:10:00.000Z"),
    });

    expect(events).toEqual([{
      type: "dashboard_current_changed",
      source: "todoist",
      reason: "todoist-webhook",
      state: "needs_sync",
      occurredAt: "2026-05-05T00:10:00.000Z",
    }]);
  });
});

describe("syncTodoistMirror", () => {
  it("persists normalized item, project, and label state through mirror reads", async () => {
    await seedTodoistToken();
    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient: vi.fn(async () => ({
        full_sync: true,
        sync_token: "field-sync-token",
        items: [{
          id: 7,
          project_id: 3,
          content: "Prepare report",
          description: "Include the latest figures",
          checked: false,
          is_deleted: false,
          due: {
            date: "2026-05-05T09:30:00",
            timezone: "America/Los_Angeles",
            is_recurring: true,
          },
          priority: 4,
          labels: [9],
        }],
        projects: [{ id: 3, name: "School", is_inbox_project: true }],
        labels: [{ id: 9, name: "school", color: "green" }],
      })),
      now: new Date("2026-05-04T15:00:00.000Z"),
      forceFull: true,
    });
    await expect(listTodoistMirrorActiveTasks("u1", { dbClient: testState.db.current })).resolves.toEqual([{
      id: "7",
      project_id: "3",
      content: "Prepare report",
      description: "Include the latest figures",
      checked: false,
      is_deleted: false,
      due: { date: "2026-05-05T09:30:00", timezone: "America/Los_Angeles", is_recurring: true },
      priority: 4,
      labels: ["9"],
    }]);
    await expect(listTodoistMirrorProjects("u1", { dbClient: testState.db.current })).resolves.toEqual([
      { id: "3", name: "School", color: null, isInbox: true },
    ]);
    await expect(listTodoistMirrorLabels("u1", { dbClient: testState.db.current })).resolves.toEqual([
      { id: "9", name: "school", color: "green" },
    ]);
    const itemRow = await testState.db.current.execute(
      "SELECT item_id, due_date, due_datetime, due_timezone, due_is_recurring, priority, labels_json FROM ea_todoist_items WHERE user_id = 'u1'",
    );
    expect(itemRow.rows).toEqual([{
      item_id: "7",
      due_date: "2026-05-05",
      due_datetime: "2026-05-05T09:30:00",
      due_timezone: "America/Los_Angeles",
      due_is_recurring: 1,
      priority: 4,
      labels_json: "[9]",
    }]);
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
    // test-architecture: allow-boundary-interaction -- Todoist Sync HTTP is the outbound provider boundary; incremental sync must send the exact stored cursor and requested resource types.
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

  it("tombstones resources absent from a full sync and hides them from mirror reads", async () => {
    await seedTodoistToken();
    const syncApiClient = vi.fn()
      .mockResolvedValueOnce({
        full_sync: true,
        sync_token: "full-sync-1",
        items: [{ id: "item-1", content: "Keep until refresh", checked: false }],
        projects: [{ id: "project-1", name: "School" }],
        labels: [{ id: "label-1", is_deleted: true }],
      })
      .mockResolvedValueOnce({
        full_sync: true,
        sync_token: "full-sync-2",
        items: [],
        projects: [],
        labels: [],
      });
    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-05-04T15:00:00.000Z"),
      forceFull: true,
    });
    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-05-04T15:10:00.000Z"),
      forceFull: true,
    });
    await expect(listTodoistMirrorActiveTasks("u1", { dbClient: testState.db.current })).resolves.toEqual([]);
    await expect(listTodoistMirrorProjects("u1", { dbClient: testState.db.current })).resolves.toEqual([]);
    await expect(listTodoistMirrorLabels("u1", { dbClient: testState.db.current })).resolves.toEqual([]);

    const [items, projects, labels] = await Promise.all([
      testState.db.current.execute("SELECT item_id, is_deleted, deleted_at FROM ea_todoist_items WHERE user_id = 'u1'"),
      testState.db.current.execute("SELECT project_id, is_deleted, deleted_at FROM ea_todoist_projects WHERE user_id = 'u1'"),
      testState.db.current.execute("SELECT label_id, name, color, is_deleted, deleted_at FROM ea_todoist_labels WHERE user_id = 'u1'"),
    ]);
    expect(items.rows).toEqual([{ item_id: "item-1", is_deleted: 1, deleted_at: "2026-05-04T15:10:00.000Z" }]);
    expect(projects.rows).toEqual([{ project_id: "project-1", is_deleted: 1, deleted_at: "2026-05-04T15:10:00.000Z" }]);
    expect(labels.rows).toEqual([{ label_id: "label-1", name: "", color: null, is_deleted: 1, deleted_at: "2026-05-04T15:10:00.000Z" }]);
  });

  it("preserves a sync request raised during apply until a later sync consumes it", async () => {
    await seedTodoistToken();
    const syncApiClient = vi.fn(async () => {
      await recordTodoistSyncRequest("u1", {
        dbClient: testState.db.current,
        reason: "todoist-webhook",
        now: new Date("2026-05-04T15:00:05.000Z"),
      });
      return { sync_token: "pending-sync-token", items: [], projects: [], labels: [] };
    });
    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-05-04T15:00:00.000Z"),
    });
    const pending = await testState.db.current.execute(
      "SELECT sync_requested_at, sync_request_reason FROM ea_todoist_sync_state WHERE user_id = 'u1'",
    );
    expect(pending.rows).toEqual([{
      sync_requested_at: "2026-05-04T15:00:05.000Z",
      sync_request_reason: "todoist-webhook",
    }]);
    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient: vi.fn(async () => ({ sync_token: "later-sync-token", items: [], projects: [], labels: [] })),
      now: new Date("2026-05-04T15:10:00.000Z"),
    });
    const consumed = await testState.db.current.execute(
      "SELECT sync_requested_at, sync_request_reason FROM ea_todoist_sync_state WHERE user_id = 'u1'",
    );
    expect(consumed.rows).toEqual([{ sync_requested_at: null, sync_request_reason: null }]);
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

    const invalidTokenError = Object.assign(new Error("Invalid sync token"), { status: 400 });
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

    // test-architecture: allow-boundary-interaction -- Todoist Sync HTTP is the outbound provider boundary; an expired cursor must first be attempted exactly as stored.
    expect(syncApiClient).toHaveBeenNthCalledWith(1, {
      token: "todoist-token",
      syncToken: "expired-sync-token",
      resourceTypes: ["items", "projects", "labels"],
    });
    // test-architecture: allow-boundary-interaction -- Todoist compatibility recovery requires one full-sync retry using the '*' cursor after provider rejection.
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

  it("resets status to idle and records last_error when the '*' full retry fails (P3-62)", async () => {
    await seedTodoistToken();
    await seedSyncState({
      syncToken: "stored-sync-token",
      lastSuccessAt: "2026-05-04T15:00:00.000Z",
    });

    const invalidTokenError = Object.assign(new Error("Invalid sync token"), { status: 400 });
    const retryFailure = Object.assign(new Error("Todoist API 502: upstream"), { status: 502 });
    const syncApiClient = vi.fn()
      .mockRejectedValueOnce(invalidTokenError)
      .mockRejectedValueOnce(retryFailure);

    await expect(syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-05-04T15:15:00.000Z"),
    })).rejects.toThrow("Todoist API 502");

    // test-architecture: allow-boundary-interaction -- Todoist Sync HTTP is outbound; cursor rejection permits exactly one full retry before durable degradation.
    expect(syncApiClient).toHaveBeenCalledTimes(2);

    const state = await testState.db.current.execute("SELECT * FROM ea_todoist_sync_state WHERE user_id = 'u1'");
    expect(state.rows[0]).toMatchObject({
      status: "idle",
      sync_token: "stored-sync-token",
      last_error: "Todoist API 502: upstream",
      sync_started_at: null,
      last_check_failed_at: "2026-05-04T15:15:00.000Z",
      failed_check_count: 1,
    });

    await expect(getTodoistMirrorHealth("u1", {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T15:16:00.000Z"),
    })).resolves.toMatchObject({
      state: "current",
      lastError: "Todoist API 502: upstream",
    });
  });

  it("runs at most one sync per user and coalesces concurrent triggers (P3-63)", async () => {
    await seedTodoistToken();
    await seedSyncState({
      syncToken: "stored-sync-token",
      lastSuccessAt: "2026-05-04T15:00:00.000Z",
    });

    let releaseFetch;
    const fetchGate = new Promise((resolve) => {
      releaseFetch = resolve;
    });
    const syncApiClient = vi.fn(async () => {
      await fetchGate;
      return {
        full_sync: true,
        sync_token: "coalesced-sync-token",
        items: [],
        projects: [],
        labels: [],
      };
    });

    const first = syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-05-04T15:10:00.000Z"),
      forceFull: true,
    });
    const second = syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-05-04T15:10:05.000Z"),
    });

    expect(second).toBe(first);

    releaseFetch!();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    // test-architecture: allow-boundary-interaction -- Todoist Sync HTTP is outbound provider work protected by per-user single-flight admission.
    expect(syncApiClient).toHaveBeenCalledTimes(1);
    expect(firstResult).toBe(secondResult);
    expect(firstResult).toMatchObject({
      status: "current",
      syncToken: "coalesced-sync-token",
    });

    const followUp = vi.fn(async () => ({
      full_sync: false,
      sync_token: "follow-up-token",
      items: [],
      projects: [],
      labels: [],
    }));
    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient: followUp,
      now: new Date("2026-05-04T15:11:00.000Z"),
    });
    // test-architecture: allow-boundary-interaction -- Coalesced follow-up admission is a background-process boundary; concurrent triggers must schedule one later sync.
    expect(followUp).toHaveBeenCalledTimes(1);
  });
});

describe("syncTodoistMirror completed-occurrence reconciliation", () => {
  it("clears the stale completion tombstone when a non-recurring task is reopened in Todoist", async () => {
    await seedTodoistToken();
    await seedSyncState({ lastSuccessAt: "2026-06-20T18:00:00.000Z" });
    await seedCompletedOccurrence({ todoistId: "chore-1", dueDate: "2026-06-20" });

    const syncApiClient = vi.fn(async () => ({
      sync_token: "sync-token-reopen",
      items: [{
        id: "chore-1",
        content: "Mop and clean",
        checked: false,
        is_deleted: false,
        due: { date: "2026-06-20", is_recurring: false },
      }],
    }));

    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-06-20T19:05:00.000Z"),
    });

    await expect(listCompletedOccurrences("u1")).resolves.toEqual([]);
  });

  it("preserves a recurring task's tombstone even when an occurrence is reported active again (resurrection guard)", async () => {
    await seedTodoistToken();
    await seedSyncState({ lastSuccessAt: "2026-06-20T18:00:00.000Z" });
    await seedCompletedOccurrence({ todoistId: "recur-1", dueDate: "2026-06-20" });

    const syncApiClient = vi.fn(async () => ({
      sync_token: "sync-token-resurrect",
      items: [{
        id: "recur-1",
        content: "Check-in",
        checked: false,
        is_deleted: false,
        due: { date: "2026-06-20", is_recurring: true },
      }],
    }));

    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-06-20T19:05:00.000Z"),
    });

    await expect(listCompletedOccurrences("u1")).resolves.toEqual([
      { todoistId: "recur-1", dueDate: "2026-06-20" },
    ]);
  });

  it("heals a pre-existing stale tombstone for a task the mirror already holds as active, even when it is absent from this sync's delta", async () => {
    await seedTodoistToken();
    await seedSyncState({ lastSuccessAt: "2026-06-20T18:00:00.000Z" });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_todoist_items
              (user_id, item_id, content, checked, is_deleted, due_date, due_is_recurring, synced_at, updated_at)
            VALUES (?, ?, ?, 0, 0, ?, 0, ?, ?)`,
      args: ["u1", "old-1", "Mop and clean", "2026-06-18", "2026-06-18T00:00:00.000Z", "2026-06-18T00:00:00.000Z"],
    });
    await seedCompletedOccurrence({ todoistId: "old-1", dueDate: "2026-06-18" });

    const syncApiClient = vi.fn(async () => ({
      sync_token: "sync-token-unrelated",
      items: [{
        id: "other-1",
        content: "Buy groceries",
        checked: false,
        is_deleted: false,
        due: { date: "2026-06-21", is_recurring: false },
      }],
    }));

    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient,
      now: new Date("2026-06-20T19:05:00.000Z"),
    });

    await expect(listCompletedOccurrences("u1")).resolves.toEqual([]);
  });
});
