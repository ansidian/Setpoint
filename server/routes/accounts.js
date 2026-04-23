import { Router } from "express";
import crypto from "crypto";
import db from "../db/connection.js";
import { hashToken, requireCookieSession } from "../middleware/auth.js";
import { encrypt, decrypt } from "../briefing/encryption.js";
import { getAuthUrl, handleCallback, testConnection as testGmail } from "../briefing/gmail.js";
import { testConnection as testIcloud } from "../briefing/icloud.js";
import { geocodeLocation } from "../briefing/weather.js";
import { listModels } from "../briefing/claude.js";
import { initScheduler } from "../briefing/scheduler.js";
import { isEmbeddingAvailable } from "../embeddings/index.js";
import {
  billExtractAvailability,
  isAllowedBillExtractModel,
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
} from "../briefing/bill-extractors/catalog.js";
import { canonicalizeConfiguredAccounts } from "../briefing/account-canonical.js";

const router = Router();
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
    const baseUrl = process.env.NODE_ENV === "production" ? "" : "http://localhost:5173";
    res.redirect(`${baseUrl}/settings?account_connected=${result.email}`);
  } catch (err) {
    console.error("Gmail OAuth callback error:", err);
    res.status(500).send(`OAuth failed: ${err.message}`);
  }
});

// All other routes require auth
router.use(requireCookieSession);

router.post("/suspend", async (req, res) => {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) {
    return res.status(400).json({ message: "Render API not configured" });
  }
  res.json({ ok: true });
  setTimeout(async () => {
    try {
      const resp = await fetch(
        `https://api.render.com/v1/services/${serviceId}/suspend`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `${apiKey}`,
          },
        },
      );
      if (!resp.ok)
        console.error(
          "[EA] Render suspend HTTP",
          resp.status,
          await resp.text().catch(() => ""),
        );
      else console.log("[EA] Render service suspended");
    } catch (err) {
      console.error("[EA] Render suspend failed:", err.message);
    }
  }, 2000);
});

router.get("/accounts", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  try {
    const result = await db.execute({
      sql: "SELECT id, type, email, label, color, icon, calendar_enabled, sort_order, created_at FROM ea_accounts WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC",
      args: [userId],
    });
    res.json(canonicalizeConfiguredAccounts(result.rows));
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

router.get("/geocode", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ message: "q parameter required" });
  try {
    res.json(await geocodeLocation(q));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/settings", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  try {
    let result = await db.execute({
      sql: "SELECT * FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    if (!result.rows.length) {
      await db.execute({
        sql: "INSERT INTO ea_settings (user_id) VALUES (?)",
        args: [userId],
      });
      result = await db.execute({
        sql: "SELECT * FROM ea_settings WHERE user_id = ?",
        args: [userId],
      });
    }
    const {
      actual_budget_password_encrypted,
      todoist_api_token_encrypted,
      schedules_json,
      email_interests_json,
      ...safe
    } = result.rows[0];
    safe.actual_budget_configured = !!actual_budget_password_encrypted;
    safe.todoist_configured = !!todoist_api_token_encrypted;
    safe.schedules = schedules_json
      ? JSON.parse(schedules_json)
      : [
          { label: "Morning Briefing", time: "08:00", enabled: false },
          { label: "Evening Briefing", time: "20:00", enabled: false },
        ];
    safe.email_interests = email_interests_json
      ? JSON.parse(email_interests_json)
      : [];

    safe.bill_extract_provider = safe.bill_extract_provider || DEFAULT_BILL_EXTRACT_PROVIDER;
    safe.bill_extract_model = safe.bill_extract_model || DEFAULT_BILL_EXTRACT_MODEL;

    // Render suspend availability
    safe.render_configured =
      !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID) ||
      process.env.NODE_ENV !== "production";

    // Embedding/RAG status
    safe.openai_available = isEmbeddingAvailable();
    try {
      const countResult = await db.execute({
        sql: "SELECT COUNT(*) as count FROM ea_embeddings WHERE user_id = ?",
        args: [userId],
      });
      safe.embedding_count = countResult.rows[0].count;
    } catch {
      safe.embedding_count = 0;
    }

    res.json(safe);
  } catch (err) {
    console.error("Error fetching EA settings:", err);
    res.status(500).json({ message: "Failed to fetch settings" });
  }
});

