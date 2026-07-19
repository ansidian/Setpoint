import { Router } from "express";
import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import {
  createSession,
  validateSession,
  deleteSession,
  requireCookieSession,
  requireRecentAuth,
  hasRecentAuth,
  markSessionRecentlyAuthenticated,
} from "../middleware/auth.ts";
import db from "../db/connection.ts";
import { wrapRouterAsync } from "../middleware/async-handler.ts";
import { timeRoute } from "../timing.ts";
import {
  PENDING_AUTH_COOKIE_NAME,
  buildPendingAuthCookieOptions,
  createPendingAuth,
  readPendingAuth,
  consumePendingAuth,
  deletePendingAuth,
  clearPendingAuth,
} from "../auth/pending-auth-store.ts";
import { createChallenge, consumeChallenge, deleteChallengesForPendingAuth, clearChallenges } from "../auth/webauthn-challenge-store.ts";
import {
  countPasskeys,
  listPasskeys,
  listPasskeyMetadata,
  getPasskeyByCredentialId,
  createPasskey,
  updatePasskeyUsage,
  deletePasskey,
  toPasskeyMetadata,
} from "../auth/passkey-store.ts";
import {
  buildRegistrationOptions,
  verifyRegistrationCredential,
  buildAuthenticationOptions,
  verifyAuthenticationCredential,
} from "../auth/webauthn-service.ts";
import { resolveWebAuthnConfig } from "../auth/webauthn-config.ts";
import { revokeAllSessions, rotateSessionsForCurrentBrowser } from "../auth/session-rotation.ts";
import { getOwner, setOwnerAuthMode, updateOwnerPasswordHash } from "../auth/owner-store.ts";
import { claimInitialOwner } from "../auth/owner-claim-service.ts";
import { resolvePasswordLogin, isOwnerAuthMode } from "../auth/auth-mode.ts";
import { consumeRecoveryCode, generateRecoveryCodes, getRecoveryCodeStatus, hashRecoveryCode, replaceRecoveryCodes } from "../auth/recovery-code-store.ts";
import { canonicalUrlService, normalizeCanonicalOrigin } from "../platform/canonical-url.ts";
import canonicalOriginRoutes from "./auth-canonical-origin.ts";

const router = Router();
// P1-12: forward async-handler rejections to the terminal errorHandler so a
// transient DB/crypto failure returns a 500 instead of hanging the request
// (notably the CSRF-exempt /login). Must run before any route is registered.
wrapRouterAsync(router);
const API_TOKEN_TTL_DAYS = Number.parseInt(process.env.EA_API_TOKEN_TTL_DAYS || "90", 10) || 90;
const API_TOKEN_TTL_MS = API_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

const KNOWN_SCOPES = new Set(["actual:write"]);

