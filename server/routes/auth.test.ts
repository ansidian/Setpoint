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
import { createAuthTestDb, hashApiToken, hashSessionToken, seedSession } from "../test-utils/auth-db.ts";
import { createPasskeyStore } from "../auth/passkey-store.ts";
import { createPendingAuthStore, hashPendingAuthToken } from "../auth/pending-auth-store.ts";
import { createWebAuthnChallengeStore } from "../auth/webauthn-challenge-store.ts";
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

  afterEach(async () => {
    testState.db.current?.close();
    testState.db.current = null;
  });

  it("mints API tokens with a default expiry", async () => {
    await seedSession(currentDb(), "cookie-session");
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
    await seedSession(currentDb(), "cookie-session");
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

  it("creates only pending auth when passkeys exist", async () => {
    await seedPasskey();

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

  it("returns passkey authentication options from pending auth", async () => {
    await seedPasskey();
    await createPendingAuthStore(currentDb()).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });

    const res = await request(makeApp())
      .post("/api/auth/passkey/authentication/options")
      .set("Cookie", ["ea_pending_auth=pending-token"]);

    const challengeRows = await currentDb().execute("SELECT challenge_hash, pending_auth_hash FROM ea_webauthn_challenges");

    expect(res.status).toBe(200);
    expect(webAuthnMocks.generateAuthenticationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpID: "localhost",
      userVerification: "required",
      allowCredentials: [{ id: "credential-1", transports: ["internal"] }],
    }));
    expect(res.body).toMatchObject({
      challenge: expect.any(String),
      allowCredentials: [{ id: "credential-1", transports: ["internal"] }],
      userVerification: "required",
    });
    expect(challengeRows.rows).toHaveLength(1);
    expect(challengeRows.rows[0]!.pending_auth_hash).toBe(hashPendingAuthToken("pending-token"));
  });

  it("verifies a passkey and creates the real session", async () => {
    await seedPasskey();
    await createPendingAuthStore(currentDb()).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });
    await createWebAuthnChallengeStore(currentDb()).createChallenge({
      userId: "user-1",
      challengeType: "authentication",
      pendingAuthHash: hashPendingAuthToken("pending-token"),
      challenge: "auth-challenge",
    });
    webAuthnMocks.verifyAuthenticationResponse.mockImplementation(async ({ expectedChallenge }) => {
      expect(await expectedChallenge("auth-challenge")).toBe(true);
      return {
        verified: true,
        authenticationInfo: {
          credentialID: "credential-1",
          newCounter: 2,
          credentialBackedUp: true,
          credentialDeviceType: "multiDevice",
        },
      };
    });

    const res = await request(makeApp())
      .post("/api/auth/passkey/authentication/verify")
      .set("Cookie", ["ea_pending_auth=pending-token"])
      .send({ id: "credential-1", response: {} });

    const sessions = await currentDb().execute("SELECT token FROM ea_sessions");
    const pending = await currentDb().execute("SELECT token_hash FROM ea_pending_auth");
    const passkey = await createPasskeyStore(currentDb()).getPasskeyByCredentialId("credential-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: true });
    expect(sessions.rows).toHaveLength(1);
    expect(pending.rows).toHaveLength(0);
    expect(passkey).toMatchObject({
      signCount: 2,
      backedUp: true,
      credentialDeviceType: "multiDevice",
      lastUsedAt: expect.any(Number),
    });
    expect(setCookieHeader(res)).toContain("ea_session=");
    expect(setCookieHeader(res)).toContain("ea_pending_auth=;");
  });

  it("consumes failed passkey challenges without creating a session", async () => {
    await seedPasskey();
    await createPendingAuthStore(currentDb()).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });
    await createWebAuthnChallengeStore(currentDb()).createChallenge({
      userId: "user-1",
      challengeType: "authentication",
      pendingAuthHash: hashPendingAuthToken("pending-token"),
      challenge: "auth-challenge",
    });
    webAuthnMocks.verifyAuthenticationResponse.mockImplementation(async ({ expectedChallenge }) => {
      expect(await expectedChallenge("auth-challenge")).toBe(true);
      return { verified: false };
    });

    const res = await request(makeApp())
      .post("/api/auth/passkey/authentication/verify")
      .set("Cookie", ["ea_pending_auth=pending-token"])
      .send({ id: "credential-1", response: {} });

    const sessions = await currentDb().execute("SELECT token FROM ea_sessions");
    const pending = await currentDb().execute("SELECT token_hash FROM ea_pending_auth");
    const challenges = await currentDb().execute("SELECT challenge_hash FROM ea_webauthn_challenges");

    expect(res.status).toBe(401);
    expect(sessions.rows).toHaveLength(0);
    expect(pending.rows).toHaveLength(1);
    expect(challenges.rows).toHaveLength(0);
  });

  it("rejects wrong-type or reused passkey challenges without creating a session", async () => {
    await seedPasskey();
    await createPendingAuthStore(currentDb()).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });
    await createWebAuthnChallengeStore(currentDb()).createChallenge({
      userId: "user-1",
      challengeType: "registration",
      pendingAuthHash: hashPendingAuthToken("pending-token"),
      challenge: "registration-challenge",
    });
    webAuthnMocks.verifyAuthenticationResponse.mockImplementation(async ({ expectedChallenge }) => {
      if (!(await expectedChallenge("registration-challenge"))) {
        throw new Error("Unexpected challenge");
      }
      return { verified: true };
    });

    const wrongType = await request(makeApp())
      .post("/api/auth/passkey/authentication/verify")
      .set("Cookie", ["ea_pending_auth=pending-token"])
      .send({ id: "credential-1", response: {} });
    const reused = await request(makeApp())
      .post("/api/auth/passkey/authentication/verify")
      .set("Cookie", ["ea_pending_auth=pending-token"])
      .send({ id: "credential-1", response: {} });

    const sessions = await currentDb().execute("SELECT token FROM ea_sessions");
    const pending = await currentDb().execute("SELECT token_hash FROM ea_pending_auth");
    const challenges = await currentDb().execute("SELECT challenge_hash FROM ea_webauthn_challenges");

    expect(wrongType.status).toBe(401);
    expect(reused.status).toBe(401);
    expect(sessions.rows).toHaveLength(0);
    expect(pending.rows).toHaveLength(1);
    expect(challenges.rows).toHaveLength(0);
  });

  it("does not treat pending auth as an authenticated session", async () => {
    await createPendingAuthStore(currentDb()).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });

    const res = await request(makeApp())
      .get("/api/auth/check")
      .set("Cookie", ["ea_pending_auth=pending-token"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });

    const protectedRes = await request(makeApp())
      .get("/protected")
      .set("Cookie", ["ea_pending_auth=pending-token"]);

    expect(protectedRes.status).toBe(401);
  });

  it("cancels pending passkey auth and related login challenges", async () => {
    await createPendingAuthStore(currentDb()).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });
    await createWebAuthnChallengeStore(currentDb()).createChallenge({
      userId: "user-1",
      challengeType: "authentication",
      pendingAuthHash: hashPendingAuthToken("pending-token"),
      challenge: "auth-challenge",
    });

    const res = await request(makeApp())
      .post("/api/auth/passkey/authentication/cancel")
      .set("Cookie", ["ea_pending_auth=pending-token"]);

    const pending = await currentDb().execute("SELECT token_hash FROM ea_pending_auth");
    const challenges = await currentDb().execute("SELECT challenge_hash FROM ea_webauthn_challenges");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, passkeyRequired: false });
    expect(pending.rows).toHaveLength(0);
    expect(challenges.rows).toHaveLength(0);
    expect(setCookieHeader(res)).toContain("ea_pending_auth=;");
  });

  it("lists registered passkeys with safe metadata only", async () => {
    await seedSession(currentDb(), "cookie-session");
    await seedPasskey();

    const res = await request(makeApp())
      .get("/api/auth/passkeys")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enforcementActive: true,
      passkeys: [
        {
          credentialId: "credential-1",
          label: "MacBook Touch ID",
          transports: ["internal"],
          createdAt: expect.any(Number),
          lastUsedAt: null,
        },
      ],
    });
    expect(res.body.passkeys[0]).not.toHaveProperty("publicKey");
  });

  it("requires a real authenticated session for registration options", async () => {
    await createPendingAuthStore(currentDb()).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });

    const res = await request(makeApp())
      .post("/api/auth/passkeys/registration/options")
      .set("Cookie", ["ea_pending_auth=pending-token"])
      .send({ label: "Security Key" });

    expect(res.status).toBe(401);
    expect(webAuthnMocks.generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("returns passkey registration options for an authenticated session", async () => {
    await seedSession(currentDb(), "cookie-session");
    await seedPasskey();

    const res = await request(makeApp())
      .post("/api/auth/passkeys/registration/options")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ label: "Security Key" });

    const challengeRows = await currentDb().execute("SELECT challenge_type FROM ea_webauthn_challenges");

    expect(res.status).toBe(200);
    expect(webAuthnMocks.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpName: "Setpoint",
      rpID: "localhost",
      userName: "user-1",
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      excludeCredentials: [{ id: "credential-1", transports: ["internal"] }],
    }));
    expect(res.body).toMatchObject({
      challenge: expect.any(String),
      attestation: "none",
      excludeCredentials: [{ id: "credential-1", transports: ["internal"] }],
    });
    expect(challengeRows.rows).toEqual([{ challenge_type: "registration" }]);
  });

  it("uses the local request origin for development passkey registration options", async () => {
    await seedSession(currentDb(), "cookie-session");

    const res = await request(makeApp())
      .post("/api/auth/passkeys/registration/options")
      .set("Origin", "http://127.0.0.1:5173")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ label: "Security Key" });

    expect(res.status).toBe(200);
    expect(webAuthnMocks.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpID: "127.0.0.1",
    }));
    expect(res.body.rp).toMatchObject({ id: "127.0.0.1" });
  });

  it("verifies first passkey registration and rotates old password-only sessions", async () => {
    await seedSession(currentDb(), "cookie-session");
    await createWebAuthnChallengeStore(currentDb()).createChallenge({
      userId: "user-1",
      challengeType: "registration",
      challenge: "registration-challenge",
    });
    webAuthnMocks.verifyRegistrationResponse.mockImplementation(async ({ expectedChallenge }) => {
      expect(await expectedChallenge("registration-challenge")).toBe(true);
      return {
        verified: true,
        registrationInfo: {
          credential: {
            id: "new-credential",
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 3,
            transports: ["usb"],
          },
          credentialBackedUp: false,
          credentialDeviceType: "singleDevice",
        },
      };
    });

    const res = await request(makeApp())
      .post("/api/auth/passkeys/registration/verify")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ id: "new-credential", label: "Security Key", response: {} });

    const sessions = await currentDb().execute("SELECT token FROM ea_sessions");
    const passkey = await createPasskeyStore(currentDb()).getPasskeyByCredentialId("new-credential");
    const oldSession = await currentDb().execute({
      sql: "SELECT token FROM ea_sessions WHERE token = ?",
      args: [hashSessionToken("cookie-session")],
    });

    expect(res.status).toBe(200);
    expect(res.body.passkey).toMatchObject({
      credentialId: "new-credential",
      label: "Security Key",
      signCount: 3,
      transports: ["usb"],
      backedUp: false,
      credentialDeviceType: "singleDevice",
    });
    expect(res.body.passkey).not.toHaveProperty("publicKey");
    expect(passkey!.publicKey).toBe(Buffer.from([1, 2, 3]).toString("base64url"));
    expect(sessions.rows).toHaveLength(1);
    expect(oldSession.rows).toHaveLength(0);
    expect(setCookieHeader(res)).toContain("ea_session=");
  });

  it("deletes individual passkeys with session rotation and allows final deletion", async () => {
    await seedSession(currentDb(), "cookie-session");
    await seedPasskey();

    const deleteRes = await request(makeApp())
      .delete("/api/auth/passkeys/credential-1")
      .set("Cookie", ["ea_session=cookie-session"]);

    const remaining = await createPasskeyStore(currentDb()).listPasskeys("user-1");
    const sessions = await currentDb().execute("SELECT token FROM ea_sessions");
    const oldSession = await currentDb().execute({
      sql: "SELECT token FROM ea_sessions WHERE token = ?",
      args: [hashSessionToken("cookie-session")],
    });
    const loginRes = await request(makeApp())
      .post("/api/auth/login")
      .send({ password: "correct-password" });

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toEqual({
      success: true,
      enforcementActive: false,
      passkeys: [],
    });
    expect(remaining).toHaveLength(0);
    expect(sessions.rows).toHaveLength(1);
    expect(oldSession.rows).toHaveLength(0);
    expect(setCookieHeader(deleteRes)).toContain("ea_session=");
    expect(loginRes.body).toMatchObject({
      authenticated: true,
      passkeyRequired: false,
      passkeySetupRecommended: true,
    });
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
