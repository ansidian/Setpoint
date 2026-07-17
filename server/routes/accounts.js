import { Router } from "express";
import crypto from "crypto";
import db from "../db/connection.ts";
import { hashToken, requireCookieSession } from "../middleware/auth.ts";
import { wrapRouterAsync } from "../middleware/async-handler.ts";
import { encrypt, decrypt } from "../platform/encryption.ts";
import { getAuthUrl, handleCallback, testConnection as testGmail } from "../email/gmail.js";
import { testConnection as testIcloud } from "../email/icloud.js";
import { queueEmailIndexBackfill } from "../email/email-index.js";
import { wakeEmailBackfillWorker } from "../email/email-backfill-worker.js";
import { canonicalizeConfiguredAccounts } from "../platform/account-canonical.ts";
import settingsRoutes from "./settings.js";
import remindersRoutes from "./reminders.js";

const router = Router();
// P1-12: forward async-handler rejections to the terminal errorHandler so a
// transient failure (e.g. the GET /accounts/gmail/auth CSRF-token INSERT)
// returns a 500 instead of hanging the request. Must run before route
// registration.
wrapRouterAsync(router);
const GMAIL_OAUTH_BIND_COOKIE = "ea_oauth_bind";
const GMAIL_OAUTH_BIND_COOKIE_PATH = "/api/ea/accounts/gmail/callback";

function gmailOauthBindCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: GMAIL_OAUTH_BIND_COOKIE_PATH,
  };
}

function clearGmailOauthBindCookie(res) {
  res.clearCookie(GMAIL_OAUTH_BIND_COOKIE, { path: GMAIL_OAUTH_BIND_COOKIE_PATH });
}

// Gmail OAuth callback — no auth required (it's a redirect from Google)
router.get("/accounts/gmail/callback", async (req, res) => {
  const { code, state: csrfToken, error: oauthError } = req.query;
  const oauthBindCookie = req.cookies?.[GMAIL_OAUTH_BIND_COOKIE];
  clearGmailOauthBindCookie(res);
  if (oauthError) {
    if (csrfToken) {
      await db.execute({
        sql: "DELETE FROM ea_csrf_tokens WHERE token = ?",
        args: [csrfToken],
      }).catch(() => {});
    }
    return res.status(400).send(`Google OAuth error: ${oauthError}`);
  }
  if (!code || !csrfToken) {
    return res.status(400).send("Missing code or state parameter");
  }

  try {
    // Validate CSRF token (SEC-03)
    const csrfResult = await db.execute({
      sql: "SELECT account_label, expires_at, browser_bind_hash, oauth_user_id, oauth_label FROM ea_csrf_tokens WHERE token = ?",
      args: [csrfToken],
    });

    if (!csrfResult.rows.length) {
      return res.status(400).send("Invalid OAuth state - CSRF validation failed");
    }

    const csrfRow = csrfResult.rows[0];

    // Delete token immediately (one-time use)
    await db.execute({
      sql: "DELETE FROM ea_csrf_tokens WHERE token = ?",
      args: [csrfToken],
    });

    // Check expiry
    if (Date.now() > csrfRow.expires_at) {
      return res.status(400).send("OAuth state expired - please try again");
    }
    if (!oauthBindCookie || !csrfRow.browser_bind_hash) {
      return res.status(400).send("OAuth browser binding missing - please try again");
    }
    if (hashToken(oauthBindCookie) !== csrfRow.browser_bind_hash) {
      return res.status(400).send("OAuth browser binding mismatch - please try again");
    }

    // Recover userId and label from DB (tamper-proof)
    const [legacyUserId, ...legacyLabelParts] = String(csrfRow.account_label || "").split(":");
    const userId = csrfRow.oauth_user_id || legacyUserId;
    const label = csrfRow.oauth_label ?? legacyLabelParts.join(":");

    const result = await handleCallback(code, null, userId);
    if (label && label !== "Gmail") {
      await db.execute({
        sql: "UPDATE ea_accounts SET label = ? WHERE id = ?",
        args: [label, result.accountId],
      });
    }
    await queueEmailIndexBackfill(userId);
    wakeEmailBackfillWorker();
    const baseUrl = process.env.NODE_ENV === "production" ? "" : "http://localhost:5173";
    res.redirect(`${baseUrl}/settings?account_connected=${result.email}`);
  } catch (err) {
    // This callback is unauthenticated: log the full error server-side but send a
    // generic client message so the internal error detail is never reflected back.
    console.error("Gmail OAuth callback error:", err);
    res.status(500).send("OAuth failed. Please try connecting the account again.");
  }
});

// All other routes require auth
router.use(requireCookieSession);

router.get("/accounts", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  try {
    const result = await db.execute({
      sql: "SELECT id, type, email, label, color, icon, calendar_enabled, sort_order, created_at, needs_reauth FROM ea_accounts WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC",
      args: [userId],
    });
    const accounts = result.rows.map((row) => ({ ...row, needs_reauth: !!row.needs_reauth }));
    res.json(canonicalizeConfiguredAccounts(accounts));
  } catch (err) {
    console.error("Error listing accounts:", err);
    res.status(500).json({ message: "Failed to list accounts" });
  }
});

