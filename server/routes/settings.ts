import { Router } from "express";
import type { RequestHandler } from "express";
import type { Value } from "@libsql/client";
import db from "../db/connection.ts";
import { encrypt } from "../platform/encryption.ts";
import { settingsCredentialContext } from "../platform/credential-encryption-context.ts";
import { geocodeLocation } from "../platform/weather.ts";
import { initScheduler } from "../scheduler.ts";
import { requestEmailTriageDrainAt } from "../scheduler-email-triage-drain.ts";
import {
  billExtractAvailability,
  isAllowedBillExtractModel,
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
  resolveBillExtractModelConfig,
} from "../bills/bill-extractors/catalog.ts";
import {
  emailAiModelAvailability,
  isAllowedEmailAiModel,
  resolveEmailAiModelConfig,
} from "../email/email-ai-models.ts";
import {
  alfredModelAvailability,
  isAllowedAlfredModel,
  resolveAlfredModelConfig,
} from "../alfred/alfred-models.ts";
import {
  getEmailTriageModeForUser,
  isAllowedStoredEmailTriageMode,
  normalizeStoredEmailTriageMode,
} from "../triage/triage-mode.ts";
import {
  parseTriageSoundSettingsJson,
  TRIAGE_NOTIFICATION_SOUNDS,
  validateTriageSoundSettings,
} from "../triage/triage-sound-settings.ts";
import { getTriageCacheStats } from "../triage/triage-cache-stats.ts";
import { getEmailSearchCostStats } from "../email/search/email-search-cost-stats.ts";
import { storeTodoistOAuthTokenResponse } from "../tasks/todoist-token.ts";
import { clearTodoistNeedsReauth } from "../platform/provider-reauth.ts";
import { requireRecentPasswordAuth } from "../middleware/auth.ts";
import { scheduleTimeToLeaveRefreshForUser } from "../reminders/reminder-service.ts";
import {
  validateDiscordWebhookUrl,
  validateEmailInterests,
  validateHomeLocation,
  validateImportantSenders,
  validateSchedules,
  validateUtilityPayLinks,
} from "../platform/settings-schemas.ts";
import type {
  BriefingSchedule,
  GeocodeResult,
  ImportantSender,
  ProviderModelAvailability,
  ScheduleSkipRequest,
  ScheduleSkipResponse,
  SettingsMutationResponse,
  SettingsPatchRequest,
  SettingsResponse,
} from "../../shared/types/settings.ts";

type ErrorResponse = { message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Bare router: mounted behind requireCookieSession in routes/accounts.ts.
const router = Router();

const requireRecentAuthForSecretSettings: RequestHandler = (req, res, next) => {
  if (req.body?.discord_webhook_url === undefined) return next();
  return requireRecentPasswordAuth(req, res, next);
};

// GET /settings response allowlist (SEC-06): every ea_settings column NOT
// listed here is withheld from the client by default, including secrets
// (*_encrypted, *_token*) and columns the client doesn't consume today
// (important_senders_json has its own route; news_last_seen_at is News-only;
// the Todoist OAuth bookkeeping columns are server-internal). Adding a new
// public field requires an explicit, reviewed addition here.
const SETTINGS_PUBLIC_FIELDS = [
  "user_id",
  "email_lookback_hours",
  "home_location_label",
  "home_location_address",
  "home_location_place_id",
  "home_location_lat",
  "home_location_lng",
  "weather_lat",
  "weather_lng",
  "weather_location",
  "actual_budget_url",
  "actual_budget_sync_id",
  "email_ai_provider",
  "email_ai_model",
  "alfred_provider",
  "alfred_model",
  "bill_extract_provider",
  "bill_extract_model",
  "email_triage_mode",
  "email_triage_classify_read_arrivals",
  "discord_user_id",
  "todoist_needs_reauth",
  "todoist_connection_mode",
];

router.get<Record<string, never>, GeocodeResult[] | ErrorResponse, never, { q?: string }>("/geocode", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ message: "q parameter required" });
  try {
    res.json(await geocodeLocation(q));
  } catch (err) {
    // P3-54: do not leak raw error message to the client; keep detail in the log
    // only, matching the other /settings handlers in this file.
    console.error("Error geocoding location:", errorMessage(err));
    res.status(400).json({ message: "Failed to geocode location" });
  }
});

