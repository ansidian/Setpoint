import { Router } from "express";
import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import {
  validateSession,
  deleteSession,
  requireCookieSession,
  requireRecentPasswordAuth,
  hasRecentPasswordAuth,
  type SessionSecurityContext,
} from "../middleware/auth.ts";
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
import { createChallenge, consumeChallenge, deleteChallengesForPendingAuth } from "../auth/webauthn-challenge-store.ts";
import {
  countPasskeys,
  listPasskeys,
  listPasskeyMetadata,
  getPasskeyByCredentialId,
  createPasskeyStore,
  updatePasskeyUsage,
  toPasskeyMetadata,
} from "../auth/passkey-store.ts";
import {
  buildRegistrationOptions,
  verifyRegistrationCredential,
  buildAuthenticationOptions,
  verifyAuthenticationCredential,
} from "../auth/webauthn-service.ts";
import { resolveWebAuthnConfig } from "../auth/webauthn-config.ts";
import { getOwner } from "../auth/owner-store.ts";
import { passwordLoginThrottle } from "../auth/password-login-throttle.ts";
import { claimInitialOwner } from "../auth/owner-claim-service.ts";
import { isAcceptableNewPassword, isVerifiablePassword, MIN_NEW_PASSWORD_LENGTH } from "../auth/password-policy.ts";
import { verifySetupToken } from "../auth/setup-token.ts";
import { resolvePasswordLogin } from "../auth/auth-mode.ts";
import { generateRecoveryCodes, getRecoveryCodeStatus, hashRecoveryCode } from "../auth/recovery-code-store.ts";
import { canonicalUrlService, normalizeCanonicalOrigin } from "../platform/canonical-url.ts";
import { ownerSecurityTransitionService } from "../auth/security-transition.ts";
import { clearSessionCookie, issueSessionCookie } from "../auth/session-cookie.ts";
import authSecurityRoutes from "./auth-security.ts";

const router = Router();
// P1-12: forward async-handler rejections to the terminal errorHandler so a
// transient DB/crypto failure returns a 500 instead of hanging the request
// (notably /login). Must run before any route is registered.
wrapRouterAsync(router);

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
  skipSuccessfulRequests: true,
});


function setPendingAuthCookie(res: Response, token: string) {
  res.cookie(PENDING_AUTH_COOKIE_NAME, token, buildPendingAuthCookieOptions());
}

function clearPendingAuthCookie(res: Response) {
  res.clearCookie(PENDING_AUTH_COOKIE_NAME, { path: "/" });
}

async function webAuthnConfigForRequest(req: Request) {
  const canonicalOrigin = process.env.NODE_ENV === "production"
    ? await canonicalUrlService.resolveCanonicalOrigin(process.env)
    : null;
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

function passwordSessionContext(res: Response): SessionSecurityContext {
  const context = res.locals.authSession as SessionSecurityContext | undefined;
  if (!context) throw new Error("Password-authenticated session context is missing");
  return context;
}

function staleSecurityState(res: Response) {
  clearSessionCookie(res);
  clearPendingAuthCookie(res);
  return res.status(409).json({
    code: "SECURITY_STATE_CHANGED",
    message: "Security state changed; sign in and try again",
  });
}

async function issueReplacementPasswordSession(
  res: Response,
  nextGeneration: number,
  previous: SessionSecurityContext,
): Promise<boolean> {
  return issueSessionCookie(res, {
    securityGeneration: nextGeneration,
    authMethod: "password",
    passwordAuthenticatedAt: previous.passwordAuthenticatedAt,
  });
}

router.get("/setup/status", async (_req, res) => {
  res.json({ claimed: Boolean(await getOwner()) });
});

router.post("/setup/claim", ownerClaimLimiter, async (req, res) => {
  if (await getOwner()) {
    return res.status(409).json({ message: "Instance is already claimed" });
  }
  const setupToken = verifySetupToken(req.body?.setupToken, process.env.EA_SETUP_TOKEN);
  if (!setupToken.configured) {
    return res.status(503).json({ message: "Setup is unavailable until EA_SETUP_TOKEN is configured" });
  }
  if (!setupToken.verified) {
    return res.status(403).json({ message: "Setup token is invalid" });
  }
  if (!isAcceptableNewPassword(req.body?.password)) {
    return res.status(400).json({ message: `Password must be at least ${MIN_NEW_PASSWORD_LENGTH} characters` });
  }
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
    return res.status(400).json({ message: `Password must be at least ${MIN_NEW_PASSWORD_LENGTH} characters` });
  }
  if (result.status === "conflict") {
    return res.status(409).json({ message: "Instance is already claimed" });
  }

  if (!await issueSessionCookie(res, {
    securityGeneration: result.owner.securityGeneration,
    authMethod: "password",
  })) {
    return staleSecurityState(res);
  }
  clearPendingAuthCookie(res);
  return res.json({ authenticated: true, claimed: true, recoveryCodes });
});

