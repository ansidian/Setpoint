import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../db/migrations");
const testState = vi.hoisted(() => ({ db: { current: null as unknown as Client } }));

// test-architecture: allow-boundary-mock -- The migrated ephemeral database is the persistence boundary for Todoist mirror normalization.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement | string) => testState.db.current.execute(statement),
    batch: (statements: InStatement[]) => testState.db.current.batch(statements),
  },
}));
// test-architecture: allow-boundary-mock -- Test credentials are already plaintext at the encryption boundary.
vi.mock("../platform/encryption.ts", () => ({ decrypt: (value: unknown) => value }));
const { listTodoistMirrorActiveTasks, syncTodoistMirror } = await import("./todoist-mirror.ts");

beforeEach(async () => {
  testState.db.current = createClient({ url: "file::memory:" });
  await testState.db.current.executeMultiple(readFileSync(join(migrationsDir, "001_ea_tables.sql"), "utf8"));
  await testState.db.current.executeMultiple(readFileSync(join(migrationsDir, "010_discord_reminders.sql"), "utf8"));
  await testState.db.current.execute({
    sql: "INSERT INTO ea_settings (user_id, todoist_api_token_encrypted) VALUES (?, ?)",
    args: ["u1", "todoist-token"],
  });
});

afterEach(async () => {
  await testState.db.current.close();
  testState.db.current = null as unknown as Client;
});

describe("Todoist mirror resource defaults", () => {
  it("persists null defaults and minimal deleted resources through the mirror facade", async () => {
    await syncTodoistMirror("u1", {
      dbClient: testState.db.current,
      syncApiClient: vi.fn(async () => ({
        full_sync: false,
        sync_token: "minimal-sync-token",
        items: [
          { id: "minimal-active", content: null, description: null, labels: null, due: null },
          { id: "minimal-deleted", is_deleted: true },
        ],
        projects: [{ id: "deleted-project", is_deleted: true }],
        labels: [{ id: "deleted-label", is_deleted: true }],
      })),
      now: new Date("2026-05-04T15:20:00.000Z"),
    });

    await expect(listTodoistMirrorActiveTasks("u1", { dbClient: testState.db.current })).resolves.toEqual([]);
    const [items, projects, labels] = await Promise.all([
      testState.db.current.execute(`SELECT item_id, project_id, section_id, parent_id, content, description,
        checked, is_deleted, due_date, due_datetime, due_timezone, due_is_recurring,
        priority, labels_json, deleted_at FROM ea_todoist_items WHERE user_id = 'u1' ORDER BY item_id`),
      testState.db.current.execute("SELECT project_id, name, color, is_inbox_project, is_deleted, deleted_at FROM ea_todoist_projects WHERE user_id = 'u1'"),
      testState.db.current.execute("SELECT label_id, name, color, is_deleted, deleted_at FROM ea_todoist_labels WHERE user_id = 'u1'"),
    ]);
    expect(items.rows).toEqual([
      {
        item_id: "minimal-active", project_id: null, section_id: null, parent_id: null,
        content: "", description: "", checked: 0, is_deleted: 0, due_date: null,
        due_datetime: null, due_timezone: null, due_is_recurring: 0, priority: null,
        labels_json: "[]", deleted_at: null,
      },
      expect.objectContaining({
        item_id: "minimal-deleted", content: "", description: "", is_deleted: 1,
        deleted_at: "2026-05-04T15:20:00.000Z",
      }),
    ]);
    expect(projects.rows).toEqual([{
      project_id: "deleted-project", name: "", color: null, is_inbox_project: 0,
      is_deleted: 1, deleted_at: "2026-05-04T15:20:00.000Z",
    }]);
    expect(labels.rows).toEqual([{
      label_id: "deleted-label", name: "", color: null, is_deleted: 1,
      deleted_at: "2026-05-04T15:20:00.000Z",
    }]);
  });
});
