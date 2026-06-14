import db from "../db/connection.js";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.js";
import { decrypt } from "../platform/encryption.js";
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

function retryAfterFromResult(result, now) {
  if (!result.rateLimited || !result.retryAfterMs) return null;
  return new Date(new Date(now).getTime() + result.retryAfterMs).toISOString();
}

const RETRY_BACKOFF_BASE_MS = 60_000; // 1 minute
const RETRY_BACKOFF_MAX_MS = 30 * 60_000; // 30 minutes

// Backoff for an unexpected THROW during delivery (corrupt-webhook decrypt,
// network reject, etc.). retryAfterFromResult only handles structured Discord
// 429s, so a thrown error needs its own non-null FUTURE retry_after — otherwise
// listDueReminders re-selects the same reminder every 10s and head-of-line-
// blocks the entire batch until it ages out of the 6h grace (P1-10).
//
// MERGE-NOTE (P1-10 ↔ P2-27): P2-27 is "non-rate-limited Discord failures set no
// retry_after, so a permanently-failing reminder re-fires every 10s" — that is
// the structured delivery.ok===false path in the loop below, where
// retryAfterFromResult returns null for non-429 results. When fixing P2-27,
// REUSE this helper for that path rather than adding a second backoff.
function computeReminderRetryAfter(reminder, now) {
  const attempts = Number(reminder.retry_count) || 0;
  const delayMs = Math.min(RETRY_BACKOFF_BASE_MS * 2 ** attempts, RETRY_BACKOFF_MAX_MS);
  return new Date(new Date(now).getTime() + delayMs).toISOString();
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

      const settings = await loadDiscordSettings(reminder.user_id, { dbClient });
      if (!settings?.discord_webhook_url_encrypted) {
        await markReminderDeliveryFailed(reminder.id, {
          error: "Discord webhook not configured",
        }, { dbClient });
        publishReminderChange(reminder, "reminder_delivery_failed", "degraded");
        result.failed += 1;
        continue;
      }

      const webhookUrl = decryptFn(settings.discord_webhook_url_encrypted);
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

      await markReminderDeliveryFailed(reminder.id, {
        error: delivery.error || `Discord ${delivery.status || "error"}`,
        retryAfter: retryAfterFromResult(delivery, nowIso),
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