router.get("/accounts/gmail/auth", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const label = req.query.label || "Gmail";
  const oauthBind = crypto.randomBytes(32).toString("base64url");

  // Generate CSRF token and store with label
  const csrfToken = crypto.randomUUID();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
  // P3-19: abandoned OAuth flows otherwise leak CSRF rows forever (deleted only on
  // a matching callback). Opportunistically sweep expired rows on each new flow
  // using idx_ea_csrf_tokens_expires (migration 017).
  await db.execute({
    sql: "DELETE FROM ea_csrf_tokens WHERE expires_at < ?",
    args: [Date.now()],
  });
  await db.execute({
    sql: "INSERT INTO ea_csrf_tokens (token, account_label, expires_at, browser_bind_hash, oauth_user_id, oauth_label) VALUES (?, ?, ?, ?, ?, ?)",
    args: [csrfToken, `${userId}:${label}`, expiresAt, hashToken(oauthBind), userId, label],
  });

  res.cookie(GMAIL_OAUTH_BIND_COOKIE, oauthBind, gmailOauthBindCookieOptions());
  res.json({ url: getAuthUrl(csrfToken) });
});

router.post("/accounts/icloud", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const { email, password, label, color } = req.body;
  if (!email || !password)
    return res
      .status(400)
      .json({ message: "email and password (app-specific) are required" });

  try {
    await testIcloud(email, password);
    const accountId = `icloud-${email.split("@")[0]}`;
    const maxSort = await db.execute({
      sql: "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ea_accounts WHERE user_id = ?",
      args: [userId],
    });
    const nextSort = maxSort.rows[0].next;
    await db.execute({
      sql: `INSERT INTO ea_accounts (id, user_id, type, email, label, color, credentials_encrypted, sort_order)
            VALUES (?, ?, 'icloud', ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              credentials_encrypted = excluded.credentials_encrypted, label = excluded.label,
              color = excluded.color, updated_at = datetime('now')`,
      args: [
        accountId,
        userId,
        email,
        label || email,
        color || "#a259ff",
        encrypt(password),
        nextSort,
      ],
    });
    await queueEmailIndexBackfill(userId);
    wakeEmailBackfillWorker();
    res.json({ id: accountId, email, label: label || email });
  } catch (err) {
    console.error("Error adding iCloud account:", err);
    res.status(400).json({ message: err.message });
  }
});

router.post("/accounts/test/:id", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const { id } = req.params;
  try {
    const result = await db.execute({
      sql: "SELECT * FROM ea_accounts WHERE id = ? AND user_id = ?",
      args: [id, userId],
    });
    if (!result.rows.length)
      return res.status(404).json({ message: "Account not found" });
    const account = result.rows[0];
    if (account.type === "gmail") await testGmail(account);
    else if (account.type === "icloud")
      await testIcloud(account.email, decrypt(account.credentials_encrypted));
    res.json({ success: true });
  } catch (err) {
    console.error("Error testing account:", err);
    res.status(400).json({ message: err.message });
  }
});

router.patch("/accounts/reorder", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const { order } = req.body; // array of account IDs in desired order
  if (!Array.isArray(order) || !order.length)
    return res.status(400).json({ message: "order array required" });
  try {
    const stmts = order.map((id, i) => ({
      sql: "UPDATE ea_accounts SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      args: [i, id, userId],
    }));
    await db.batch(stmts);
    res.json({ success: true });
  } catch (err) {
    console.error("Error reordering accounts:", err);
    res.status(500).json({ message: "Failed to reorder accounts" });
  }
});

router.patch("/accounts/:id", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const { id } = req.params;
  const { calendar_enabled, label, color, icon } = req.body;

  // input validation
  if (label !== undefined && (typeof label !== "string" || label.length > 50)) {
    return res.status(400).json({ message: "Label must be a string under 50 characters" });
  }
  if (color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return res.status(400).json({ message: "Color must be a valid hex color (e.g. #ff5500)" });
  }
  if (icon !== undefined && icon !== null && (typeof icon !== "string" || icon.length > 50)) {
    return res.status(400).json({ message: "Icon must be a string under 50 characters or null" });
  }

  try {
    const updates = [];
    const args = [];
    if (calendar_enabled !== undefined) {
      updates.push("calendar_enabled = ?");
      args.push(calendar_enabled ? 1 : 0);
    }
    if (label !== undefined) {
      updates.push("label = ?");
      args.push(label);
    }
    if (color !== undefined) {
      updates.push("color = ?");
      args.push(color);
    }
    if (icon !== undefined) {
      updates.push("icon = ?");
      args.push(icon || null);
    }
    if (updates.length) {
      updates.push("updated_at = datetime('now')");
      args.push(id, userId);
      await db.execute({
        sql: `UPDATE ea_accounts SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
        args,
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error updating account:", err);
    res.status(500).json({ message: "Failed to update account" });
  }
});

router.delete("/accounts/:id", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const { id } = req.params;
  try {
    const result = await db.execute({
      sql: "DELETE FROM ea_accounts WHERE id = ? AND user_id = ?",
      args: [id, userId],
    });
    if (result.rowsAffected === 0)
      return res.status(404).json({ message: "Account not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting account:", err);
    res.status(500).json({ message: "Failed to delete account" });
  }
});

// Settings + reminders share the /api/ea mount; composed here so
// requireCookieSession above runs exactly once per request.
router.use(settingsRoutes);
router.use(remindersRoutes);

export default router;