router.get<Record<string, never>, SettingsResponse | ErrorResponse>("/settings", async (_req, res) => {
  const userId = process.env.EA_USER_ID!;
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
    const row = result.rows[0]!;
    const {
      actual_budget_password_encrypted,
      todoist_api_token_encrypted,
      todoist_oauth_refresh_token_encrypted,
      discord_webhook_url_encrypted,
      schedules_json,
      email_interests_json,
      triage_sound_settings_json,
      utility_pay_links_json,
    } = row;
    const safe: Record<string, unknown> = Object.fromEntries(
      SETTINGS_PUBLIC_FIELDS.map((key) => [key, row[key]]),
    );
    safe.actual_budget_configured = !!actual_budget_password_encrypted;
    safe.todoist_configured = !!todoist_api_token_encrypted;
    safe.todoist_needs_reauth = !!safe.todoist_needs_reauth;
    safe.todoist_connection_mode = safe.todoist_connection_mode
      || (todoist_api_token_encrypted
        ? todoist_oauth_refresh_token_encrypted ? "oauth" : "personal_token"
        : "disconnected");
    safe.todoist_oauth_configured = !!(
      todoist_api_token_encrypted && safe.todoist_connection_mode === "oauth"
    );
    safe.discord_webhook_configured = !!discord_webhook_url_encrypted;
    safe.schedules = schedules_json
      ? JSON.parse(String(schedules_json))
      : [
          { label: "Morning Briefing", time: "08:00", enabled: false },
          { label: "Evening Briefing", time: "20:00", enabled: false },
        ];
    safe.email_interests = email_interests_json
      ? JSON.parse(String(email_interests_json))
      : [];

    const emailAiModel = resolveEmailAiModelConfig({
      provider: safe.email_ai_provider,
      model: safe.email_ai_model,
    });
    safe.email_ai_provider = emailAiModel.provider;
    safe.email_ai_model = emailAiModel.model;
    const alfredModel = resolveAlfredModelConfig({
      provider: safe.alfred_provider,
      model: safe.alfred_model,
    });
    safe.alfred_provider = alfredModel.provider;
    safe.alfred_model = alfredModel.model;
    const billExtractModel = resolveBillExtractModelConfig({
      provider: safe.bill_extract_provider,
      model: safe.bill_extract_model,
    });
    safe.bill_extract_provider = billExtractModel.provider;
    safe.bill_extract_model = billExtractModel.model;
    const triageMode = await getEmailTriageModeForUser(userId);
    safe.email_triage_mode = normalizeStoredEmailTriageMode(safe.email_triage_mode);
    safe.email_triage_effective_mode = triageMode.effective_email_triage_mode;
    safe.email_triage_classify_read_arrivals = !!safe.email_triage_classify_read_arrivals;
    safe.triage_sound_settings = parseTriageSoundSettingsJson(triage_sound_settings_json);
    safe.triage_notification_sounds = TRIAGE_NOTIFICATION_SOUNDS;
    safe.utility_pay_links = utility_pay_links_json ? JSON.parse(String(utility_pay_links_json)) : [];

    res.json(safe as unknown as SettingsResponse);
  } catch (err) {
    console.error("Error fetching EA settings:", err);
    res.status(500).json({ message: "Failed to fetch settings" });
  }
});

router.get("/triage/cache-stats", async (_req, res) => {
  const userId = process.env.EA_USER_ID!;
  try {
    res.json(await getTriageCacheStats(userId));
  } catch (err) {
    console.error("Error fetching triage cache stats:", errorMessage(err));
    res.status(500).json({ message: "Failed to fetch triage cache stats" });
  }
});

router.get("/email-search/usage", async (_req, res) => {
  const userId = process.env.EA_USER_ID!;
  try {
    res.json(await getEmailSearchCostStats(userId));
  } catch (err) {
    console.error("Error fetching email search usage:", errorMessage(err));
    res.status(500).json({ message: "Failed to fetch email search usage" });
  }
});

