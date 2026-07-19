import { createClient } from "@libsql/client";
import path from "node:path";
import type { Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import {
  disconnectTodoistConnection,
  saveTodoistPersonalTokenCandidate,
} from "./todoist-personal-token.ts";

describe("saveTodoistPersonalTokenCandidate", () => {
  let db: Client;
  let dir: string;

  beforeEach(async () => {
    dir = await createTestTempDir("todoist-personal-token-");
    db = createClient({ url: `file:${path.join(dir, "test.db")}` });
    await db.executeMultiple(`
      CREATE TABLE ea_settings (
        user_id TEXT PRIMARY KEY,
        todoist_api_token_encrypted TEXT,
        todoist_oauth_refresh_token_encrypted TEXT,
        todoist_oauth_access_token_expires_at TEXT,
        todoist_oauth_scope TEXT,
        todoist_oauth_token_type TEXT,
        todoist_connection_mode TEXT,
        todoist_needs_reauth INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO ea_settings (
        user_id,
        todoist_api_token_encrypted,
        todoist_oauth_refresh_token_encrypted,
        todoist_connection_mode
      ) VALUES ('owner-1', 'enc:oauth-access', 'enc:oauth-refresh', 'oauth');
      CREATE TABLE ea_todoist_sync_state (
        user_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'idle',
        last_success_at TEXT,
        last_error TEXT,
        last_check_failed_at TEXT,
        failed_check_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT
      );
      CREATE TABLE ea_completed_tasks (
        user_id TEXT NOT NULL,
        todoist_id TEXT NOT NULL
      );
      INSERT INTO ea_completed_tasks (user_id, todoist_id) VALUES ('owner-1', 'task-1');
    `);
  });

  afterEach(async () => {
    db.close();
    await removeTempDir(dir);
  });

  it("preserves the working token and OAuth mode when candidate validation fails", async () => {
    const validateToken = vi.fn().mockRejectedValue(new Error("Todoist rejected the token"));

    await expect(saveTodoistPersonalTokenCandidate("owner-1", "candidate-token", {
      dbClient: db,
      encryptValue: (value) => `enc:${value}`,
      validateToken,
    })).rejects.toThrow("Todoist personal token could not be verified");

    const stored = await db.execute({
      sql: `SELECT todoist_api_token_encrypted,
                   todoist_oauth_refresh_token_encrypted,
                   todoist_connection_mode
            FROM ea_settings WHERE user_id = ?`,
      args: ["owner-1"],
    });
    expect(stored.rows[0]).toMatchObject({
      todoist_api_token_encrypted: "enc:oauth-access",
      todoist_oauth_refresh_token_encrypted: "enc:oauth-refresh",
      todoist_connection_mode: "oauth",
    });
  });

  it("atomically promotes a verified personal token and records verification evidence", async () => {
    await saveTodoistPersonalTokenCandidate("owner-1", "candidate-token", {
      dbClient: db,
      encryptValue: (value) => `enc:${value}`,
      validateToken: vi.fn().mockResolvedValue({}),
      now: new Date("2026-07-19T18:00:00.000Z"),
    });

    const stored = await db.execute({
      sql: `SELECT todoist_api_token_encrypted, todoist_oauth_refresh_token_encrypted,
                   todoist_connection_mode, todoist_needs_reauth
            FROM ea_settings WHERE user_id = ?`,
      args: ["owner-1"],
    });
    expect(stored.rows[0]).toMatchObject({
      todoist_api_token_encrypted: "enc:candidate-token",
      todoist_oauth_refresh_token_encrypted: null,
      todoist_connection_mode: "personal_token",
      todoist_needs_reauth: 0,
    });
    const health = await db.execute("SELECT last_success_at, last_check_failed_at FROM ea_todoist_sync_state");
    expect(health.rows[0]).toMatchObject({
      last_success_at: "2026-07-19T18:00:00.000Z",
      last_check_failed_at: null,
    });
  });

  it("disconnects Todoist while preserving mirrored data and clearing completed-task snapshots", async () => {
    await disconnectTodoistConnection("owner-1", { dbClient: db });
    const stored = await db.execute({
      sql: `SELECT todoist_api_token_encrypted, todoist_oauth_refresh_token_encrypted,
                   todoist_connection_mode, todoist_needs_reauth
            FROM ea_settings WHERE user_id = ?`,
      args: ["owner-1"],
    });
    expect(stored.rows[0]).toMatchObject({
      todoist_api_token_encrypted: null,
      todoist_oauth_refresh_token_encrypted: null,
      todoist_connection_mode: null,
      todoist_needs_reauth: 0,
    });
    expect((await db.execute("SELECT * FROM ea_completed_tasks")).rows).toHaveLength(0);
  });
});