router.post("/login", timeRoute("/api/auth/login"), loginLimiter, async (req, res) => {
  const { password } = req.body;
  const owner = await getOwner();

  if (!owner) {
    return res.status(401).json({ message: "Invalid password" });
  }
  const attempt = await passwordLoginThrottle.reserveAttempt();
  if (!attempt.allowed) {
    res.setHeader("Retry-After", attempt.retryAfterSeconds);
    return res.status(429).json({ message: "Too many login attempts, try again later" });
  }
  if (!isVerifiablePassword(password)) {
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
    const passwordAuthenticatedAt = Date.now();
    const pending = await createPendingAuth({
      userId: owner.userId,
      securityGeneration: owner.securityGeneration,
      passwordAuthenticatedAt,
      expectedAuthMode: "password_plus_passkey",
    });
    if (!pending) {
      clearPendingAuthCookie(res);
      return res.status(409).json({ message: "Security state changed; try signing in again" });
    }
    setPendingAuthCookie(res, pending.token);
    clearSessionCookie(res);
    return res.json({
      authenticated: false,
      passkeyRequired: true,
    });
  }

  if (!await issueSessionCookie(res, {
    securityGeneration: owner.securityGeneration,
    authMethod: "password",
  })) {
    return staleSecurityState(res);
  }
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
    const created = await createPendingAuth({
      userId: owner.userId,
      securityGeneration: owner.securityGeneration,
      passwordAuthenticatedAt: 0,
      expectedAuthMode: "password_or_passkey",
    });
    if (!created) {
      clearPendingAuthCookie(res);
      return res.status(409).json({ message: "Security state changed; try signing in again" });
    }
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
    securityGeneration: pending.securityGeneration,
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
        return consumedChallenge?.pendingAuthHash === pending.tokenHash
          && consumedChallenge.securityGeneration === pending.securityGeneration;
      },
    });

    if (!verification.verified || !consumedChallenge) {
      return res.status(401).json({ message: "Passkey verification failed" });
    }

    const authInfo = verification.authenticationInfo || {};
    const updatedPasskey = await updatePasskeyUsage(passkey.credentialId, {
      signCount: authInfo.newCounter,
      backedUp: authInfo.credentialBackedUp,
      credentialDeviceType: authInfo.credentialDeviceType,
    });
    const consumedPending = await consumePendingAuth(pendingToken);
    if (!updatedPasskey || !consumedPending
      || consumedPending.securityGeneration !== pending.securityGeneration) {
      clearPendingAuthCookie(res);
      return res.status(401).json({ message: "Passkey verification failed" });
    }
    const authMethod = pending.passwordAuthenticatedAt > 0 ? "password_plus_passkey" : "passkey";
    if (!await issueSessionCookie(res, {
      securityGeneration: pending.securityGeneration,
      authMethod,
      passwordAuthenticatedAt: pending.passwordAuthenticatedAt,
    })) {
      clearPendingAuthCookie(res);
      return res.status(409).json({ message: "Security state changed; try signing in again" });
    }
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
    recentAuth: await hasRecentPasswordAuth(_req.cookies?.ea_session),
    recovery,
    passkeys,
  });
});

