import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { Response as SuperTestResponse } from "supertest";
import bcrypt from "bcrypt";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import type {
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
} from "@simplewebauthn/server";
import { createAuthTestDb, hashApiToken, hashSessionToken, seedOwner, seedSession } from "../test-utils/auth-db.ts";
import { createPasskeyStore } from "../auth/passkey-store.ts";
import { createPendingAuthStore } from "../auth/pending-auth-store.ts";
import { createRecoveryCodeStore } from "../auth/recovery-code-store.ts";
import { errorHandler } from "../middleware/async-handler.ts";

const testState = vi.hoisted<{ db: { current: Client | null } }>(() => ({
  db: { current: null },
}));

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test database is not initialized");
  return testState.db.current;
}
// Default impls kept as named factories so beforeEach can REINSTATE them after a
// full reset. A sibling test in the same single-worker run can leave a leaked
// mockResolvedValue/mockImplementation on @simplewebauthn/server (the module mock
// object is per-file, but vitest mock STATE for shared fns is only fully wiped by
// mockReset, not mockClear). Reinstating the defaults each test makes this file's
// expectations independent of sibling-applied implementations.
const defaultGenerateAuthenticationOptions = async (options: GenerateAuthenticationOptionsOpts) => ({
  challenge: Buffer.from(options.challenge || "").toString("base64url"),
  allowCredentials: options.allowCredentials,
  userVerification: options.userVerification,
  rpId: options.rpID,
});
const defaultGenerateRegistrationOptions = async (options: GenerateRegistrationOptionsOpts) => ({
  challenge: Buffer.from(options.challenge || "").toString("base64url"),
  excludeCredentials: options.excludeCredentials,
  authenticatorSelection: options.authenticatorSelection,
  attestation: options.attestationType,
  rp: { name: options.rpName, id: options.rpID },
});
const webAuthnMocks = vi.hoisted(() => ({
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement) => currentDb().execute(statement),
    batch: (
      statements: Parameters<Client["batch"]>[0],
      mode?: TransactionMode,
    ) => currentDb().batch(statements, mode),
  },
}));
vi.mock("@simplewebauthn/server", () => webAuthnMocks);

const authPasswordHash = bcrypt.hashSync("correct-password", 4);
process.env.NODE_ENV = "test";
process.env.EA_USER_ID = "user-1";
process.env.EA_PASSWORD_HASH = authPasswordHash;
const authRoutes = (await import("./auth.ts")).default;
const { requireCookieSession, __clearSessionValidationCache } = await import("../middleware/auth.ts");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes);
  app.get("/protected", requireCookieSession, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler); // mirror server/index.ts terminal error middleware
  return app;
}

function setCookieHeader(response: SuperTestResponse): string {
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? value.join(";") : String(value || "");
}

