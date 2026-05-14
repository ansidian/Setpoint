import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { createAuthTestDb, hashApiToken, hashSessionToken, seedSession } from "../test-utils/auth-db.js";
import { createPasskeyStore } from "../auth/passkey-store.js";
import { createPendingAuthStore, hashPendingAuthToken } from "../auth/pending-auth-store.js";
import { createWebAuthnChallengeStore } from "../auth/webauthn-challenge-store.js";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));
const webAuthnMocks = vi.hoisted(() => ({
  generateAuthenticationOptions: vi.fn(async (options) => ({
    challenge: Buffer.from(options.challenge).toString("base64url"),
    allowCredentials: options.allowCredentials,
    userVerification: options.userVerification,
    rpId: options.rpID,
  })),
  verifyAuthenticationResponse: vi.fn(),
  generateRegistrationOptions: vi.fn(async (options) => ({
    challenge: Buffer.from(options.challenge).toString("base64url"),
    excludeCredentials: options.excludeCredentials,
    authenticatorSelection: options.authenticatorSelection,
    attestation: options.attestationType,
    rp: { name: options.rpName, id: options.rpID },
  })),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    batch: (...args) => testState.db.current.batch(...args),
  },
}));
vi.mock("@simplewebauthn/server", () => webAuthnMocks);

process.env.EA_USER_ID = "user-1";
process.env.EA_PASSWORD_HASH = bcrypt.hashSync("correct-password", 4);
const authRoutes = (await import("./auth.js")).default;
const { requireCookieSession } = await import("../middleware/auth.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes);
  app.get("/protected", requireCookieSession, (_req, res) => res.json({ ok: true }));
  return app;
}