router.post("/passkeys/registration/options", requireRecentPasswordAuth, async (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  if (!label) {
    return res.status(400).json({ message: "label is required" });
  }

  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  const session = passwordSessionContext(res);
  if (owner.securityGeneration !== session.securityGeneration) return staleSecurityState(res);
  const existingPasskeys = await listPasskeys(owner.userId);
  const challenge = await createChallenge({
    userId: owner.userId,
    challengeType: "registration",
    securityGeneration: session.securityGeneration,
  });
  const options = await buildRegistrationOptions({
    userId: owner.userId,
    existingPasskeys,
    challenge: challenge.challenge,
    config: await webAuthnConfigForRequest(req),
  });
  res.json(options);
});

router.post("/passkeys/registration/verify", requireRecentPasswordAuth, async (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  if (!label) {
    return res.status(400).json({ message: "label is required" });
  }

  let consumedChallenge = null;
  try {
    const owner = await getOwner();
    if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
    const session = passwordSessionContext(res);
    if (owner.securityGeneration !== session.securityGeneration) return staleSecurityState(res);
    const verification = await verifyRegistrationCredential({
      response: req.body,
      config: await webAuthnConfigForRequest(req),
      expectedChallenge: async (challenge) => {
        consumedChallenge = await consumeChallenge(challenge, {
          userId: owner.userId,
          challengeType: "registration",
        });
        return Boolean(
          consumedChallenge
          && consumedChallenge.securityGeneration === session.securityGeneration
        );
      },
    });

    if (!verification.verified || !consumedChallenge) {
      return res.status(401).json({ message: "Passkey registration failed" });
    }

    const registrationInfo = verification.registrationInfo;
    const credential = registrationInfo.credential;
    let passkey = null;
    const nextGeneration = await ownerSecurityTransitionService.transition({
      userId: owner.userId,
      expectedGeneration: session.securityGeneration,
      mutate: async (tx) => {
        passkey = await createPasskeyStore(tx).createPasskey({
          userId: owner.userId,
          credentialId: credential.id,
          label,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          signCount: credential.counter,
          transports: credential.transports || req.body?.response?.transports || req.body?.transports || [],
          backedUp: registrationInfo.credentialBackedUp,
          credentialDeviceType: registrationInfo.credentialDeviceType,
        });
      },
    });
    if (!nextGeneration || !passkey) return staleSecurityState(res);
    if (!await issueReplacementPasswordSession(res, nextGeneration, session)) {
      return staleSecurityState(res);
    }

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

router.delete("/passkeys/:credentialId", requireRecentPasswordAuth, async (req, res) => {
  const credentialId = req.params.credentialId!;
  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  const existingPasskey = await getPasskeyByCredentialId(credentialId);
  if (!existingPasskey || existingPasskey.userId !== owner.userId) {
    return res.status(404).json({ message: "Passkey not found" });
  }
  const session = passwordSessionContext(res);
  if (owner.securityGeneration !== session.securityGeneration) return staleSecurityState(res);
  let remainingCount = 0;
  const nextGeneration = await ownerSecurityTransitionService.transition({
    userId: owner.userId,
    expectedGeneration: session.securityGeneration,
    mutate: async (tx) => {
      const store = createPasskeyStore(tx);
      const deleted = await store.deletePasskey(credentialId, owner.userId);
      if (!deleted) throw new Error("Passkey not found");
      remainingCount = await store.countPasskeys(owner.userId);
      if (owner.authMode === "password_plus_passkey" && remainingCount === 0) {
        await tx.execute({
          sql: "UPDATE ea_owner SET auth_mode = 'password_or_passkey' WHERE singleton_id = 1 AND user_id = ?",
          args: [owner.userId],
        });
      }
    },
  });
  if (!nextGeneration) return staleSecurityState(res);
  const finalAuthMode = owner.authMode === "password_plus_passkey" && remainingCount === 0
    ? "password_or_passkey"
    : owner.authMode;
  if (!await issueReplacementPasswordSession(res, nextGeneration, session)) {
    return staleSecurityState(res);
  }
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

router.use(authSecurityRoutes);

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

export default router;