describe("auth routes", () => {
  beforeEach(async () => {
    testState.db.current = await createAuthTestDb();
    await seedOwner(currentDb(), { passwordHash: authPasswordHash });
    // P2-27: validateSession now memoizes positive results in a module-level cache;
    // clear it between tests so each starts from a clean DB-backed state (otherwise
    // a prior test's cached "cookie-session" masks this test's DB-error path).
    __clearSessionValidationCache();
    // Full reset (not mockClear) so any sibling-leaked implementation/return on
    // these shared webAuthn fns is wiped, then reinstate this file's defaults.
    // mockClear only resets call history and would carry a leaked mockResolvedValue
    // forward across the single-worker full-suite run.
    webAuthnMocks.generateAuthenticationOptions.mockReset();
    webAuthnMocks.generateAuthenticationOptions.mockImplementation(defaultGenerateAuthenticationOptions);
    webAuthnMocks.verifyAuthenticationResponse.mockReset();
    webAuthnMocks.generateRegistrationOptions.mockReset();
    webAuthnMocks.generateRegistrationOptions.mockImplementation(defaultGenerateRegistrationOptions);
    webAuthnMocks.verifyRegistrationResponse.mockReset();
    // Pin the env this suite's auth router depends on. A sibling that sets
    // NODE_ENV=production (several actual/* and route tests do) would flip the
    // WebAuthn config into its production-required-env branch; pin it back so this
    // file is order-independent. EA_USER_ID/EA_PASSWORD_HASH are re-asserted for
    // the same reason (a sibling may have mutated process.env).
    process.env.NODE_ENV = "test";
    process.env.EA_USER_ID = "user-1";
    process.env.EA_PASSWORD_HASH = authPasswordHash;
  });

  it("exposes only whether public setup is still available", async () => {
    await currentDb().execute("DELETE FROM ea_owner");

    const res = await request(makeApp()).get("/api/auth/setup/status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ claimed: false });
  });

  it("atomically claims a fresh instance and authenticates that browser", async () => {
    await currentDb().execute("DELETE FROM ea_owner");

    const res = await request(makeApp())
      .post("/api/auth/setup/claim")
      .send({ password: "new-owner-password", canonicalOrigin: "https://setpoint.example.com" });
    const ownerResult = await currentDb().execute(
      "SELECT user_id, password_hash, claimed_at FROM ea_owner",
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      authenticated: true,
      claimed: true,
      recoveryCodes: expect.arrayContaining([expect.stringMatching(/^SP-/)]),
    });
    expect(res.body.recoveryCodes).toHaveLength(8);
    expect(setCookieHeader(res)).toContain("ea_session=");
    expect(ownerResult.rows).toHaveLength(1);
    expect(ownerResult.rows[0]!.user_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await bcrypt.compare("new-owner-password", String(ownerResult.rows[0]!.password_hash))).toBe(true);
    expect(res.text).not.toContain(String(ownerResult.rows[0]!.user_id));
    expect(res.text).not.toContain(String(ownerResult.rows[0]!.password_hash));
    expect((await currentDb().execute("SELECT canonical_origin, source FROM ea_instance_metadata")).rows)
      .toEqual([{ canonical_origin: "https://setpoint.example.com", source: "owner_confirmed" }]);
  });

  it("rejects an invalid canonical origin without claiming the instance", async () => {
    await currentDb().execute("DELETE FROM ea_owner");

    const res = await request(makeApp())
      .post("/api/auth/setup/claim")
      .send({ password: "new-owner-password", canonicalOrigin: "http://attacker.example.com/path" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Canonical URL is invalid" });
    expect((await currentDb().execute("SELECT * FROM ea_owner")).rows).toEqual([]);
    expect((await currentDb().execute("SELECT * FROM ea_instance_metadata")).rows).toEqual([]);
  });

  it("returns a fixed conflict without replacing an existing owner", async () => {
    const before = await currentDb().execute("SELECT * FROM ea_owner");

    const res = await request(makeApp())
      .post("/api/auth/setup/claim")
      .send({ password: "replacement-password", canonicalOrigin: "https://setpoint.example.com" });
    const after = await currentDb().execute("SELECT * FROM ea_owner");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "Instance is already claimed" });
    expect(after.rows).toEqual(before.rows);
  });

  it("lets exactly one of two concurrent claim requests succeed", async () => {
    await currentDb().execute("DELETE FROM ea_owner");
    const app = makeApp();

    const responses = await Promise.all([
      request(app).post("/api/auth/setup/claim").send({ password: "first-owner-password", canonicalOrigin: "https://first.example.com" }),
      request(app).post("/api/auth/setup/claim").send({ password: "second-owner-password", canonicalOrigin: "https://second.example.com" }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const owners = await currentDb().execute("SELECT user_id FROM ea_owner");
    expect(owners.rows).toHaveLength(1);
  });

  afterEach(async () => {
    testState.db.current?.close();
    testState.db.current = null;
  });

  it("mints API tokens with a default expiry", async () => {
    await seedSession(currentDb(), "cookie-session", Date.now() + 60_000, Date.now());
    const before = Date.now();

    const res = await request(makeApp())
      .post("/api/auth/api-tokens")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ label: "Phone", scopes: ["actual:write"] });

    const result = await currentDb().execute({
      sql: "SELECT token_hash, label, scopes, created_at, expires_at FROM ea_api_tokens",
      args: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^eatk_/);
    expect(res.body.expires_at).toBeGreaterThan(before + 80 * 24 * 60 * 60 * 1000);
    expect(res.body.expires_at).toBeLessThan(before + 100 * 24 * 60 * 60 * 1000);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      token_hash: hashApiToken(res.body.token),
      label: "Phone",
      scopes: JSON.stringify(["actual:write"]),
      expires_at: res.body.expires_at,
    });
    expect(result.rows[0]!.token_hash).not.toBe(res.body.token);
    expect(result.rows[0]!.created_at).toBeGreaterThanOrEqual(before);
  });

  it("does not let unauthenticated token-mint attempts consume the rate-limit budget", async () => {
    await seedSession(currentDb(), "cookie-session", Date.now() + 60_000, Date.now());
    const app = makeApp();

    // Fire more unauthenticated mint attempts than the 5/15min budget. With auth ahead of the
    // limiter these are all rejected by auth (401) and never count against the IP budget.
    for (let i = 0; i < 8; i++) {
      const blocked = await request(app)
        .post("/api/auth/api-tokens")
        .send({ label: "Spoofed", scopes: ["actual:write"] });
      expect(blocked.status).toBe(401);
    }

    // The real, authenticated user can still mint — budget was untouched (not 429).
    const res = await request(app)
      .post("/api/auth/api-tokens")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ label: "Phone", scopes: ["actual:write"] });

    const tokens = await currentDb().execute({
      sql: "SELECT label FROM ea_api_tokens",
      args: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^eatk_/);
    expect(tokens.rows).toHaveLength(1);
    expect(tokens.rows[0]!.label).toBe("Phone");
  });

  it("creates a session and recommends setup when no passkeys exist", async () => {
    const res = await request(makeApp())
      .post("/api/auth/login")
      .send({ password: "correct-password" });

    const sessions = await currentDb().execute("SELECT token FROM ea_sessions");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      authenticated: true,
      passkeyRequired: false,
      passkeySetupRecommended: true,
    });
    expect(sessions.rows).toHaveLength(1);
    expect(setCookieHeader(res)).toContain("ea_session=");
    expect(setCookieHeader(res)).toContain("ea_pending_auth=;");
  });

  it("returns a 500 instead of hanging when a login handler rejects (P1-12)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Force the DB read inside countPasskeys to reject after the password check
    // passes, so the async /login handler rejects mid-flight. Without
    // async-rejection forwarding the request produces no response and hangs.
    currentDb().execute = vi.fn().mockRejectedValue(new Error("db down"));

    const res = await request(makeApp())
      .post("/api/auth/login")
      .send({ password: "correct-password" });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ message: "Internal server error" });
  }, 3000);

  it("returns a 500 instead of hanging when the auth guard's DB read rejects (P1-12)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await seedSession(currentDb(), "cookie-session");
    // requireCookieSession runs as non-final middleware and does an unguarded DB
    // read (validateSession); a transient DB failure there must not hang the
    // request the way wrapRouterAsync (final-handler only) would leave it.
    currentDb().execute = vi.fn().mockRejectedValue(new Error("db down"));

    const res = await request(makeApp())
      .get("/protected")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(500);
  }, 3000);

  it("creates only pending auth when strict mode is explicitly enabled", async () => {
    await seedPasskey();
    await currentDb().execute("UPDATE ea_owner SET auth_mode = 'password_plus_passkey'");

    const res = await request(makeApp())
      .post("/api/auth/login")
      .send({ password: "correct-password" });

    const sessions = await currentDb().execute("SELECT token FROM ea_sessions");
    const pending = await currentDb().execute("SELECT token_hash, user_id FROM ea_pending_auth");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      authenticated: false,
      passkeyRequired: true,
    });
    expect(sessions.rows).toHaveLength(0);
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0]!.user_id).toBe("user-1");
    expect(setCookieHeader(res)).toContain("ea_pending_auth=");
    expect(setCookieHeader(res)).toContain("ea_session=;");
  });

  it("requires recent authentication before enabling explicit strict mode", async () => {
    await seedSession(currentDb(), "cookie-session");
    await seedPasskey();

    const blocked = await request(makeApp())
      .patch("/api/auth/security/auth-mode")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ authMode: "password_plus_passkey" });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: "STEP_UP_REQUIRED" });

    const stepUp = await request(makeApp())
      .post("/api/auth/security/step-up/password")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ password: "correct-password" });
    expect(stepUp.status).toBe(200);

    const enabled = await request(makeApp())
      .patch("/api/auth/security/auth-mode")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ authMode: "password_plus_passkey" });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toMatchObject({ authMode: "password_plus_passkey" });
    const owner = await currentDb().execute("SELECT auth_mode FROM ea_owner");
    expect(owner.rows[0]!.auth_mode).toBe("password_plus_passkey");
  });

  it("changes the owner password only with recent auth and rotates prior sessions", async () => {
    await seedSession(currentDb(), "current-session", Date.now() + 60_000, Date.now());
    await seedSession(currentDb(), "other-session", Date.now() + 60_000, Date.now());

    const changed = await request(makeApp())
      .post("/api/auth/security/password")
      .set("Cookie", ["ea_session=current-session"])
      .send({ newPassword: "replacement-password" });

    expect(changed.status).toBe(200);
    expect(setCookieHeader(changed)).toContain("ea_session=");
    expect((await currentDb().execute({
      sql: "SELECT * FROM ea_sessions WHERE token = ?",
      args: [hashSessionToken("other-session")],
    })).rows).toEqual([]);
    const login = await request(makeApp())
      .post("/api/auth/login")
      .send({ password: "replacement-password" });
    expect(login.status).toBe(200);
    expect(login.body.authenticated).toBe(true);
  });

  it("previews and changes the canonical domain only with recent authentication", async () => {
    await currentDb().execute({
      sql: `INSERT INTO ea_instance_metadata
              (singleton_id, canonical_origin, source, confirmed_at, updated_at)
            VALUES (1, ?, 'owner_confirmed', 100, 100)`,
      args: ["https://old.example.com"],
    });
    await seedSession(currentDb(), "cookie-session", Date.now() + 60_000);
    await seedPasskey();

    const preview = await request(makeApp())
      .post("/api/auth/security/canonical-origin/preview")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ canonicalOrigin: "https://new.example.com" });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      currentOrigin: "https://old.example.com",
      proposedOrigin: "https://new.example.com",
      affectedPasskeys: 1,
      callbacks: expect.arrayContaining([
        expect.objectContaining({ provider: "Google OAuth", previousUrl: expect.stringContaining("old.example.com"), nextUrl: expect.stringContaining("new.example.com") }),
      ]),
    });

    const blocked = await request(makeApp())
      .patch("/api/auth/security/canonical-origin")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ canonicalOrigin: "https://new.example.com" });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: "STEP_UP_REQUIRED" });

    await currentDb().execute("UPDATE ea_sessions SET authenticated_at = ?", [Date.now()]);
    const changed = await request(makeApp())
      .patch("/api/auth/security/canonical-origin")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ canonicalOrigin: "https://new.example.com" });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ proposedOrigin: "https://new.example.com", affectedPasskeys: 1 });
    expect((await currentDb().execute("SELECT canonical_origin FROM ea_instance_metadata")).rows)
      .toEqual([{ canonical_origin: "https://new.example.com" }]);
  });

  it("consumes a recovery code once, resets credentials, and revokes prior auth state", async () => {
    const recoveryCode = "SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222";
    await createRecoveryCodeStore(currentDb()).replaceRecoveryCodes("user-1", [recoveryCode], 100);
    await seedSession(currentDb(), "old-session", Date.now() + 60_000, Date.now());
    await seedPasskey();
    await currentDb().execute("UPDATE ea_owner SET auth_mode = 'password_plus_passkey'");
    await createPendingAuthStore(currentDb()).createPendingAuth({ userId: "user-1", token: "pending-token" });

    const recovered = await request(makeApp())
      .post("/api/auth/recovery")
      .send({ recoveryCode, newPassword: "replacement-password" });

    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({
      authenticated: true,
      recoveryCodes: expect.arrayContaining([expect.stringMatching(/^SP-/)]),
    });
    expect(recovered.body.recoveryCodes).toHaveLength(8);
    const owner = await currentDb().execute("SELECT password_hash, auth_mode FROM ea_owner");
    expect(await bcrypt.compare("replacement-password", String(owner.rows[0]!.password_hash))).toBe(true);
    expect(owner.rows[0]!.auth_mode).toBe("password_or_passkey");
    await expect(createPasskeyStore(currentDb()).listPasskeys("user-1")).resolves.toEqual([]);
    expect((await currentDb().execute("SELECT * FROM ea_pending_auth")).rows).toEqual([]);
    expect((await currentDb().execute({
      sql: "SELECT * FROM ea_sessions WHERE token = ?",
      args: [hashSessionToken("old-session")],
    })).rows).toEqual([]);

    const replay = await request(makeApp())
      .post("/api/auth/recovery")
      .send({ recoveryCode, newPassword: "attacker-password" });
    expect(replay.status).toBe(401);
  });
});

async function seedPasskey() {
  return createPasskeyStore(currentDb()).createPasskey({
    userId: "user-1",
    credentialId: "credential-1",
    label: "MacBook Touch ID",
    publicKey: Buffer.from("public-key").toString("base64url"),
    signCount: 1,
    transports: ["internal"],
  });
}
