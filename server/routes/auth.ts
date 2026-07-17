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
} from "../auth/pending-auth-store.ts";
import {
  createChallenge,
  consumeChallenge,
  deleteChallengesForPendingAuth,
} from "../auth/webauthn-challenge-store.ts";
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
import { rotateSessionsForCurrentBrowser } from "../auth/session-rotation.ts";
import { getOwner } from "../auth/owner-store.ts";
import { claimInitialOwner } from "../auth/owner-claim-service.ts";

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

function webAuthnConfigForRequest(req: Request) {
  return resolveWebAuthnConfig(process.env, { requestOrigin: req.get("origin") });
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

router.get("/setup/status", async (_req, res) => {
  res.json({ claimed: Boolean(await getOwner()) });
});

router.post("/setup/claim", ownerClaimLimiter, async (req, res) => {
  const result = await claimInitialOwner(req.body?.password);
  if (result.status === "invalid") {
    return res.status(400).json({ message: "Password is required" });
  }
  if (result.status === "conflict") {
    return res.status(409).json({ message: "Instance is already claimed" });
  }

  const token = await createSession();
  setSessionCookie(res, token);
  clearPendingAuthCookie(res);
  return res.json({ authenticated: true, claimed: true });
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
  if (registeredPasskeyCount > 0) {
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
    passkeySetupRecommended: true,
  });
});

router.post("/passkey/authentication/options", passkeyAuthLimiter, async (req, res) => {
  const pending = await readPendingAuth(req.cookies?.[PENDING_AUTH_COOKIE_NAME]);
  if (!pending) {
    clearPendingAuthCookie(res);
    return res.status(401).json({ message: "Pending authentication required" });
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
    config: webAuthnConfigForRequest(req),
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
      config: webAuthnConfigForRequest(req),
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
  res.json({
    enforcementActive: passkeys.length > 0,
    passkeys,
  });
});

router.post("/passkeys/registration/options", requireCookieSession, async (req, res) => {
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
    config: webAuthnConfigForRequest(req),
  });
  res.json(options);
});

router.post("/passkeys/registration/verify", requireCookieSession, async (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  if (!label) {
    return res.status(400).json({ message: "label is required" });
  }

  let consumedChallenge = null;
  try {
    const owner = await getOwner();
    if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
    const existingCount = await countPasskeys(owner.userId);
    const verification = await verifyRegistrationCredential({
      response: req.body,
      config: webAuthnConfigForRequest(req),
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

    if (existingCount === 0) {
      const token = await rotateSessionsForCurrentBrowser();
      setSessionCookie(res, token);
    }

    return res.json({
      passkey: toPasskeyMetadata(passkey),
      enforcementActive: true,
    });
  } catch (error) {
    logDevPasskeyFailure("Passkey registration failed", error);
    return res.status(401).json({ message: "Passkey registration failed" });
  }
});

router.delete("/passkeys/:credentialId", requireCookieSession, async (req, res) => {
  const credentialId = req.params.credentialId!;
  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  const deleted = await deletePasskey(credentialId, owner.userId);
  if (!deleted) {
    return res.status(404).json({ message: "Passkey not found" });
  }

  const token = await rotateSessionsForCurrentBrowser();
  setSessionCookie(res, token);
  const passkeys = await listPasskeyMetadata(owner.userId);
  res.json({
    success: true,
    enforcementActive: passkeys.length > 0,
    passkeys,
  });
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

router.get("/api-tokens", requireCookieSession, async (req, res) => {
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
router.post("/api-tokens", requireCookieSession, tokenMintLimiter, async (req, res) => {
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