router.put<Record<string, never>, SettingsMutationResponse | ErrorResponse, SettingsPatchRequest>("/settings", requireRecentAuthForSecretSettings, async (req, res) => {
  const userId = process.env.EA_USER_ID!;
  const { schedules_json, email_lookback_hours, home_location_label, home_location_address, home_location_place_id, home_location_lat, home_location_lng, weather_lat, weather_lng, weather_location, actual_budget_url, actual_budget_password, actual_budget_sync_id, email_ai_provider, email_ai_model, alfred_provider, alfred_model, email_interests_json, todoist_api_token, todoist_oauth_token_response, bill_extract_provider, bill_extract_model, email_triage_mode, email_triage_classify_read_arrivals, triage_sound_settings, discord_webhook_url, discord_user_id, utility_pay_links } = req.body;

  try {
    if (actual_budget_url !== undefined || actual_budget_password !== undefined || actual_budget_sync_id !== undefined) {
      return res.status(400).json({ message: "Use the Actual Budget Save & verify connection endpoint" });
    }
    if (todoist_api_token !== undefined) {
      return res.status(400).json({ message: "Use the Todoist Save & verify connection endpoint" });
    }
    await db.execute({ sql: "INSERT OR IGNORE INTO ea_settings (user_id) VALUES (?)", args: [userId] });
    const updates: string[] = [];
    const args: Value[] = [];
    let homeMutationAvailable: boolean | null = null;

    if (schedules_json !== undefined) {
      const validation = validateSchedules(schedules_json);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.message! });
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
    if (
      home_location_label !== undefined
      || home_location_address !== undefined
      || home_location_place_id !== undefined
      || home_location_lat !== undefined
      || home_location_lng !== undefined
    ) {
      const validation = validateHomeLocation({
        home_location_label,
        home_location_address,
        home_location_place_id,
        home_location_lat,
        home_location_lng,
      });
      if (!validation.valid) {
        return res.status(400).json({ message: validation.message! });
      }
      const home = validation.value!;
      homeMutationAvailable = home.home_location_address !== null;
      updates.push(
        "home_location_label = ?",
        "home_location_address = ?",
        "home_location_place_id = ?",
        "home_location_lat = ?",
        "home_location_lng = ?",
      );
      args.push(
        home.home_location_label,
        home.home_location_address,
        home.home_location_place_id,
        home.home_location_lat,
        home.home_location_lng,
      );
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
        return res.status(400).json({ message: validation.message! });
      }
      updates.push("email_interests_json = ?");
      args.push(JSON.stringify(validation.value));
    }
    if (alfred_provider !== undefined || alfred_model !== undefined) {
      const resolved = resolveAlfredModelConfig({
        provider: alfred_provider,
        model: alfred_model,
      });
      if (!isAllowedAlfredModel(resolved.provider, resolved.model)) {
        return res.status(400).json({ message: "Invalid alfred_provider/model combination" });
      }
      updates.push("alfred_provider = ?");
      args.push(resolved.provider);
      updates.push("alfred_model = ?");
      args.push(resolved.model);
    }
    if (email_triage_mode !== undefined) {
      if (!isAllowedStoredEmailTriageMode(email_triage_mode)) {
        return res.status(400).json({ message: "Invalid email_triage_mode" });
      }
      updates.push("email_triage_mode = ?");
      args.push(email_triage_mode);
    }
    if (email_triage_classify_read_arrivals !== undefined) {
      if (typeof email_triage_classify_read_arrivals !== "boolean") {
        return res.status(400).json({ message: "email_triage_classify_read_arrivals must be a boolean" });
      }
      updates.push("email_triage_classify_read_arrivals = ?");
      args.push(email_triage_classify_read_arrivals ? 1 : 0);
    }
    if (triage_sound_settings !== undefined) {
      const validation = validateTriageSoundSettings(triage_sound_settings);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.message! });
      }
      updates.push("triage_sound_settings_json = ?");
      args.push(JSON.stringify(triage_sound_settings));
    }
    if (utility_pay_links !== undefined) {
      const validation = validateUtilityPayLinks(utility_pay_links);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.message! });
      }
      updates.push("utility_pay_links_json = ?");
      args.push(JSON.stringify(validation.value));
    }
    if (discord_webhook_url !== undefined) {
      const validation = validateDiscordWebhookUrl(discord_webhook_url);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.message! });
      }
      updates.push("discord_webhook_url_encrypted = ?");
      args.push(validation.value
        ? encrypt(
            validation.value,
            settingsCredentialContext(userId, "discord_webhook_url_encrypted"),
          )
        : null);
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
    if (homeMutationAvailable !== null) {
      await scheduleTimeToLeaveRefreshForUser({
        userId,
        homeAvailable: homeMutationAvailable,
      });
    }
    if (email_triage_mode !== undefined && email_triage_mode !== "paused") {
      requestEmailTriageDrainAt(Date.now());
    }
    if (todoist_oauth_token_response !== undefined) {
      const response = typeof todoist_oauth_token_response === "string"
        ? JSON.parse(todoist_oauth_token_response)
        : todoist_oauth_token_response;
      await storeTodoistOAuthTokenResponse(userId, response);
      try {
        await clearTodoistNeedsReauth(userId);
      } catch (clearErr) {
        console.error("[Settings] Failed to clear todoist_needs_reauth:", errorMessage(clearErr));
      }
    }

    if (discord_webhook_url !== undefined || discord_user_id !== undefined) {
      const { capabilityStatusService } = await import("../capability-status-service.ts");
      capabilityStatusService.invalidate();
    }

    // Hot-reload cron jobs when schedules change (no server restart needed)
    if (schedules_json !== undefined) {
      initScheduler().catch(err => console.error("[EA Scheduler] Re-init failed:", errorMessage(err)));
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error updating EA settings:", err);
    res.status(500).json({ message: "Failed to update settings" });
  }
});