describe("auth routes", () => {
  beforeEach(async () => {
    testState.db.current = await createAuthTestDb();
    webAuthnMocks.generateAuthenticationOptions.mockClear();
    webAuthnMocks.verifyAuthenticationResponse.mockReset();
    webAuthnMocks.generateRegistrationOptions.mockClear();
    webAuthnMocks.verifyRegistrationResponse.mockReset();
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("mints API tokens with a default expiry", async () => {
    await seedSession(testState.db.current, "cookie-session");
    const before = Date.now();

    const res = await request(makeApp())
      .post("/api/auth/api-tokens")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ label: "Phone", scopes: ["actual:write"] });

    const result = await testState.db.current.execute({
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
    expect(result.rows[0].token_hash).not.toBe(res.body.token);
    expect(result.rows[0].created_at).toBeGreaterThanOrEqual(before);
  });

  it("creates a session and recommends setup when no passkeys exist", async () => {
    const res = await request(makeApp())
      .post("/api/auth/login")
      .send({ password: "correct-password" });

    const sessions = await testState.db.current.execute("SELECT token FROM ea_sessions");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      authenticated: true,
      passkeyRequired: false,
      passkeySetupRecommended: true,
    });
    expect(sessions.rows).toHaveLength(1);
    expect(res.headers["set-cookie"].join(";")).toContain("ea_session=");
    expect(res.headers["set-cookie"].join(";")).toContain("ea_pending_auth=;");
  });

  it("creates only pending auth when passkeys exist", async () => {
    await seedPasskey();

    const res = await request(makeApp())
      .post("/api/auth/login")
      .send({ password: "correct-password" });

    const sessions = await testState.db.current.execute("SELECT token FROM ea_sessions");
    const pending = await testState.db.current.execute("SELECT token_hash, user_id FROM ea_pending_auth");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      authenticated: false,
      passkeyRequired: true,
    });
    expect(sessions.rows).toHaveLength(0);
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0].user_id).toBe("user-1");
    expect(res.headers["set-cookie"].join(";")).toContain("ea_pending_auth=");
    expect(res.headers["set-cookie"].join(";")).toContain("ea_session=;");
  });

  it("returns passkey authentication options from pending auth", async () => {
    await seedPasskey();
    await createPendingAuthStore(testState.db.current).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });

    const res = await request(makeApp())
      .post("/api/auth/passkey/authentication/options")
      .set("Cookie", ["ea_pending_auth=pending-token"]);

    const challengeRows = await testState.db.current.execute("SELECT challenge_hash, pending_auth_hash FROM ea_webauthn_challenges");

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
    expect(challengeRows.rows[0].pending_auth_hash).toBe(hashPendingAuthToken("pending-token"));
  });

  it("verifies a passkey and creates the real session", async () => {
    await seedPasskey();
    await createPendingAuthStore(testState.db.current).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });
    await createWebAuthnChallengeStore(testState.db.current).createChallenge({
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

    const sessions = await testState.db.current.execute("SELECT token FROM ea_sessions");
    const pending = await testState.db.current.execute("SELECT token_hash FROM ea_pending_auth");
    const passkey = await createPasskeyStore(testState.db.current).getPasskeyByCredentialId("credential-1");

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
    expect(res.headers["set-cookie"].join(";")).toContain("ea_session=");
    expect(res.headers["set-cookie"].join(";")).toContain("ea_pending_auth=;");
  });

  it("consumes failed passkey challenges without creating a session", async () => {
    await seedPasskey();
    await createPendingAuthStore(testState.db.current).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });
    await createWebAuthnChallengeStore(testState.db.current).createChallenge({
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

    const sessions = await testState.db.current.execute("SELECT token FROM ea_sessions");
    const pending = await testState.db.current.execute("SELECT token_hash FROM ea_pending_auth");
    const challenges = await testState.db.current.execute("SELECT challenge_hash FROM ea_webauthn_challenges");

    expect(res.status).toBe(401);
    expect(sessions.rows).toHaveLength(0);
    expect(pending.rows).toHaveLength(1);
    expect(challenges.rows).toHaveLength(0);
  });

  it("rejects wrong-type or reused passkey challenges without creating a session", async () => {
    await seedPasskey();
    await createPendingAuthStore(testState.db.current).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });
    await createWebAuthnChallengeStore(testState.db.current).createChallenge({
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

    const sessions = await testState.db.current.execute("SELECT token FROM ea_sessions");
    const pending = await testState.db.current.execute("SELECT token_hash FROM ea_pending_auth");
    const challenges = await testState.db.current.execute("SELECT challenge_hash FROM ea_webauthn_challenges");

    expect(wrongType.status).toBe(401);
    expect(reused.status).toBe(401);
    expect(sessions.rows).toHaveLength(0);
    expect(pending.rows).toHaveLength(1);
    expect(challenges.rows).toHaveLength(0);
  });

  it("does not treat pending auth as an authenticated session", async () => {
    await createPendingAuthStore(testState.db.current).createPendingAuth({
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
    await createPendingAuthStore(testState.db.current).createPendingAuth({
      userId: "user-1",
      token: "pending-token",
    });
    await createWebAuthnChallengeStore(testState.db.current).createChallenge({
      userId: "user-1",
      challengeType: "authentication",
      pendingAuthHash: hashPendingAuthToken("pending-token"),
      challenge: "auth-challenge",
    });

    const res = await request(makeApp())
      .post("/api/auth/passkey/authentication/cancel")
      .set("Cookie", ["ea_pending_auth=pending-token"]);

    const pending = await testState.db.current.execute("SELECT token_hash FROM ea_pending_auth");
    const challenges = await testState.db.current.execute("SELECT challenge_hash FROM ea_webauthn_challenges");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, passkeyRequired: false });
    expect(pending.rows).toHaveLength(0);
    expect(challenges.rows).toHaveLength(0);
    expect(res.headers["set-cookie"].join(";")).toContain("ea_pending_auth=;");
  });

  it("lists registered passkeys with safe metadata only", async () => {
    await seedSession(testState.db.current, "cookie-session");
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
    await createPendingAuthStore(testState.db.current).createPendingAuth({
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
    await seedSession(testState.db.current, "cookie-session");
    await seedPasskey();

    const res = await request(makeApp())
      .post("/api/auth/passkeys/registration/options")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ label: "Security Key" });

    const challengeRows = await testState.db.current.execute("SELECT challenge_type FROM ea_webauthn_challenges");

    expect(res.status).toBe(200);
    expect(webAuthnMocks.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpName: "EA Dashboard",
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
    await seedSession(testState.db.current, "cookie-session");

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
    await seedSession(testState.db.current, "cookie-session");
    await createWebAuthnChallengeStore(testState.db.current).createChallenge({
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

    const sessions = await testState.db.current.execute("SELECT token FROM ea_sessions");
    const passkey = await createPasskeyStore(testState.db.current).getPasskeyByCredentialId("new-credential");
    const oldSession = await testState.db.current.execute({
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
    expect(passkey.publicKey).toBe(Buffer.from([1, 2, 3]).toString("base64url"));
    expect(sessions.rows).toHaveLength(1);
    expect(oldSession.rows).toHaveLength(0);
    expect(res.headers["set-cookie"].join(";")).toContain("ea_session=");
  });

  it("deletes individual passkeys with session rotation and allows final deletion", async () => {
    await seedSession(testState.db.current, "cookie-session");
    await seedPasskey();

    const deleteRes = await request(makeApp())
      .delete("/api/auth/passkeys/credential-1")
      .set("Cookie", ["ea_session=cookie-session"]);

    const remaining = await createPasskeyStore(testState.db.current).listPasskeys("user-1");
    const sessions = await testState.db.current.execute("SELECT token FROM ea_sessions");
    const oldSession = await testState.db.current.execute({
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
    expect(deleteRes.headers["set-cookie"].join(";")).toContain("ea_session=");
    expect(loginRes.body).toMatchObject({
      authenticated: true,
      passkeyRequired: false,
      passkeySetupRecommended: true,
    });
  });
});

async function seedPasskey() {
  return createPasskeyStore(testState.db.current).createPasskey({
    userId: "user-1",
    credentialId: "credential-1",
    label: "MacBook Touch ID",
    publicKey: Buffer.from("public-key").toString("base64url"),
    signCount: 1,
    transports: ["internal"],
  });
}