// Rate limit token minting: 5 creations per 15 minutes per IP
const tokenMintLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Too many token creations, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit login: 5 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Too many login attempts, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const passkeyAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { message: "Too many passkey attempts, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const ownerClaimLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Too many setup attempts, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Too many recovery attempts, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

function setSessionCookie(res: Response, token: string) {
  res.cookie("ea_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie("ea_session", { path: "/" });
}

function setPendingAuthCookie(res: Response, token: string) {
  res.cookie(PENDING_AUTH_COOKIE_NAME, token, buildPendingAuthCookieOptions());
}

function clearPendingAuthCookie(res: Response) {
  res.clearCookie(PENDING_AUTH_COOKIE_NAME, { path: "/" });
}

async function webAuthnConfigForRequest(req: Request) {
  const canonicalOrigin = await canonicalUrlService.resolveCanonicalOrigin(process.env);
  return resolveWebAuthnConfig(process.env, { requestOrigin: req.get("origin"), canonicalOrigin });
}

function logDevPasskeyFailure(context: string, error: unknown) {
  if (process.env.NODE_ENV === "production") return;
  console.warn(`[EA] ${context}:`, error instanceof Error ? error.message : error);
}

async function clearPendingAuthState(req: Request, res: Response) {
  const pendingToken = req.cookies?.[PENDING_AUTH_COOKIE_NAME];
  if (!pendingToken) {
    clearPendingAuthCookie(res);
    return;
  }
  const pending = await readPendingAuth(pendingToken);
  if (pending) {
    await deleteChallengesForPendingAuth(pending.tokenHash);
  }
  await deletePendingAuth(pendingToken);
  clearPendingAuthCookie(res);
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024;
}

async function rotateAllAuthState() {
  await Promise.all([clearPendingAuth(), clearChallenges()]);
  return rotateSessionsForCurrentBrowser();
}

router.get("/setup/status", async (_req, res) => {
  res.json({ claimed: Boolean(await getOwner()) });
});

router.post("/setup/claim", ownerClaimLimiter, async (req, res) => {
  let canonicalOrigin: string;
  try {
    canonicalOrigin = normalizeCanonicalOrigin(req.body?.canonicalOrigin);
  } catch {
    return res.status(400).json({ message: "Canonical URL is invalid" });
  }
  const recoveryCodes = generateRecoveryCodes();
  const result = await claimInitialOwner(req.body?.password, {
    recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
    canonicalOrigin,
  });
  if (result.status === "invalid") {
    return res.status(400).json({ message: "Password is required" });
  }
  if (result.status === "conflict") {
    return res.status(409).json({ message: "Instance is already claimed" });
  }

  const token = await createSession();
  setSessionCookie(res, token);
  clearPendingAuthCookie(res);
  return res.json({ authenticated: true, claimed: true, recoveryCodes });
});

router.post("/login", timeRoute("/api/auth/login"), loginLimiter, async (req, res) => {
  const { password } = req.body;
  const owner = await getOwner();

  if (!owner || !password) {
    return res.status(401).json({ message: "Invalid password" });
  }

  const match = await bcrypt.compare(password, owner.passwordHash);
  if (!match) {
    return res.status(401).json({ message: "Invalid password" });
  }

  const registeredPasskeyCount = await countPasskeys(owner.userId);
  const resolution = resolvePasswordLogin(owner.authMode, registeredPasskeyCount);
  if (resolution.configurationError) {
    return res.status(409).json({ message: "Strict authentication requires a registered passkey" });
  }
  if (resolution.passkeyRequired) {
    const pending = await createPendingAuth({ userId: owner.userId });
    setPendingAuthCookie(res, pending.token);
    clearSessionCookie(res);
    return res.json({
      authenticated: false,
      passkeyRequired: true,
    });
  }

  const token = await createSession();
  setSessionCookie(res, token);
  clearPendingAuthCookie(res);
  res.json({
    authenticated: true,
    passkeyRequired: false,
    passkeySetupRecommended: registeredPasskeyCount === 0,
  });
});

router.post("/passkey/authentication/options", passkeyAuthLimiter, async (req, res) => {
  let pending = await readPendingAuth(req.cookies?.[PENDING_AUTH_COOKIE_NAME]);
  if (!pending) {
    const owner = await getOwner();
    if (!owner) return res.status(401).json({ message: "Passkey authentication unavailable" });
    if (owner.authMode === "password_plus_passkey") {
      clearPendingAuthCookie(res);
      return res.status(409).json({ message: "Enter your password before using a passkey" });
    }
    if (await countPasskeys(owner.userId) === 0) {
      return res.status(409).json({ message: "No registered passkeys" });
    }
    const created = await createPendingAuth({ userId: owner.userId });
    setPendingAuthCookie(res, created.token);
    pending = created;
  }

  const passkeys = await listPasskeys(pending.userId);
  if (!passkeys.length) {
    return res.status(409).json({ message: "No registered passkeys" });
  }

  const challenge = await createChallenge({
    userId: pending.userId,
    challengeType: "authentication",
    pendingAuthHash: pending.tokenHash,
  });
  const options = await buildAuthenticationOptions({
    passkeys,
    challenge: challenge.challenge,
    config: await webAuthnConfigForRequest(req),
  });
  return res.json(options);
});

router.post("/passkey/authentication/verify", passkeyAuthLimiter, async (req, res) => {
  const pendingToken = req.cookies?.[PENDING_AUTH_COOKIE_NAME];
  const pending = await readPendingAuth(pendingToken);
  if (!pending) {
    clearPendingAuthCookie(res);
    return res.status(401).json({ message: "Pending authentication required" });
  }

  const credentialId = req.body?.id;
  const passkey = credentialId ? await getPasskeyByCredentialId(credentialId) : null;
  if (!passkey || passkey.userId !== pending.userId) {
    return res.status(401).json({ message: "Passkey verification failed" });
  }

  let consumedChallenge = null;
  try {
    const verification = await verifyAuthenticationCredential({
      response: req.body,
      passkey,
      config: await webAuthnConfigForRequest(req),
      expectedChallenge: async (challenge) => {
        consumedChallenge = await consumeChallenge(challenge, {
          userId: pending.userId,
          challengeType: "authentication",
        });
        return consumedChallenge?.pendingAuthHash === pending.tokenHash;
      },
    });

    if (!verification.verified || !consumedChallenge) {
      return res.status(401).json({ message: "Passkey verification failed" });
    }

    const authInfo = verification.authenticationInfo || {};
    await updatePasskeyUsage(passkey.credentialId, {
      signCount: authInfo.newCounter,
      backedUp: authInfo.credentialBackedUp,
      credentialDeviceType: authInfo.credentialDeviceType,
    });
    await consumePendingAuth(pendingToken);
    const token = await createSession();
    setSessionCookie(res, token);
    clearPendingAuthCookie(res);
    return res.json({ authenticated: true });
  } catch (error) {
    logDevPasskeyFailure("Passkey authentication failed", error);
    return res.status(401).json({ message: "Passkey verification failed" });
  }
});

router.post("/passkey/authentication/cancel", passkeyAuthLimiter, async (req, res) => {
  await clearPendingAuthState(req, res);
  res.json({ authenticated: false, passkeyRequired: false });
});

router.get("/passkeys", requireCookieSession, async (_req, res) => {
  const owner = await getOwner();
  const passkeys = owner ? await listPasskeyMetadata(owner.userId) : [];
  const recovery = owner ? await getRecoveryCodeStatus(owner.userId) : { remaining: 0, generatedAt: null };
  res.json({
    enforcementActive: owner?.authMode === "password_plus_passkey",
    authMode: owner?.authMode || "password_or_passkey",
    recentAuth: await hasRecentAuth(_req.cookies?.ea_session),
    recovery,
    passkeys,
  });
});

router.post("/passkeys/registration/options", requireRecentAuth, async (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  if (!label) {
    return res.status(400).json({ message: "label is required" });
  }

  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  const existingPasskeys = await listPasskeys(owner.userId);
  const challenge = await createChallenge({
    userId: owner.userId,
    challengeType: "registration",
  });
  const options = await buildRegistrationOptions({
    userId: owner.userId,
    existingPasskeys,
    challenge: challenge.challenge,
    config: await webAuthnConfigForRequest(req),
  });
  res.json(options);
});

router.post("/passkeys/registration/verify", requireRecentAuth, async (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  if (!label) {
    return res.status(400).json({ message: "label is required" });
  }

  let consumedChallenge = null;
  try {
    const owner = await getOwner();
    if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
    const verification = await verifyRegistrationCredential({
      response: req.body,
      config: await webAuthnConfigForRequest(req),
      expectedChallenge: async (challenge) => {
        consumedChallenge = await consumeChallenge(challenge, {
          userId: owner.userId,
          challengeType: "registration",
        });
        return Boolean(consumedChallenge);
      },
    });

    if (!verification.verified || !consumedChallenge) {
      return res.status(401).json({ message: "Passkey registration failed" });
    }

    const registrationInfo = verification.registrationInfo;
    const credential = registrationInfo.credential;
    const passkey = await createPasskey({
      userId: owner.userId,
      credentialId: credential.id,
      label,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      signCount: credential.counter,
      transports: credential.transports || req.body?.response?.transports || req.body?.transports || [],
      backedUp: registrationInfo.credentialBackedUp,
      credentialDeviceType: registrationInfo.credentialDeviceType,
    });

    return res.json({
      passkey: toPasskeyMetadata(passkey),
      enforcementActive: owner.authMode === "password_plus_passkey",
      authMode: owner.authMode,
    });
  } catch (error) {
    logDevPasskeyFailure("Passkey registration failed", error);
    return res.status(401).json({ message: "Passkey registration failed" });
  }
});

router.delete("/passkeys/:credentialId", requireRecentAuth, async (req, res) => {
  const credentialId = req.params.credentialId!;
  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  const deleted = await deletePasskey(credentialId, owner.userId);
  if (!deleted) {
    return res.status(404).json({ message: "Passkey not found" });
  }

  const remainingCount = await countPasskeys(owner.userId);
  const finalAuthMode = owner.authMode === "password_plus_passkey" && remainingCount === 0
    ? "password_or_passkey"
    : owner.authMode;
  if (finalAuthMode !== owner.authMode) {
    await setOwnerAuthMode(owner.userId, "password_or_passkey");
  }
  const token = await rotateAllAuthState();
  setSessionCookie(res, token);
  const passkeys = await listPasskeyMetadata(owner.userId);
  res.json({
    success: true,
    enforcementActive: finalAuthMode === "password_plus_passkey",
    authMode: finalAuthMode,
    recentAuth: true,
    recovery: await getRecoveryCodeStatus(owner.userId),
    passkeys,
  });
});

router.post("/security/step-up/password", requireCookieSession, async (req, res) => {
  const owner = await getOwner();
  if (!owner || !validPassword(req.body?.password)
    || !await bcrypt.compare(req.body.password, owner.passwordHash)) {
    return res.status(401).json({ message: "Password confirmation failed" });
  }
  await markSessionRecentlyAuthenticated(req.cookies?.ea_session);
  return res.json({ recentAuth: true });
});

router.use("/security/canonical-origin", canonicalOriginRoutes);

router.patch("/security/auth-mode", requireRecentAuth, async (req, res) => {
  const authMode = req.body?.authMode;
  if (!isOwnerAuthMode(authMode)) {
    return res.status(400).json({ message: "Unsupported authentication mode" });
  }
  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  if (authMode === "password_plus_passkey" && await countPasskeys(owner.userId) === 0) {
    return res.status(409).json({ message: "Register a passkey before enabling strict mode" });
  }
  await setOwnerAuthMode(owner.userId, authMode);
  const token = await rotateAllAuthState();
  setSessionCookie(res, token);
  return res.json({ authMode, recentAuth: true });
});

router.post("/security/password", requireRecentAuth, async (req, res) => {
  if (!validPassword(req.body?.newPassword)) {
    return res.status(400).json({ message: "New password is required" });
  }
  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  await updateOwnerPasswordHash(owner.userId, await bcrypt.hash(req.body.newPassword, 12));
  const token = await rotateAllAuthState();
  setSessionCookie(res, token);
  return res.json({ success: true, recentAuth: true });
});

router.post("/recovery-codes/regenerate", requireRecentAuth, async (_req, res) => {
  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  const recoveryCodes = generateRecoveryCodes();
  await replaceRecoveryCodes(owner.userId, recoveryCodes);
  return res.json({ recoveryCodes });
});

router.post("/recovery", recoveryLimiter, async (req, res) => {
  if (!validPassword(req.body?.newPassword) || typeof req.body?.recoveryCode !== "string") {
    return res.status(400).json({ message: "Recovery code and new password are required" });
  }
  const owner = await getOwner();
  if (!owner) return res.status(401).json({ message: "Recovery failed" });
  const newPasswordHash = await bcrypt.hash(req.body.newPassword, 12);
  if (!await consumeRecoveryCode(owner.userId, req.body.recoveryCode)) {
    return res.status(401).json({ message: "Recovery failed" });
  }

  await updateOwnerPasswordHash(owner.userId, newPasswordHash);
  await setOwnerAuthMode(owner.userId, "password_or_passkey");
  await db.batch([
    { sql: "DELETE FROM ea_passkey_credentials WHERE user_id = ?", args: [owner.userId] },
    { sql: "DELETE FROM ea_pending_auth WHERE user_id = ?", args: [owner.userId] },
    { sql: "DELETE FROM ea_webauthn_challenges WHERE user_id = ?", args: [owner.userId] },
  ], "write");
  await revokeAllSessions();
  const recoveryCodes = generateRecoveryCodes();
  await replaceRecoveryCodes(owner.userId, recoveryCodes);
  const token = await createSession();
  setSessionCookie(res, token);
  clearPendingAuthCookie(res);
  return res.json({ authenticated: true, recoveryCodes });
});

router.get("/check", timeRoute("/api/auth/check"), async (req, res) => {
  const token = req.cookies?.ea_session;
  res.json({ authenticated: await validateSession(token) });
});

router.post("/logout", async (req, res) => {
  const token = req.cookies?.ea_session;
  if (token) {
    await deleteSession(token);
  }
  await clearPendingAuthState(req, res);
  clearSessionCookie(res);
  res.json({ authenticated: false });
});

// --- API tokens (for iOS Shortcuts etc.) ---

router.get("/api-tokens", requireCookieSession, async (_req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT id, label, scopes, created_at, last_used_at, expires_at FROM ea_api_tokens ORDER BY created_at DESC",
      args: [],
    });
    const rows = result.rows.map((r) => ({
      id: r.id,
      label: r.label,
      scopes: safeParseScopes(r.scopes),
      created_at: r.created_at,
      last_used_at: r.last_used_at,
      expires_at: r.expires_at,
    }));
    res.json(rows);
  } catch (err) {
    console.error("Error listing api tokens:", err);
    res.status(500).json({ message: "Failed to list tokens" });
  }
});

