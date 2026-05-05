import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { createAuthTestDb, hashSessionToken, seedSession } from "../test-utils/auth-db.js";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
  },
}));

const { createSession, validateSession, deleteSession } = await import("./auth.js");

describe("auth middleware session storage", () => {
  beforeEach(async () => {
    testState.db.current = await createAuthTestDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("stores hashed session tokens and returns the raw cookie value", async () => {
    const before = Date.now();
    vi.spyOn(crypto, "randomBytes").mockReturnValue(Buffer.alloc(32, 1));

    const rawToken = await createSession();

    const expectedRaw = Buffer.alloc(32, 1).toString("hex");
    const expectedStored = hashSessionToken(expectedRaw);
    const result = await testState.db.current.execute({
      sql: "SELECT token, expires_at FROM ea_sessions",
      args: [],
    });

    expect(rawToken).toBe(expectedRaw);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].token).toBe(expectedStored);
    expect(result.rows[0].token).not.toBe(rawToken);
    expect(result.rows[0].expires_at).toBeGreaterThan(before + 29 * 24 * 60 * 60 * 1000);
  });

  it("validates hashed session rows", async () => {
    await seedSession(testState.db.current, "cookie-session");

    const ok = await validateSession("cookie-session");

    const result = await testState.db.current.execute({
      sql: "SELECT token FROM ea_sessions",
      args: [],
    });
    expect(ok).toBe(true);
    expect(result.rows.map((row) => row.token)).toEqual([hashSessionToken("cookie-session")]);
  });

  it("accepts raw session rows and migrates them to hashed storage", async () => {
    await testState.db.current.execute({
      sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
      args: ["raw-session", Date.now() + 60_000],
    });

    const ok = await validateSession("raw-session");

    const result = await testState.db.current.execute({
      sql: "SELECT token FROM ea_sessions ORDER BY token",
      args: [],
    });
    expect(ok).toBe(true);
    expect(result.rows.map((row) => row.token)).toEqual([hashSessionToken("raw-session")]);
  });

  it("deletes both raw and hashed token forms on logout", async () => {
    await testState.db.current.batch([
      {
        sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
        args: ["logout-session", Date.now() + 60_000],
      },
      {
        sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
        args: [hashSessionToken("logout-session"), Date.now() + 60_000],
      },
    ]);

    await deleteSession("logout-session");

    const result = await testState.db.current.execute({
      sql: "SELECT token FROM ea_sessions",
      args: [],
    });
    expect(result.rows).toHaveLength(0);
  });
});