router.put("/settings", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const { schedules_json, email_lookback_hours, weather_lat, weather_lng, weather_location, actual_budget_url, actual_budget_password, actual_budget_sync_id, claude_model, email_interests_json, todoist_api_token, bill_extract_provider, bill_extract_model } = req.body;

  try {
    await db.execute({ sql: "INSERT OR IGNORE INTO ea_settings (user_id) VALUES (?)", args: [userId] });
    const updates = [];
    const args = [];

    if (schedules_json !== undefined) { updates.push("schedules_json = ?"); args.push(typeof schedules_json === "string" ? schedules_json : JSON.stringify(schedules_json)); }
    if (email_lookback_hours !== undefined) { updates.push("email_lookback_hours = ?"); args.push(email_lookback_hours); }
    if (weather_lat !== undefined) { updates.push("weather_lat = ?"); args.push(weather_lat); }
    if (weather_lng !== undefined) { updates.push("weather_lng = ?"); args.push(weather_lng); }
    if (weather_location !== undefined) { updates.push("weather_location = ?"); args.push(weather_location); }
    if (actual_budget_url !== undefined) { updates.push("actual_budget_url = ?"); args.push(actual_budget_url); }
    if (actual_budget_password !== undefined) { updates.push("actual_budget_password_encrypted = ?"); args.push(actual_budget_password ? encrypt(actual_budget_password) : null); }
    if (actual_budget_sync_id !== undefined) { updates.push("actual_budget_sync_id = ?"); args.push(actual_budget_sync_id); }
    if (claude_model !== undefined) { updates.push("claude_model = ?"); args.push(claude_model || null); }
    if (email_interests_json !== undefined) { updates.push("email_interests_json = ?"); args.push(typeof email_interests_json === "string" ? email_interests_json : JSON.stringify(email_interests_json)); }
    if (todoist_api_token !== undefined) { updates.push("todoist_api_token_encrypted = ?"); args.push(todoist_api_token ? encrypt(todoist_api_token) : null); }
    if (bill_extract_provider !== undefined || bill_extract_model !== undefined) {
      const provider = bill_extract_provider ?? DEFAULT_BILL_EXTRACT_PROVIDER;
      const model = bill_extract_model ?? DEFAULT_BILL_EXTRACT_MODEL;
      if (!isAllowedBillExtractModel(provider, model)) {
        return res.status(400).json({ message: "Invalid bill_extract_provider/model combination" });
      }
      if (bill_extract_provider !== undefined) { updates.push("bill_extract_provider = ?"); args.push(provider); }
      if (bill_extract_model !== undefined) { updates.push("bill_extract_model = ?"); args.push(model); }
    }

    if (updates.length > 0) {
      args.push(userId);
      await db.execute({ sql: `UPDATE ea_settings SET ${updates.join(", ")} WHERE user_id = ?`, args });
    }

    // Purge Todoist items from latest briefing and completed tasks on disconnect
    if (todoist_api_token !== undefined && !todoist_api_token) {
      await db.execute({
        sql: "DELETE FROM ea_completed_tasks WHERE user_id = ?",
        args: [userId],
      });
      const latest = await db.execute({
        sql: `SELECT id, briefing_json FROM ea_briefings
              WHERE user_id = ? AND status = 'ready'
              ORDER BY generated_at DESC LIMIT 1`,
        args: [userId],
      });
      if (latest.rows.length) {
        const briefing = JSON.parse(latest.rows[0].briefing_json);
        briefing.todoist = { upcoming: [], stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } };
        await db.execute({
          sql: "UPDATE ea_briefings SET briefing_json = ? WHERE id = ?",
          args: [JSON.stringify(briefing), latest.rows[0].id],
        });
      }
    }

    // Hot-reload cron jobs when schedules change (no server restart needed)
    if (schedules_json !== undefined) {
      initScheduler().catch(err => console.error("[EA Scheduler] Re-init failed:", err.message));
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error updating EA settings:", err);
    res.status(500).json({ message: "Failed to update settings" });
  }
});

router.post("/schedules/skip", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const { index, skip } = req.body;
  if (index === undefined) return res.status(400).json({ message: "index is required" });

  try {
    const result = await db.execute({ sql: "SELECT schedules_json FROM ea_settings WHERE user_id = ?", args: [userId] });
    const schedules = JSON.parse(result.rows[0]?.schedules_json || "[]");
    if (index < 0 || index >= schedules.length) return res.status(400).json({ message: "Invalid schedule index" });

    if (skip === false) {
      delete schedules[index].skipped_until;
    } else {
      // Skip until midnight tomorrow in the schedule's timezone, stored as UTC
      const tz = schedules[index].tz || "America/Los_Angeles";
      // Get tomorrow's date in the schedule's timezone
      const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
      const tomorrowDate = formatter.format(new Date(Date.now() + 86400000));
      // Parse midnight-tomorrow in the target timezone by finding the UTC offset
      const midnight = new Date(`${tomorrowDate}T00:00:00`);
      // Get the offset: format a known instant in the target tz, then compute the difference
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).formatToParts(midnight);
      const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
      const asLocal = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`);
      const offsetMs = midnight.getTime() - asLocal.getTime();
      const midnightUtc = new Date(midnight.getTime() + offsetMs);
      schedules[index].skipped_until = midnightUtc.toISOString();
    }

    await db.execute({
      sql: "UPDATE ea_settings SET schedules_json = ? WHERE user_id = ?",
      args: [JSON.stringify(schedules), userId],
    });

    res.json({ success: true, schedules });
  } catch (err) {
    console.error("Error toggling schedule skip:", err);
    res.status(500).json({ message: "Failed to update schedule" });
  }
});

router.get("/models", async (req, res) => {
  try {
    const models = await listModels();
    res.json(models);
  } catch (err) {
    console.error("Error fetching models:", err.message);
    res.status(500).json({ message: err.message });
  }
});

router.get("/bill-extract-models", async (_req, res) => {
  try {
    res.json(billExtractAvailability());
  } catch (err) {
    console.error("Error fetching bill-extract catalog:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// --- Important Senders ---

router.get("/important-senders", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  try {
    const result = await db.execute({
      sql: "SELECT important_senders_json FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    const raw = result.rows[0]?.important_senders_json || "[]";
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error("Error fetching important senders:", err.message);
    res.status(500).json({ message: err.message });
  }
});

router.put("/important-senders", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const { senders } = req.body;
  if (!Array.isArray(senders)) {
    return res.status(400).json({ message: "senders must be an array" });
  }
  try {
    await db.execute({
      sql: "UPDATE ea_settings SET important_senders_json = ? WHERE user_id = ?",
      args: [JSON.stringify(senders), userId],
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Error updating important senders:", err.message);
    res.status(500).json({ message: err.message });
  }
});

export default router;