// Run requireCookieSession BEFORE tokenMintLimiter so an unauthenticated caller from the owner's
// egress IP can't burn the 5/15min mint budget and lock the real user out.
router.post("/api-tokens", requireRecentAuth, tokenMintLimiter, async (req, res) => {
  const { label, scopes } = req.body || {};
  if (!label || typeof label !== "string" || !label.trim()) {
    return res.status(400).json({ message: "label is required" });
  }
  const requestedScopes = Array.isArray(scopes) && scopes.length ? scopes : ["actual:write"];
  const invalid = requestedScopes.filter((s) => !KNOWN_SCOPES.has(s));
  if (invalid.length) {
    return res.status(400).json({ message: `Unknown scopes: ${invalid.join(", ")}` });
  }

  try {
    const raw = "eatk_" + crypto.randomBytes(32).toString("base64url");
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const expiresAt = Date.now() + API_TOKEN_TTL_MS;
    await db.execute({
      sql: "INSERT INTO ea_api_tokens (token_hash, label, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      args: [hash, label.trim(), JSON.stringify(requestedScopes), Date.now(), expiresAt],
    });
    res.json({ token: raw, label: label.trim(), scopes: requestedScopes, expires_at: expiresAt });
  } catch (err) {
    console.error("Error creating api token:", err);
    res.status(500).json({ message: "Failed to create token" });
  }
});

router.delete("/api-tokens/:id", requireCookieSession, async (req, res) => {
  const id = parseInt(req.params.id!, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: "invalid id" });
  }
  try {
    await db.execute({ sql: "DELETE FROM ea_api_tokens WHERE id = ?", args: [id] });
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting api token:", err);
    res.status(500).json({ message: "Failed to delete token" });
  }
});

function safeParseScopes(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((scope): scope is string => typeof scope === "string")
      : [];
  } catch { return []; }
}

export default router;
