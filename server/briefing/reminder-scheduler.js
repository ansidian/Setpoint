import db from "../db/connection.js";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.js";
import { decrypt } from "./encryption.js";
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
  }

  return result;
}
