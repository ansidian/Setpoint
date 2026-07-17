import db from "../db/connection.ts";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.js";
import { decrypt } from "../platform/encryption.ts";
import { formatDiscordReminderPayload, sendDiscordWebhook } from "./discord-reminders.js";
import { computeReminderState } from "./reminder-model.js";
import {
  listDueReminders,
  markReminderDeliveryFailed,
  markReminderMissed,
  markReminderSent,
} from "./reminder-service.js";

async function loadDiscordSettings(userId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: "SELECT discord_webhook_url_encrypted, discord_user_id FROM ea_settings WHERE user_id = ?",
    args: [userId],
  });
  return result.rows[0] || null;
}

const REMINDER_BACKOFF_BASE_MS = 60_000; // 1 minute
const REMINDER_BACKOFF_CAP_MS = 60 * 60_000; // 1 hour
const MAX_REMINDER_DELIVERY_RETRIES = 6;

function retryAfterFromResult(result, now, retryCount = 0) {
  const base = new Date(now).getTime();
  // Honor a rate-limit Retry-After when present; otherwise back off exponentially
  // so a permanently-failing webhook isn't re-fired (and Discord re-hit) every 10s.
  const delayMs = result.rateLimited && result.retryAfterMs
    ? result.retryAfterMs
    : Math.min(2 ** retryCount * REMINDER_BACKOFF_BASE_MS, REMINDER_BACKOFF_CAP_MS);
  return new Date(base + delayMs).toISOString();
}

// Backoff for an unexpected THROW during delivery (corrupt-webhook decrypt,
// network reject, etc.), where there is no structured Discord result to read.
// A thrown error still needs a non-null FUTURE retry_after — otherwise
// listDueReminders re-selects the same reminder every 10s and head-of-line-
// blocks the entire batch until it ages out of the grace window (P1-10).
//
// There is exactly ONE backoff curve — retryAfterFromResult. This adapter
// supplies a synthetic non-rate-limited result for the thrown-error path so the
// catch and the structured-failure path share the same exponential backoff (and
// the same 1h cap), instead of carrying a second, divergent backoff implementation.
function computeReminderRetryAfter(reminder, now) {
  return retryAfterFromResult({ rateLimited: false }, now, Number(reminder.retry_count) || 0);
}

function publishReminderChange(reminder, reason, state = "current") {
  publishCurrentDashboardEvent(reminder.user_id, {
    source: "reminders",
    reason,
    state,
    details: {
      reminderId: reminder.id,
      sourceType: reminder.source_type,
      sourceItemId: reminder.source_item_id,
      sourceOccurrenceId: reminder.source_occurrence_id || null,
    },
  });
}

export async function processDueReminderBatch({
  now = new Date(),
  limit = 10,
  dbClient = db,
  decryptFn = decrypt,
  sendFn = null,
} = {}) {
  const nowIso = new Date(now).toISOString();
  const due = await listDueReminders({ now: nowIso, limit }, { dbClient });
  const result = { processed: 0, sent: 0, missed: 0, failed: 0 };

  // P3-11: a due batch is almost always one user's reminders, so memoize the
  // ea_settings read and the decrypted webhook per user instead of re-reading +
  // re-decrypting for every reminder in the loop. The decrypted URL is cached
  // only on success, so a corrupt-webhook decrypt still throws per reminder and
  // is handled by the per-item try/catch below (P1-10 isolation preserved).
  const settingsByUser = new Map();
  const webhookByUser = new Map();
  const getDiscordSettings = async (userId) => {
    if (!settingsByUser.has(userId)) {
      settingsByUser.set(userId, await loadDiscordSettings(userId, { dbClient }));
    }
    return settingsByUser.get(userId);
  };
  const getDiscordWebhookUrl = (userId, encrypted) => {
    if (webhookByUser.has(userId)) return webhookByUser.get(userId);
    const url = decryptFn(encrypted);
    webhookByUser.set(userId, url);
    return url;
  };

  for (const reminder of due) {
    result.processed += 1;
    // Per-item isolation (P1-10): a throw from decrypt/send/db inside one
    // reminder must not abort the batch or block every later due reminder.
    try {
      if (computeReminderState({ remindAt: reminder.remind_at, now: nowIso }) === "missed") {
        await markReminderMissed(reminder.id, { missedAt: nowIso }, { dbClient });
        publishReminderChange(reminder, "reminder_missed");
        result.missed += 1;
        continue;
      }

      const settings = await getDiscordSettings(reminder.user_id);
      if (!settings?.discord_webhook_url_encrypted) {
        await markReminderDeliveryFailed(reminder.id, {
          error: "Discord webhook not configured",
        }, { dbClient });
        publishReminderChange(reminder, "reminder_delivery_failed", "degraded");
        result.failed += 1;
        continue;
      }

      const webhookUrl = getDiscordWebhookUrl(reminder.user_id, settings.discord_webhook_url_encrypted);
      const payload = formatDiscordReminderPayload({
        reminder,
        discordUserId: settings.discord_user_id,
      });
      const delivery = sendFn
        ? await sendFn(webhookUrl, payload, { reminder })
        : await sendDiscordWebhook(webhookUrl, payload);

      if (delivery.ok) {
        await markReminderSent(reminder.id, { sentAt: nowIso }, { dbClient });
        publishReminderChange(reminder, "reminder_sent");
        result.sent += 1;
        continue;
      }

      const retryCount = Number(reminder.retry_count) || 0;
      if (retryCount >= MAX_REMINDER_DELIVERY_RETRIES) {
        // Cap retries: stop re-firing (and re-hitting Discord for) a
        // permanently-failing reminder and mark it missed instead (P2-27).
        await markReminderMissed(reminder.id, { missedAt: nowIso }, { dbClient });
        publishReminderChange(reminder, "reminder_missed", "degraded");
        result.missed += 1;
        continue;
      }
      await markReminderDeliveryFailed(reminder.id, {
        error: delivery.error || `Discord ${delivery.status || "error"}`,
        // P2-27: back off non-rate-limited failures too, instead of leaving
        // retry_after NULL and re-firing every 10s.
        retryAfter: retryAfterFromResult(delivery, nowIso, retryCount),
      }, { dbClient });
      publishReminderChange(reminder, "reminder_delivery_failed", "degraded");
      result.failed += 1;
    } catch (err) {
      // Treat any thrown error as a delivery failure with a backoff retry_after
      // (non-null + future) so the worker stops re-selecting this reminder every
      // 10s, then fall through to the next one (P1-10).
      try {
        await markReminderDeliveryFailed(reminder.id, {
          error: err?.message || String(err),
          retryAfter: computeReminderRetryAfter(reminder, nowIso),
        }, { dbClient });
      } catch (markErr) {
        // If the failure source was the DB itself, this status write can also
        // throw. Swallow it so one reminder's DB error cannot re-abort the batch
        // or head-of-line-block the rest — the retry_after simply will not
        // advance for this row until the DB recovers (P1-10).
        console.error(
          `[Reminders] failed to record delivery failure for ${reminder.id}:`,
          markErr?.message || markErr,
        );
      }
      publishReminderChange(reminder, "reminder_delivery_failed", "degraded");
      result.failed += 1;
    }
  }

  return result;
}
