import { describe, it, expect, afterEach } from "vitest";
import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  isInvalidGrantError,
  markAccountNeedsReauth,
  clearAccountNeedsReauth,
  markTodoistNeedsReauth,
  clearTodoistNeedsReauth,
} from "./provider-reauth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"));

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  for (const sql of migrationSql) {
    await db.executeMultiple(sql);
  }
  return db;
}

describe("provider-reauth", () => {
  let db;

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("isInvalidGrantError", () => {
    it("returns true when error message contains invalid_grant (case-insensitive)", () => {
      expect(isInvalidGrantError('Token refresh failed for a@b.c: {"error":"invalid_grant')).toBe(true);
    });

    it("returns true when error message contains INVALID_GRANT in uppercase", () => {
      expect(isInvalidGrantError('Error: INVALID_GRANT')).toBe(true);
    });

    it("returns false when error message does not contain invalid_grant", () => {
      expect(isInvalidGrantError('Token refresh failed: 429 Too Many Requests')).toBe(false);
    });

    it("returns false when error message is empty", () => {
      expect(isInvalidGrantError('')).toBe(false);
    });

    it("returns false when given null or undefined", () => {
      expect(isInvalidGrantError(null)).toBe(false);
      expect(isInvalidGrantError(undefined)).toBe(false);
    });
  });

  describe("markAccountNeedsReauth and clearAccountNeedsReauth", () => {
    it("marks an account as needing reauth", async () => {
      db = await createMigratedDb();

      // Insert a test account first
      await db.execute({
        sql: `INSERT INTO ea_accounts (user_id, id, type, email, label, needs_reauth)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: ["user-1", "gmail-test", "gmail", "test@example.com", "Test", 0],
      });

      // Mark it as needing reauth
      const result = await markAccountNeedsReauth("gmail-test", { dbClient: db });
      expect(result.rowsAffected).toBe(1);

      // Verify the flag is set
      const account = await db.execute({
        sql: "SELECT needs_reauth FROM ea_accounts WHERE id = ?",
        args: ["gmail-test"],
      });
      expect(account.rows[0].needs_reauth).toBe(1);
    });

    it("marking again issues no row change (WHERE-guarded)", async () => {
      db = await createMigratedDb();

      // Insert a test account
      await db.execute({
        sql: `INSERT INTO ea_accounts (user_id, id, type, email, label, needs_reauth)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: ["user-1", "gmail-test", "gmail", "test@example.com", "Test", 1],
      });

      // Mark it again (should have no effect)
      const result = await markAccountNeedsReauth("gmail-test", { dbClient: db });
      expect(result.rowsAffected).toBe(0);
    });

    it("clears the reauth flag on an account", async () => {
      db = await createMigratedDb();

      // Insert a test account with flag set
      await db.execute({
        sql: `INSERT INTO ea_accounts (user_id, id, type, email, label, needs_reauth)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: ["user-1", "gmail-test", "gmail", "test@example.com", "Test", 1],
      });

      // Clear the flag
      const result = await clearAccountNeedsReauth("gmail-test", { dbClient: db });
      expect(result.rowsAffected).toBe(1);

      // Verify the flag is cleared
      const account = await db.execute({
        sql: "SELECT needs_reauth FROM ea_accounts WHERE id = ?",
        args: ["gmail-test"],
      });
      expect(account.rows[0].needs_reauth).toBe(0);
    });

    it("clearing when flag is already 0 issues no row change", async () => {
      db = await createMigratedDb();

      // Insert a test account with flag not set
      await db.execute({
        sql: `INSERT INTO ea_accounts (user_id, id, type, email, label, needs_reauth)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: ["user-1", "gmail-test", "gmail", "test@example.com", "Test", 0],
      });

      // Clear the flag (should have no effect)
      const result = await clearAccountNeedsReauth("gmail-test", { dbClient: db });
      expect(result.rowsAffected).toBe(0);
    });
  });

  describe("markTodoistNeedsReauth and clearTodoistNeedsReauth", () => {
    it("marks Todoist as needing reauth", async () => {
      db = await createMigratedDb();

      // Insert a test settings row
      await db.execute({
        sql: `INSERT INTO ea_settings (user_id, todoist_needs_reauth)
              VALUES (?, ?)`,
        args: ["user-1", 0],
      });

      // Mark Todoist as needing reauth
      const result = await markTodoistNeedsReauth("user-1", { dbClient: db });
      expect(result.rowsAffected).toBe(1);

      // Verify the flag is set
      const settings = await db.execute({
        sql: "SELECT todoist_needs_reauth FROM ea_settings WHERE user_id = ?",
        args: ["user-1"],
      });
      expect(settings.rows[0].todoist_needs_reauth).toBe(1);
    });

    it("marking Todoist again issues no row change", async () => {
      db = await createMigratedDb();

      // Insert a test settings row with flag already set
      await db.execute({
        sql: `INSERT INTO ea_settings (user_id, todoist_needs_reauth)
              VALUES (?, ?)`,
        args: ["user-1", 1],
      });

      // Mark again (should have no effect)
      const result = await markTodoistNeedsReauth("user-1", { dbClient: db });
      expect(result.rowsAffected).toBe(0);
    });

    it("clears Todoist reauth flag", async () => {
      db = await createMigratedDb();

      // Insert a test settings row with flag set
      await db.execute({
        sql: `INSERT INTO ea_settings (user_id, todoist_needs_reauth)
              VALUES (?, ?)`,
        args: ["user-1", 1],
      });

      // Clear the flag
      const result = await clearTodoistNeedsReauth("user-1", { dbClient: db });
      expect(result.rowsAffected).toBe(1);

      // Verify the flag is cleared
      const settings = await db.execute({
        sql: "SELECT todoist_needs_reauth FROM ea_settings WHERE user_id = ?",
        args: ["user-1"],
      });
      expect(settings.rows[0].todoist_needs_reauth).toBe(0);
    });

    it("clearing Todoist when flag is already 0 issues no row change", async () => {
      db = await createMigratedDb();

      // Insert a test settings row with flag not set
      await db.execute({
        sql: `INSERT INTO ea_settings (user_id, todoist_needs_reauth)
              VALUES (?, ?)`,
        args: ["user-1", 0],
      });

      // Clear the flag (should have no effect)
      const result = await clearTodoistNeedsReauth("user-1", { dbClient: db });
      expect(result.rowsAffected).toBe(0);
    });
  });
});
