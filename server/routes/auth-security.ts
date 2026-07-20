import { Router } from "express";
import type { Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import db from "../db/connection.ts";
import {
  getPasswordStepUpThrottle,
  markSessionPasswordAuthenticated,
  recordPasswordStepUpFailure,
  requireCookieSession,
  requireRecentPasswordAuth,
  type SessionSecurityContext,
} from "../middleware/auth.ts";
import { wrapRouterAsync } from "../middleware/async-handler.ts";
import { isOwnerAuthMode } from "../auth/auth-mode.ts";
import { countPasskeys } from "../auth/passkey-store.ts";
import { getOwner } from "../auth/owner-store.ts";
import {
  isAcceptableNewPassword,
  isVerifiablePassword,
  MIN_NEW_PASSWORD_LENGTH,
} from "../auth/password-policy.ts";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
} from "../auth/recovery-code-store.ts";
import { ownerSecurityTransitionService } from "../auth/security-transition.ts";
import {
  clearSessionCookie,
  issueSessionCookie,
} from "../auth/session-cookie.ts";
import { PENDING_AUTH_COOKIE_NAME } from "../auth/pending-auth-store.ts";
import canonicalOriginRoutes from "./auth-canonical-origin.ts";

const router = Router();
wrapRouterAsync(router);

const API_TOKEN_TTL_DAYS = Number.parseInt(process.env.EA_API_TOKEN_TTL_DAYS || "90", 10) || 90;
const API_TOKEN_TTL_MS = API_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
const KNOWN_SCOPES = new Set(["actual:write"]);

class RecoveryFailedError extends Error {}

const tokenMintLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Too many token creations, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Too many recovery attempts, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

const stepUpIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many password confirmation attempts, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

function passwordSessionContext(res: Response): SessionSecurityContext {
  const context = res.locals.authSession as SessionSecurityContext | undefined;
  if (!context) throw new Error("Password-authenticated session context is missing");
  return context;
}

