import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { createAuthTestDb, hashApiToken, hashSessionToken, seedSession } from "../test-utils/auth-db.ts";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
  },
}));

const {
  createSession,
  validateSession,
  deleteSession,
  validateBearer,
  __clearSessionValidationCache,
} = await import("./auth.js");

async function seedApiToken(db, raw, { scopes = ["actual:write"], expiresAt } = {}) {
  await db.execute({
    sql: "INSERT INTO ea_api_tokens (token_hash, label, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    args: [hashApiToken(raw), "test-token", JSON.stringify(scopes), Date.now(), expiresAt],
  });
}

describe("auth middleware session storage", () => {
  beforeEach(async () => {
    testState.db.current = await createAuthTestDb();
    __clearSessionValidationCache();
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

  it("authenticates an unexpired api token and returns its scopes", async () => {
    await seedApiToken(testState.db.current, "eatk_live", {
      scopes: ["actual:write", "actual:read"],
      expiresAt: Date.now() + 60_000,
    });

    const ctx = await validateBearer("eatk_live");

    expect(ctx).not.toBeNull();
    expect(ctx.scopes).toEqual(["actual:write", "actual:read"]);
  });

  it("rejects an api token whose expires_at has passed", async () => {
    await seedApiToken(testState.db.current, "eatk_expired", {
      expiresAt: Date.now() - 1,
    });

    expect(await validateBearer("eatk_expired")).toBeNull();
  });

  it("rejects a legacy api token with NULL expires_at (fail closed)", async () => {
    await seedApiToken(testState.db.current, "eatk_legacy", { expiresAt: null });

    expect(await validateBearer("eatk_legacy")).toBeNull();
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

  it("sweeps expired sessions when a new session is created (P3-18)", async () => {
    await testState.db.current.execute({
      sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
      args: [hashSessionToken("stale-session"), Date.now() - 60_000],
    });

    await createSession();

    const rows = await testState.db.current.execute({
      sql: "SELECT token FROM ea_sessions WHERE token = ?",
      args: [hashSessionToken("stale-session")],
    });
    expect(rows.rows).toHaveLength(0);
  });

  it("serves a repeat validation from cache without re-querying the database (P2-27)", async () => {
    await seedSession(testState.db.current, "cached-session");
    const spy = vi.spyOn(testState.db.current, "execute");

    expect(await validateSession("cached-session")).toBe(true);
    const callsAfterFirst = spy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    expect(await validateSession("cached-session")).toBe(true);
    // Second validation is a cache hit: no additional DB round-trips.
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("invalidates the session cache on logout so a revoked token stops validating (P2-27)", async () => {
    await seedSession(testState.db.current, "logout-cache-session");

    expect(await validateSession("logout-cache-session")).toBe(true); // populates cache
    await deleteSession("logout-cache-session"); // deletes row AND clears cache entry

    expect(await validateSession("logout-cache-session")).toBe(false);
  });
});