router.post<Record<string, never>, ScheduleSkipResponse | ErrorResponse, ScheduleSkipRequest>("/schedules/skip", async (req, res) => {
  const userId = process.env.EA_USER_ID!;
  const { index, skip } = req.body;
  if (index === undefined) return res.status(400).json({ message: "index is required" });

  try {
    const result = await db.execute({ sql: "SELECT schedules_json FROM ea_settings WHERE user_id = ?", args: [userId] });
    const schedules = JSON.parse(String(result.rows[0]?.schedules_json || "[]")) as BriefingSchedule[];
    if (index < 0 || index >= schedules.length) return res.status(400).json({ message: "Invalid schedule index" });
    const schedule = schedules[index]!;

    if (skip === false) {
      delete schedule.skipped_until;
    } else {
      // Skip until midnight tomorrow in the schedule's timezone, stored as UTC
      const tz = schedule.tz || "America/Los_Angeles";
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
      schedule.skipped_until = midnightUtc.toISOString();
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

router.get<Record<string, never>, ProviderModelAvailability[] | ErrorResponse>("/models", async (_req, res) => {
  try {
    res.json(await emailAiModelAvailability());
  } catch (err) {
    // P3-54: fixed user-facing string; raw error message stays in the log only.
    console.error("Error fetching models:", errorMessage(err));
    res.status(500).json({ message: "Failed to fetch models" });
  }
});

router.get<Record<string, never>, ProviderModelAvailability[] | ErrorResponse>("/bill-extract-models", async (_req, res) => {
  try {
    res.json(await billExtractAvailability());
  } catch (err) {
    // P3-54: fixed user-facing string; raw error message stays in the log only.
    console.error("Error fetching bill-extract catalog:", errorMessage(err));
    res.status(500).json({ message: "Failed to fetch bill-extract models" });
  }
});

router.get<Record<string, never>, ProviderModelAvailability[] | ErrorResponse>("/alfred-models", async (_req, res) => {
  try {
    res.json(await alfredModelAvailability());
  } catch (err) {
    console.error("Error fetching Alfred model catalog:", errorMessage(err));
    res.status(500).json({ message: "Failed to fetch Alfred models" });
  }
});

// --- Important Senders ---

router.get<Record<string, never>, ImportantSender[] | ErrorResponse>("/important-senders", async (_req, res) => {
  const userId = process.env.EA_USER_ID!;
  try {
    const result = await db.execute({
      sql: "SELECT important_senders_json FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    const raw = result.rows[0]?.important_senders_json || "[]";
    res.json(JSON.parse(String(raw)) as ImportantSender[]);
  } catch (err) {
    // P3-54: fixed user-facing string; raw error message stays in the log only.
    console.error("Error fetching important senders:", errorMessage(err));
    res.status(500).json({ message: "Failed to fetch important senders" });
  }
});

router.put<Record<string, never>, SettingsMutationResponse | ErrorResponse, { senders: ImportantSender[] }>("/important-senders", async (req, res) => {
  const userId = process.env.EA_USER_ID!;
  const { senders } = req.body;
  const validation = validateImportantSenders(senders);
  if (!validation.valid) {
    return res.status(400).json({ message: validation.message! });
  }
  try {
    await db.execute({
      sql: "UPDATE ea_settings SET important_senders_json = ? WHERE user_id = ?",
      args: [JSON.stringify(senders), userId],
    });
    res.json({ success: true });
  } catch (err) {
    // P3-54: fixed user-facing string; raw error message stays in the log only.
    console.error("Error updating important senders:", errorMessage(err));
    res.status(500).json({ message: "Failed to update important senders" });
  }
});

export default router;