function staleSecurityState(res: Response) {
  clearSessionCookie(res);
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

router.post("/security/step-up/password", requireCookieSession, stepUpIpLimiter, async (req, res) => {
  const throttle = await getPasswordStepUpThrottle(req.cookies?.ea_session);
  if (!throttle) return res.status(401).json({ message: "Not authenticated" });
  if (throttle.blockedUntil > Date.now()) {
    return res.status(429).json({ message: "Too many password confirmation attempts, try again later" });
  }
  const owner = await getOwner();
  if (!owner || !isVerifiablePassword(req.body?.password)
    || !await bcrypt.compare(req.body.password, owner.passwordHash)) {
    const failed = await recordPasswordStepUpFailure(req.cookies?.ea_session);
    if (failed?.blockedUntil && failed.blockedUntil > Date.now()) {
      return res.status(429).json({ message: "Too many password confirmation attempts, try again later" });
    }
    return res.status(401).json({ message: "Password confirmation failed" });
  }
  await markSessionPasswordAuthenticated(req.cookies?.ea_session);
  return res.json({ recentAuth: true });
});

router.use("/security/canonical-origin", canonicalOriginRoutes);

router.patch("/security/auth-mode", requireRecentPasswordAuth, async (req, res) => {
  const authMode = req.body?.authMode;
  if (!isOwnerAuthMode(authMode)) {
    return res.status(400).json({ message: "Unsupported authentication mode" });
  }
  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  const session = passwordSessionContext(res);
  if (owner.securityGeneration !== session.securityGeneration) return staleSecurityState(res);
  if (authMode === "password_plus_passkey" && await countPasskeys(owner.userId) === 0) {
    return res.status(409).json({ message: "Register a passkey before enabling strict mode" });
  }
  const nextGeneration = await ownerSecurityTransitionService.transition({
    userId: owner.userId,
    expectedGeneration: session.securityGeneration,
    mutate: async (tx) => {
      await tx.execute({
        sql: "UPDATE ea_owner SET auth_mode = ? WHERE singleton_id = 1 AND user_id = ?",
        args: [authMode, owner.userId],
      });
    },
  });
  if (!nextGeneration) return staleSecurityState(res);
  if (!await issueReplacementPasswordSession(res, nextGeneration, session)) {
    return staleSecurityState(res);
  }
  return res.json({ authMode, recentAuth: true });
});

router.post("/security/password", requireRecentPasswordAuth, async (req, res) => {
  if (!isAcceptableNewPassword(req.body?.newPassword)) {
    return res.status(400).json({ message: `New password must be at least ${MIN_NEW_PASSWORD_LENGTH} characters` });
  }
  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  const session = passwordSessionContext(res);
  if (owner.securityGeneration !== session.securityGeneration) return staleSecurityState(res);
  const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  const nextGeneration = await ownerSecurityTransitionService.transition({
    userId: owner.userId,
    expectedGeneration: session.securityGeneration,
    mutate: async (tx) => {
      await tx.execute({
        sql: "UPDATE ea_owner SET password_hash = ? WHERE singleton_id = 1 AND user_id = ?",
        args: [passwordHash, owner.userId],
      });
    },
  });
  if (!nextGeneration) return staleSecurityState(res);
  if (!await issueSessionCookie(res, {
    securityGeneration: nextGeneration,
    authMethod: "password",
    passwordAuthenticatedAt: Date.now(),
  })) return staleSecurityState(res);
  return res.json({ success: true, recentAuth: true });
});

router.post("/recovery-codes/regenerate", requireRecentPasswordAuth, async (_req, res) => {
  const owner = await getOwner();
  if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
  const session = passwordSessionContext(res);
  if (owner.securityGeneration !== session.securityGeneration) return staleSecurityState(res);
  const recoveryCodes = generateRecoveryCodes();
  const generatedAt = Date.now();
  const nextGeneration = await ownerSecurityTransitionService.transition({
    userId: owner.userId,
    expectedGeneration: session.securityGeneration,
    mutate: async (tx) => {
      await tx.execute({
        sql: "DELETE FROM ea_owner_recovery_codes WHERE user_id = ?",
        args: [owner.userId],
      });
      for (const code of recoveryCodes) {
        await tx.execute({
          sql: `INSERT INTO ea_owner_recovery_codes (user_id, code_hash, generated_at)
                VALUES (?, ?, ?)`,
          args: [owner.userId, hashRecoveryCode(code), generatedAt],
        });
      }
    },
  });
  if (!nextGeneration) return staleSecurityState(res);
  if (!await issueReplacementPasswordSession(res, nextGeneration, session)) {
    return staleSecurityState(res);
  }
  return res.json({ recoveryCodes });
});

router.post("/recovery", recoveryLimiter, async (req, res) => {
  if (!isAcceptableNewPassword(req.body?.newPassword) || typeof req.body?.recoveryCode !== "string") {
    return res.status(400).json({ message: `Recovery code and a new password of at least ${MIN_NEW_PASSWORD_LENGTH} characters are required` });
  }
  const owner = await getOwner();
  if (!owner) return res.status(401).json({ message: "Recovery failed" });
  const newPasswordHash = await bcrypt.hash(req.body.newPassword, 12);
  const recoveryCodes = generateRecoveryCodes();
  const generatedAt = Date.now();
  let nextGeneration: number | null;
  try {
    nextGeneration = await ownerSecurityTransitionService.transition({
      userId: owner.userId,
      expectedGeneration: owner.securityGeneration,
      revokeApiTokens: true,
      mutate: async (tx) => {
        const consumed = await tx.execute({
          sql: `UPDATE ea_owner_recovery_codes
                   SET used_at = ?
                 WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
          args: [generatedAt, owner.userId, hashRecoveryCode(req.body.recoveryCode)],
        });
        if (consumed.rowsAffected !== 1) throw new RecoveryFailedError();
        await tx.execute({
          sql: `UPDATE ea_owner
                   SET password_hash = ?, auth_mode = 'password_or_passkey'
                 WHERE singleton_id = 1 AND user_id = ?`,
          args: [newPasswordHash, owner.userId],
        });
        await tx.execute({
          sql: "DELETE FROM ea_passkey_credentials WHERE user_id = ?",
          args: [owner.userId],
        });
        await tx.execute({
          sql: "DELETE FROM ea_owner_recovery_codes WHERE user_id = ?",
          args: [owner.userId],
        });
        for (const code of recoveryCodes) {
          await tx.execute({
            sql: `INSERT INTO ea_owner_recovery_codes (user_id, code_hash, generated_at)
                  VALUES (?, ?, ?)`,
            args: [owner.userId, hashRecoveryCode(code), generatedAt],
          });
        }
      },
    });
  } catch (error) {
    if (error instanceof RecoveryFailedError) {
      return res.status(401).json({ message: "Recovery failed" });
    }
    throw error;
  }
  if (!nextGeneration) return res.status(401).json({ message: "Recovery failed" });
  if (!await issueSessionCookie(res, {
    securityGeneration: nextGeneration,
    authMethod: "recovery",
    passwordAuthenticatedAt: 0,
  })) return res.status(401).json({ message: "Recovery failed" });
  res.clearCookie(PENDING_AUTH_COOKIE_NAME, { path: "/" });
  return res.json({ authenticated: true, recoveryCodes });
});

router.get("/api-tokens", requireCookieSession, async (_req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT id, label, scopes, created_at, last_used_at, expires_at FROM ea_api_tokens ORDER BY created_at DESC",
      args: [],
    });
    const rows = result.rows.map((row) => ({
      id: row.id,
      label: row.label,
      scopes: safeParseScopes(row.scopes),
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      expires_at: row.expires_at,
    }));
    res.json(rows);
  } catch (error) {
    console.error("Error listing api tokens:", error);
    res.status(500).json({ message: "Failed to list tokens" });
  }
});

// Authenticate before consuming the per-IP mint budget so outsiders cannot
// lock the owner out of token creation from a shared egress address.
router.post("/api-tokens", requireRecentPasswordAuth, tokenMintLimiter, async (req, res) => {
  const { label, scopes } = req.body || {};
  if (!label || typeof label !== "string" || !label.trim()) {
    return res.status(400).json({ message: "label is required" });
  }
  const requestedScopes = Array.isArray(scopes) && scopes.length ? scopes : ["actual:write"];
  const invalid = requestedScopes.filter((scope) => !KNOWN_SCOPES.has(scope));
  if (invalid.length) {
    return res.status(400).json({ message: `Unknown scopes: ${invalid.join(", ")}` });
  }

  try {
    const owner = await getOwner();
    if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
    const session = passwordSessionContext(res);
    if (owner.securityGeneration !== session.securityGeneration) return staleSecurityState(res);
    const raw = `eatk_${crypto.randomBytes(32).toString("base64url")}`;
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const expiresAt = Date.now() + API_TOKEN_TTL_MS;
    const nextGeneration = await ownerSecurityTransitionService.transition({
      userId: owner.userId,
      expectedGeneration: session.securityGeneration,
      mutate: async (tx) => {
        await tx.execute({
          sql: "INSERT INTO ea_api_tokens (token_hash, label, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
          args: [hash, label.trim(), JSON.stringify(requestedScopes), Date.now(), expiresAt],
        });
      },
    });
    if (!nextGeneration) return staleSecurityState(res);
    if (!await issueReplacementPasswordSession(res, nextGeneration, session)) {
      return staleSecurityState(res);
    }
    res.json({ token: raw, label: label.trim(), scopes: requestedScopes, expires_at: expiresAt });
  } catch (error) {
    console.error("Error creating api token:", error);
    res.status(500).json({ message: "Failed to create token" });
  }
});

router.delete("/api-tokens/:id", requireRecentPasswordAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id!, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: "invalid id" });
  }
  try {
    const owner = await getOwner();
    if (!owner) return res.status(409).json({ message: "Instance is not claimed" });
    const session = passwordSessionContext(res);
    if (owner.securityGeneration !== session.securityGeneration) return staleSecurityState(res);
    const existing = await db.execute({ sql: "SELECT id FROM ea_api_tokens WHERE id = ?", args: [id] });
    if (!existing.rows.length) return res.status(404).json({ message: "Token not found" });
    const nextGeneration = await ownerSecurityTransitionService.transition({
      userId: owner.userId,
      expectedGeneration: session.securityGeneration,
      mutate: async (tx) => {
        await tx.execute({ sql: "DELETE FROM ea_api_tokens WHERE id = ?", args: [id] });
      },
    });
    if (!nextGeneration) return staleSecurityState(res);
    if (!await issueReplacementPasswordSession(res, nextGeneration, session)) {
      return staleSecurityState(res);
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting api token:", error);
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
  } catch {
    return [];
  }
}

export default router;
