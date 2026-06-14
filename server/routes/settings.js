import { Router } from "express";
import db from "../db/connection.js";
import { encrypt } from "../platform/encryption.js";
import { geocodeLocation } from "../platform/weather.js";
import { initScheduler } from "../scheduler.js";
import {
  billExtractAvailability,
  isAllowedBillExtractModel,
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
} from "../bills/bill-extractors/catalog.js";
import {
  emailAiModelAvailability,
  isAllowedEmailAiModel,
  resolveEmailAiModelConfig,
} from "../email/email-ai-models.js";
import {
  getEmailTriageModeForUser,
  isAllowedStoredEmailTriageMode,
  normalizeStoredEmailTriageMode,
} from "../triage/triage-mode.js";
import {
  parseTriageSoundSettingsJson,
  TRIAGE_NOTIFICATION_SOUNDS,
  validateTriageSoundSettings,
} from "../triage/triage-sound-settings.js";
import {
  parseBillPayMappingsJson,
  validateBillPayMappings,
} from "../bills/bill-pay-mappings.js";
import { getTriageCacheStats } from "../triage/triage-cache-stats.js";
import { storeTodoistOAuthTokenResponse } from "../tasks/todoist-token.js";
import {
  validateEmailInterests,
  validateImportantSenders,
  validateSchedules,
} from "../platform/settings-schemas.js";

// Bare router: mounted behind requireCookieSession in routes/accounts.js.
const router = Router();

router.get("/geocode", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ message: "q parameter required" });
  try {
    res.json(await geocodeLocation(q));
  } catch (err) {
    // P3-54: do not leak raw err.message to the client; keep detail in the log
    // only, matching the other /settings handlers in this file.
    console.error("Error geocoding location:", err.message);
    res.status(400).json({ message: "Failed to geocode location" });
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
      todoist_oauth_refresh_token_encrypted,
      discord_webhook_url_encrypted,
      schedules_json,
      email_interests_json,
      triage_sound_settings_json,
      bill_pay_mappings_json,
      ...safe
    } = result.rows[0];
    safe.actual_budget_configured = !!actual_budget_password_encrypted;
    safe.todoist_configured = !!todoist_api_token_encrypted;
    safe.todoist_oauth_configured = !!(todoist_api_token_encrypted && todoist_oauth_refresh_token_encrypted);
    safe.discord_webhook_configured = !!discord_webhook_url_encrypted;
    safe.schedules = schedules_json
      ? JSON.parse(schedules_json)
      : [
          { label: "Morning Briefing", time: "08:00", enabled: false },
          { label: "Evening Briefing", time: "20:00", enabled: false },
        ];
    safe.email_interests = email_interests_json
      ? JSON.parse(email_interests_json)
      : [];

    const emailAiModel = resolveEmailAiModelConfig({
      provider: safe.email_ai_provider,
      model: safe.email_ai_model,
    });
    safe.email_ai_provider = emailAiModel.provider;
    safe.email_ai_model = emailAiModel.model;
    safe.bill_extract_provider = safe.bill_extract_provider || DEFAULT_BILL_EXTRACT_PROVIDER;
    safe.bill_extract_model = safe.bill_extract_model || DEFAULT_BILL_EXTRACT_MODEL;
    const triageMode = await getEmailTriageModeForUser(userId);
    safe.email_triage_mode = normalizeStoredEmailTriageMode(safe.email_triage_mode);
    safe.email_triage_effective_mode = triageMode.effective_email_triage_mode;
    safe.triage_sound_settings = parseTriageSoundSettingsJson(triage_sound_settings_json);
    safe.triage_notification_sounds = TRIAGE_NOTIFICATION_SOUNDS;
    safe.bill_pay_mappings = parseBillPayMappingsJson(bill_pay_mappings_json);

    res.json(safe);
  } catch (err) {
    console.error("Error fetching EA settings:", err);
    res.status(500).json({ message: "Failed to fetch settings" });
  }
});

