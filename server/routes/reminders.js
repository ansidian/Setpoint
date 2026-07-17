import { Router } from "express";
import db from "../db/connection.ts";
import { decrypt } from "../platform/encryption.ts";
import {
  formatGenericDiscordTestPayload,
  sendDiscordWebhook,
} from "../reminders/discord-reminders.js";
import {
  createReminder,
  deleteReminder,
  listRemindersForSource,
} from "../reminders/reminder-service.js";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.js";

// Bare router: mounted behind requireCookieSession in routes/accounts.ts.
const router = Router();

router.post("/settings/discord-reminder-test", async (_req, res) => {
  const userId = process.env.EA_USER_ID;
  try {
    const result = await db.execute({
      sql: "SELECT discord_webhook_url_encrypted, discord_user_id FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    const settings = result.rows[0] || {};
    if (!settings.discord_webhook_url_encrypted) {
      return res.status(400).json({ message: "Discord webhook not configured" });
    }

    const payload = formatGenericDiscordTestPayload({
      discordUserId: settings.discord_user_id,
    });
    const delivery = await sendDiscordWebhook(
      decrypt(settings.discord_webhook_url_encrypted),
      payload,
    );
    if (delivery.ok) {
      return res.json({ success: true, status: delivery.status });
    }
    if (delivery.rateLimited) {
      if (delivery.retryAfterMs) {
        res.set("Retry-After", String(Math.ceil(delivery.retryAfterMs / 1000)));
      }
      return res.status(429).json({ message: "Discord webhook rate limited" });
    }
    return res.status(502).json({ message: "Discord webhook test failed" });
  } catch (err) {
    console.error("Discord reminder test failed:", err);
    return res.status(500).json({ message: "Discord reminder test failed" });
  }
});

router.get("/reminders", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  const sourceType = req.query.sourceType || req.query.source_type;
  const sourceItemId = req.query.sourceItemId || req.query.source_item_id;
  const sourceOccurrenceId = req.query.sourceOccurrenceId || req.query.source_occurrence_id;
  if (!sourceType || !sourceItemId) {
    return res.status(400).json({ message: "sourceType and sourceItemId are required" });
  }

  try {
    const reminders = await listRemindersForSource({
      userId,
      sourceType,
      sourceItemId,
      sourceOccurrenceId: sourceOccurrenceId || undefined,
    });
    return res.json({ reminders });
  } catch (err) {
    console.error("Error listing reminders:", err);
    return res.status(400).json({ message: err.message || "Failed to list reminders" });
  }
});

router.post("/reminders", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  try {
    const sourceType = req.body.sourceType || req.body.source_type;
    const sourceItemId = req.body.sourceItemId || req.body.source_item_id;
    const sourceOccurrenceId = req.body.sourceOccurrenceId || req.body.source_occurrence_id;
    const reminder = await createReminder({
      userId,
      sourceType,
      sourceAccountId: req.body.sourceAccountId || req.body.source_account_id,
      sourceCalendarId: req.body.sourceCalendarId || req.body.source_calendar_id,
      sourceItemId,
      sourceOccurrenceId,
      anchorKind: req.body.anchorKind || req.body.anchor_kind,
      anchorAt: req.body.anchorAt || req.body.anchor_at,
      offsetMinutes: req.body.offsetMinutes ?? req.body.offset_minutes,
      payloadSnapshot: req.body.payloadSnapshot || req.body.payload_snapshot,
    });
    publishCurrentDashboardEvent(userId, {
      source: "reminders",
      reason: "reminder_created",
      state: "current",
      details: {
        sourceType,
        sourceItemId: sourceItemId == null ? null : String(sourceItemId),
        sourceOccurrenceId: sourceOccurrenceId || null,
      },
    });
    return res.status(201).json({ reminder });
  } catch (err) {
    console.error("Error creating reminder:", err);
    return res.status(400).json({ message: err.message || "Failed to create reminder" });
  }
});

router.delete("/reminders/:id", async (req, res) => {
  const userId = process.env.EA_USER_ID;
  try {
    const deleted = await deleteReminder(userId, req.params.id);
    if (!deleted) return res.status(404).json({ message: "Reminder not found" });
    publishCurrentDashboardEvent(userId, {
      source: "reminders",
      reason: "reminder_deleted",
      state: "current",
      details: {
        reminderId: req.params.id,
      },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("Error deleting reminder:", err);
    return res.status(500).json({ message: "Failed to delete reminder" });
  }
});

export default router;
