import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "../test-utils/supertest.ts";
import { createAuthTestDb, hashApiToken, hashSessionToken, seedOwner, seedSession } from "../test-utils/auth-db.ts";
import type { Client, InStatement } from "@libsql/client";

const testState = vi.hoisted<{ db: { current: Client | null } }>(() => ({
  db: { current: null },
}));

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test database is not initialized");
  return testState.db.current;
}

// test-architecture: allow-boundary-mock -- Redirects the production database singleton to a migrated ephemeral libSQL client; every assertion executes real SQL and observes durable rows.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement) => currentDb().execute(statement),
  },
}));

const {
  createSession,
  createRequireCookieSession,
  createRequireRecentPasswordAuth,
  getPasswordStepUpThrottle,
  recordPasswordStepUpFailure,
  validateSession,
  deleteSession,
  validateBearer,
  hasRecentPasswordAuth,
  markSessionPasswordAuthenticated,
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
    await seedOwner(currentDb(), { passwordHash: "hash" });
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

    const rawToken = await createSession({
      securityGeneration: 1,
      authMethod: "password",
      passwordAuthenticatedAt: 1_000,
    });

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

  it("does not treat a passkey as password proof and records an explicit password step-up", async () => {
    const token = await createSession({
      authenticatedAt: 1_000,
      passwordAuthenticatedAt: 0,
      authMethod: "passkey",
      securityGeneration: 1,
    });

    await expect(hasRecentPasswordAuth(token, { now: 1_001 })).resolves.toBe(false);

    await markSessionPasswordAuthenticated(token, 20_000);
    await expect(hasRecentPasswordAuth(token, { now: 20_001 })).resolves.toBe(true);
    await expect(hasRecentPasswordAuth(token, { now: 20_000 + 11 * 60_000 })).resolves.toBe(false);
  });

  it("refuses to issue a session against a stale owner security generation", async () => {
    await currentDb().execute("UPDATE ea_owner SET security_generation = 2");

    await expect(createSession({
      securityGeneration: 1,
      authMethod: "password",
      passwordAuthenticatedAt: Date.now(),
    })).resolves.toBeNull();
    expect((await currentDb().execute("SELECT token FROM ea_sessions")).rows).toEqual([]);
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

  it("rejects legacy raw session rows", async () => {
    await currentDb().execute({
      sql: "INSERT INTO ea_sessions (token, expires_at, security_generation) VALUES (?, ?, ?)",
      args: ["raw-session", Date.now() + 60_000, 1],
    });

    const ok = await validateSession("raw-session");

    const result = await currentDb().execute({
      sql: "SELECT token FROM ea_sessions ORDER BY token",
      args: [],
    });
    expect(ok).toBe(false);
    expect(result.rows.map((row) => row.token)).toEqual(["raw-session"]);
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

  it("rejects stored-hash replay at both cookie guards without changing the real session", async () => {
    const rawToken = await createSession({ securityGeneration: 1, authMethod: "password" });
    expect(rawToken).not.toBeNull();
    const storedToken = String((await currentDb().execute("SELECT token FROM ea_sessions")).rows[0]!.token);
    const app = express();
    app.use(cookieParser());
    app.get("/private", createRequireCookieSession(currentDb()), (_req, res) => res.json({ ok: true }));
    app.get("/sensitive", createRequireRecentPasswordAuth(currentDb()), (_req, res) => res.json({ ok: true }));

    for (const path of ["/private", "/sensitive"]) {
      const replay = await request(app).get(path).set("Cookie", `ea_session=${storedToken}`);
      expect(replay.status).toBe(401);
      const legitimate = await request(app).get(path).set("Cookie", `ea_session=${rawToken}`);
      expect(legitimate.status).toBe(200);
      expect(legitimate.body).toEqual({ ok: true });
    }
    expect((await currentDb().execute("SELECT token FROM ea_sessions")).rows.map((row) => row.token))
      .toEqual([storedToken]);
  });

  it("does not let stored hashes update, throttle, or delete their sessions", async () => {
    const rawToken = await createSession({ securityGeneration: 1, authMethod: "passkey" });
    const storedToken = String((await currentDb().execute("SELECT token FROM ea_sessions")).rows[0]!.token);

    await expect(markSessionPasswordAuthenticated(storedToken)).resolves.toBe(false);
    await expect(recordPasswordStepUpFailure(storedToken)).resolves.toBeNull();
    await expect(getPasswordStepUpThrottle(storedToken)).resolves.toBeNull();
    await deleteSession(storedToken);

    await expect(validateSession(rawToken)).resolves.toBe(true);
    await expect(hasRecentPasswordAuth(rawToken)).resolves.toBe(false);
    await expect(getPasswordStepUpThrottle(rawToken)).resolves.toEqual({ failureCount: 0, blockedUntil: 0 });
  });

  it("sweeps expired sessions when a new session is created (P3-18)", async () => {
    await currentDb().execute({
      sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
      args: [hashSessionToken("stale-session"), Date.now() - 60_000],
    });

    await createSession({ securityGeneration: 1, authMethod: "password" });

    const rows = await currentDb().execute({
      sql: "SELECT token FROM ea_sessions WHERE token = ?",
      args: [hashSessionToken("stale-session")],
    });
    expect(rows.rows).toHaveLength(0);
  });

  it("rechecks owner generation so a rotation in another process revokes a validated session", async () => {
    await seedSession(currentDb(), "externally-revoked-session");

    expect(await validateSession("externally-revoked-session")).toBe(true);
    await currentDb().execute("UPDATE ea_owner SET security_generation = security_generation + 1");

    expect(await validateSession("externally-revoked-session")).toBe(false);
  });

  it("stops validating a session after logout", async () => {
    await seedSession(currentDb(), "logout-session");

    expect(await validateSession("logout-session")).toBe(true);
    await deleteSession("logout-session");

    expect(await validateSession("logout-session")).toBe(false);
  });
});