router.get("/triage/cache-stats", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  try {
    res.json(await getTriageCacheStats(userId, {
      includeSemanticSearch: req.query.semantic === "1",
    }));
  } catch (err) {
    console.error("Error fetching triage cache stats:", err.message);
    res.status(500).json({ message: "Failed to fetch triage cache stats" });
  }
});

router.put("/settings", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const { schedules_json, email_lookback_hours, weather_lat, weather_lng, weather_location, actual_budget_url, actual_budget_password, actual_budget_sync_id, email_ai_provider, email_ai_model, email_interests_json, todoist_api_token, todoist_oauth_token_response, bill_extract_provider, bill_extract_model, email_triage_mode, triage_sound_settings, bill_pay_mappings, discord_webhook_url, discord_user_id } = req.body;

  try {
    if (todoist_api_token !== undefined && todoist_oauth_token_response !== undefined) {
      return res.status(400).json({ message: "Provide either todoist_api_token or todoist_oauth_token_response, not both" });
    }
    await db.execute({ sql: "INSERT OR IGNORE INTO ea_settings (user_id) VALUES (?)", args: [userId] });
    const updates = [];
    const args = [];

    if (schedules_json !== undefined) {
      const validation = validateSchedules(schedules_json);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.message });
      }
      updates.push("schedules_json = ?");
      args.push(JSON.stringify(validation.value));
    }
    // Minimal type/range coercion at the write boundary for the scalar settings
    // fields (hours/coords/url/sync_id), 400 on failure, mirroring the
    // JSON/model-field validation already in this handler.
    if (email_lookback_hours !== undefined) {
      if (!Number.isInteger(email_lookback_hours) || email_lookback_hours < 1 || email_lookback_hours > 168) {
        return res.status(400).json({ message: "email_lookback_hours must be an integer between 1 and 168" });
      }
      updates.push("email_lookback_hours = ?"); args.push(email_lookback_hours);
    }
    if (weather_lat !== undefined) {
      if (typeof weather_lat !== "number" || !Number.isFinite(weather_lat) || weather_lat < -90 || weather_lat > 90) {
        return res.status(400).json({ message: "weather_lat must be a number between -90 and 90" });
      }
      updates.push("weather_lat = ?"); args.push(weather_lat);
    }
    if (weather_lng !== undefined) {
      if (typeof weather_lng !== "number" || !Number.isFinite(weather_lng) || weather_lng < -180 || weather_lng > 180) {
        return res.status(400).json({ message: "weather_lng must be a number between -180 and 180" });
      }
      updates.push("weather_lng = ?"); args.push(weather_lng);
    }
    if (weather_location !== undefined) { updates.push("weather_location = ?"); args.push(weather_location); }
    if (actual_budget_url !== undefined) {
      if (typeof actual_budget_url !== "string") {
        return res.status(400).json({ message: "actual_budget_url must be a string" });
      }
      updates.push("actual_budget_url = ?"); args.push(actual_budget_url);
    }
    if (actual_budget_password !== undefined) { updates.push("actual_budget_password_encrypted = ?"); args.push(actual_budget_password ? encrypt(actual_budget_password) : null); }
    if (actual_budget_sync_id !== undefined) {
      if (typeof actual_budget_sync_id !== "string") {
        return res.status(400).json({ message: "actual_budget_sync_id must be a string" });
      }
      updates.push("actual_budget_sync_id = ?"); args.push(actual_budget_sync_id);
    }
    if (email_ai_provider !== undefined || email_ai_model !== undefined) {
      const resolved = resolveEmailAiModelConfig({
        provider: email_ai_provider,
        model: email_ai_model,
      });
      if (!isAllowedEmailAiModel(resolved.provider, resolved.model)) {
        return res.status(400).json({ message: "Invalid email_ai_provider/model combination" });
      }
      updates.push("email_ai_provider = ?");
      args.push(resolved.provider);
      updates.push("email_ai_model = ?");
      args.push(resolved.model);
    }
    if (email_interests_json !== undefined) {
      const validation = validateEmailInterests(email_interests_json);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.message });
      }
      updates.push("email_interests_json = ?");
      args.push(JSON.stringify(validation.value));
    }
    if (todoist_api_token !== undefined) {
      updates.push("todoist_api_token_encrypted = ?");
      args.push(todoist_api_token ? encrypt(todoist_api_token) : null);
      updates.push("todoist_oauth_refresh_token_encrypted = NULL");
      updates.push("todoist_oauth_access_token_expires_at = NULL");
      updates.push("todoist_oauth_scope = NULL");
      updates.push("todoist_oauth_token_type = NULL");
    }
    if (email_triage_mode !== undefined) {
      if (!isAllowedStoredEmailTriageMode(email_triage_mode)) {
        return res.status(400).json({ message: "Invalid email_triage_mode" });
      }
      updates.push("email_triage_mode = ?");
      args.push(email_triage_mode);
    }
    if (triage_sound_settings !== undefined) {
      const validation = validateTriageSoundSettings(triage_sound_settings);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.message });
      }
      updates.push("triage_sound_settings_json = ?");
      args.push(JSON.stringify(triage_sound_settings));
    }
    if (bill_pay_mappings !== undefined) {
      const validation = validateBillPayMappings(bill_pay_mappings);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.message });
      }
      updates.push("bill_pay_mappings_json = ?");
      args.push(JSON.stringify(bill_pay_mappings));
    }
    if (discord_webhook_url !== undefined) {
      const trimmedWebhook = String(discord_webhook_url || "").trim();
      updates.push("discord_webhook_url_encrypted = ?");
      args.push(trimmedWebhook ? encrypt(trimmedWebhook) : null);
    }
    if (discord_user_id !== undefined) {
      const trimmedUserId = String(discord_user_id || "").trim();
      updates.push("discord_user_id = ?");
      args.push(trimmedUserId || null);
    }
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
    if (todoist_oauth_token_response !== undefined) {
      const response = typeof todoist_oauth_token_response === "string"
        ? JSON.parse(todoist_oauth_token_response)
        : todoist_oauth_token_response;
      await storeTodoistOAuthTokenResponse(userId, response);
    }

    // Purge completed-task snapshots on disconnect. Current runtime reads domain data.
    if (todoist_api_token !== undefined && !todoist_api_token) {
      await db.execute({
        sql: "DELETE FROM ea_completed_tasks WHERE user_id = ?",
        args: [userId],
      });
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

router.get("/models", async (_req, res) => {
  try {
    res.json(emailAiModelAvailability());
  } catch (err) {
    // P3-54: fixed user-facing string; raw err.message stays in the log only.
    console.error("Error fetching models:", err.message);
    res.status(500).json({ message: "Failed to fetch models" });
  }
});

router.get("/bill-extract-models", async (_req, res) => {
  try {
    res.json(billExtractAvailability());
  } catch (err) {
    // P3-54: fixed user-facing string; raw err.message stays in the log only.
    console.error("Error fetching bill-extract catalog:", err.message);
    res.status(500).json({ message: "Failed to fetch bill-extract models" });
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
    // P3-54: fixed user-facing string; raw err.message stays in the log only.
    console.error("Error fetching important senders:", err.message);
    res.status(500).json({ message: "Failed to fetch important senders" });
  }
});

router.put("/important-senders", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const { senders } = req.body;
  const validation = validateImportantSenders(senders);
  if (!validation.valid) {
    return res.status(400).json({ message: validation.message });
  }
  try {
    await db.execute({
      sql: "UPDATE ea_settings SET important_senders_json = ? WHERE user_id = ?",
      args: [JSON.stringify(senders), userId],
    });
    res.json({ success: true });
  } catch (err) {
    // P3-54: fixed user-facing string; raw err.message stays in the log only.
    console.error("Error updating important senders:", err.message);
    res.status(500).json({ message: "Failed to update important senders" });
  }
});

export default router;
