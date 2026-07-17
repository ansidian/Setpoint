import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { createAuthTestDb, hashApiToken, hashSessionToken, seedSession } from "../test-utils/auth-db.ts";
import type { Client, InStatement } from "@libsql/client";

const testState = vi.hoisted<{ db: { current: Client | null } }>(() => ({
  db: { current: null },
}));

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test database is not initialized");
  return testState.db.current;
}

vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement) => currentDb().execute(statement),
  },
}));

const {
  createSession,
  validateSession,
  deleteSession,
  validateBearer,
  hasRecentAuth,
  markSessionRecentlyAuthenticated,
  __clearSessionValidationCache,
} = await import("./auth.ts");

async function seedApiToken(
  db: Client,
  raw: string,
  { scopes = ["actual:write"], expiresAt }: { scopes?: string[]; expiresAt: number | null },
) {
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
    testState.db.current?.close();
    testState.db.current = null;
  });

  it("stores hashed session tokens and returns the raw cookie value", async () => {
    const before = Date.now();
    vi.spyOn(crypto, "randomBytes").mockImplementation(((size: number) => (
      Buffer.alloc(size, 1)
    )) as typeof crypto.randomBytes);

    const rawToken = await createSession();

    const expectedRaw = Buffer.alloc(32, 1).toString("hex");
    const expectedStored = hashSessionToken(expectedRaw);
    const result = await currentDb().execute({
      sql: "SELECT token, expires_at FROM ea_sessions",
      args: [],
    });

    expect(rawToken).toBe(expectedRaw);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.token).toBe(expectedStored);
    expect(result.rows[0]!.token).not.toBe(rawToken);
    expect(result.rows[0]!.expires_at).toBeGreaterThan(before + 29 * 24 * 60 * 60 * 1000);
  });

  it("tracks recent authentication on the hashed session without exposing the token", async () => {
    const token = await createSession({ authenticatedAt: 1_000 });

    await expect(hasRecentAuth(token, { now: 1_000 + 9 * 60_000 })).resolves.toBe(true);
    await expect(hasRecentAuth(token, { now: 1_000 + 11 * 60_000 })).resolves.toBe(false);

    await markSessionRecentlyAuthenticated(token, 20_000);
    await expect(hasRecentAuth(token, { now: 20_001 })).resolves.toBe(true);
  });

  it("validates hashed session rows", async () => {
    await seedSession(currentDb(), "cookie-session");

    const ok = await validateSession("cookie-session");

    const result = await currentDb().execute({
      sql: "SELECT token FROM ea_sessions",
      args: [],
    });
    expect(ok).toBe(true);
    expect(result.rows.map((row) => row.token)).toEqual([hashSessionToken("cookie-session")]);
  });

  it("accepts raw session rows and migrates them to hashed storage", async () => {
    await currentDb().execute({
      sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
      args: ["raw-session", Date.now() + 60_000],
    });

    const ok = await validateSession("raw-session");

    const result = await currentDb().execute({
      sql: "SELECT token FROM ea_sessions ORDER BY token",
      args: [],
    });
    expect(ok).toBe(true);
    expect(result.rows.map((row) => row.token)).toEqual([hashSessionToken("raw-session")]);
  });

  it("authenticates an unexpired api token and returns its scopes", async () => {
    await seedApiToken(currentDb(), "eatk_live", {
      scopes: ["actual:write", "actual:read"],
      expiresAt: Date.now() + 60_000,
    });

    const ctx = await validateBearer("eatk_live");

    expect(ctx).not.toBeNull();
    expect(ctx!.scopes).toEqual(["actual:write", "actual:read"]);
  });

  it("rejects an api token whose expires_at has passed", async () => {
    await seedApiToken(currentDb(), "eatk_expired", {
      expiresAt: Date.now() - 1,
    });

    expect(await validateBearer("eatk_expired")).toBeNull();
  });

  it("rejects a legacy api token with NULL expires_at (fail closed)", async () => {
    await seedApiToken(currentDb(), "eatk_legacy", { expiresAt: null });

    expect(await validateBearer("eatk_legacy")).toBeNull();
  });

  it("deletes both raw and hashed token forms on logout", async () => {
    await currentDb().batch([
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

    const result = await currentDb().execute({
      sql: "SELECT token FROM ea_sessions",
      args: [],
    });
    expect(result.rows).toHaveLength(0);
  });

  it("sweeps expired sessions when a new session is created (P3-18)", async () => {
    await currentDb().execute({
      sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
      args: [hashSessionToken("stale-session"), Date.now() - 60_000],
    });

    await createSession();

    const rows = await currentDb().execute({
      sql: "SELECT token FROM ea_sessions WHERE token = ?",
      args: [hashSessionToken("stale-session")],
    });
    expect(rows.rows).toHaveLength(0);
  });

  it("serves a repeat validation from cache without re-querying the database (P2-27)", async () => {
    await seedSession(currentDb(), "cached-session");
    const spy = vi.spyOn(currentDb(), "execute");

    expect(await validateSession("cached-session")).toBe(true);
    const callsAfterFirst = spy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    expect(await validateSession("cached-session")).toBe(true);
    // Second validation is a cache hit: no additional DB round-trips.
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("invalidates the session cache on logout so a revoked token stops validating (P2-27)", async () => {
    await seedSession(currentDb(), "logout-cache-session");

    expect(await validateSession("logout-cache-session")).toBe(true); // populates cache
    await deleteSession("logout-cache-session"); // deletes row AND clears cache entry

    expect(await validateSession("logout-cache-session")).toBe(false);
  });
});
