import { createClient } from "@libsql/client";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import {
  removeActualConnection,
  saveActualConnectionCandidate,
} from "./actual-connection-settings.ts";

describe("saveActualConnectionCandidate", () => {
  let db: Client;
  let dir: string;

  beforeEach(async () => {
    dir = await createTestTempDir("actual-connection-");
    db = createClient({ url: `file:${path.join(dir, "test.db")}` });
    await db.executeMultiple(`
      CREATE TABLE ea_settings (
        user_id TEXT PRIMARY KEY,
        actual_budget_url TEXT,
        actual_budget_password_encrypted TEXT,
        actual_budget_sync_id TEXT
      );
      CREATE TABLE ea_actual_metadata_mirror (
        user_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'needs_sync',
        last_success_at TEXT,
        last_attempt_at TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO ea_settings (
        user_id,
        actual_budget_url,
        actual_budget_password_encrypted,
        actual_budget_sync_id
      ) VALUES (
        'owner-1',
        'https://working.actual.test',
        'enc:working-password',
        'working-sync'
      );
    `);
  });

  afterEach(async () => {
    db.close();
    await removeTempDir(dir);
  });

  it("leaves the working connection unchanged when candidate validation fails", async () => {
    const testConnection = vi.fn().mockRejectedValue(
      Object.assign(new Error("Actual Budget connection failed"), { status: 400 }),
    );

    await expect(saveActualConnectionCandidate("owner-1", {
      serverURL: "https://candidate.actual.test",
      password: "candidate-password",
      syncId: "candidate-sync",
    }, {
      dbClient: db,
      encryptValue: (value) => `enc:${value}`,
      testConnection,
    })).rejects.toThrow("Actual Budget connection failed");

    const stored = await db.execute({
      sql: `SELECT actual_budget_url, actual_budget_password_encrypted, actual_budget_sync_id
            FROM ea_settings WHERE user_id = ?`,
      args: ["owner-1"],
    });

    expect(stored.rows[0]).toMatchObject({
      actual_budget_url: "https://working.actual.test",
      actual_budget_password_encrypted: "enc:working-password",
      actual_budget_sync_id: "working-sync",
    });
  });

  it("preserves the stored password when a verified replacement leaves it blank", async () => {
    await saveActualConnectionCandidate("owner-1", {
      serverURL: "https://replacement.actual.test/",
      syncId: "replacement-sync",
    }, {
      dbClient: db,
      encryptValue: (value) => `enc:${value}`,
      testConnection: vi.fn().mockResolvedValue({
        success: true,
        budgetCount: 1,
        budgetFound: true,
      }),
      now: () => new Date("2026-07-19T18:00:00.000Z"),
    });

    const stored = await db.execute({
      sql: `SELECT actual_budget_url, actual_budget_password_encrypted, actual_budget_sync_id
            FROM ea_settings WHERE user_id = ?`,
      args: ["owner-1"],
    });
    expect(stored.rows[0]).toMatchObject({
      actual_budget_url: "https://replacement.actual.test",
      actual_budget_password_encrypted: "enc:working-password",
      actual_budget_sync_id: "replacement-sync",
    });
    const evidence = await db.execute({
      sql: "SELECT status, last_success_at, last_error FROM ea_actual_metadata_mirror WHERE user_id = ?",
      args: ["owner-1"],
    });
    expect(evidence.rows[0]).toMatchObject({
      status: "ready",
      last_success_at: "2026-07-19T18:00:00.000Z",
      last_error: null,
    });
  });

  it("removes only the Actual connection credentials", async () => {
    await removeActualConnection("owner-1", { dbClient: db });
    const stored = await db.execute({
      sql: `SELECT actual_budget_url, actual_budget_password_encrypted, actual_budget_sync_id
            FROM ea_settings WHERE user_id = ?`,
      args: ["owner-1"],
    });
    expect(stored.rows[0]).toMatchObject({
      actual_budget_url: null,
      actual_budget_password_encrypted: null,
      actual_budget_sync_id: null,
    });
  });
});
