import { Router } from "express";
import type { Request, Response } from "express";
import db from "../db/connection.ts";
import { decrypt } from "../platform/encryption.ts";
import { settingsCredentialContext } from "../platform/credential-encryption-context.ts";
import {
  formatGenericDiscordTestPayload,
  sendDiscordWebhook,
} from "../reminders/discord-reminders.ts";
import {
  createReminder,
  deleteReminder,
  listRemindersForSource,
  TimeToLeaveError,
} from "../reminders/reminder-service.ts";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.ts";
import type {
  CreateReminderInput,
  ReminderAnchorKind,
  ReminderPayloadSnapshot,
  ReminderSourceType,
} from "../../shared/types/reminders.ts";

interface ReminderRouteBody extends Record<string, unknown> {
  sourceType?: unknown;
  source_type?: unknown;
  sourceItemId?: unknown;
  source_item_id?: unknown;
  sourceOccurrenceId?: unknown;
  source_occurrence_id?: unknown;
  sourceAccountId?: unknown;
  source_account_id?: unknown;
  sourceCalendarId?: unknown;
  source_calendar_id?: unknown;
  anchorKind?: unknown;
  anchor_kind?: unknown;
  anchorAt?: unknown;
  anchor_at?: unknown;
  offsetMinutes?: unknown;
  offset_minutes?: unknown;
  payloadSnapshot?: unknown;
  payload_snapshot?: unknown;
  reminderKind?: unknown;
  reminder_kind?: unknown;
  eventStart?: unknown;
  event_start?: unknown;
  eventLocation?: unknown;
  event_location?: unknown;
  arrivalBufferMinutes?: unknown;
  arrival_buffer_minutes?: unknown;
  isAllDay?: unknown;
  is_all_day?: unknown;
  isRecurring?: unknown;
  is_recurring?: unknown;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function queryText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

// Bare router: mounted behind requireCookieSession in routes/accounts.ts.
const router = Router();

router.post("/settings/discord-reminder-test", async (_req: Request, res: Response) => {
  const userId = process.env.EA_USER_ID!;
  try {
    const result = await db.execute({
      sql: "SELECT discord_webhook_url_encrypted, discord_user_id FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    const settings = result.rows[0];
    if (!settings?.discord_webhook_url_encrypted) {
      return res.status(400).json({ message: "Discord webhook not configured" });
    }

    const payload = formatGenericDiscordTestPayload({
      discordUserId: settings.discord_user_id == null ? null : String(settings.discord_user_id),
    });
    const delivery = await sendDiscordWebhook(
      decrypt(
        String(settings.discord_webhook_url_encrypted),
        settingsCredentialContext(userId, "discord_webhook_url_encrypted"),
      ),
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

router.get("/reminders", async (req: Request, res: Response) => {
  const userId = process.env.EA_USER_ID!;
  const sourceType = queryText(req.query.sourceType || req.query.source_type);
  const sourceItemId = queryText(req.query.sourceItemId || req.query.source_item_id);
  const sourceOccurrenceId = queryText(req.query.sourceOccurrenceId || req.query.source_occurrence_id);
  if (!sourceType || !sourceItemId) {
    return res.status(400).json({ message: "sourceType and sourceItemId are required" });
  }

  try {
    const reminders = await listRemindersForSource({
      userId,
      sourceType: sourceType as ReminderSourceType,
      sourceItemId,
      sourceOccurrenceId: sourceOccurrenceId || undefined,
    });
    return res.json({ reminders });
  } catch (err) {
    console.error("Error listing reminders:", err);
    return res.status(400).json({ message: errorMessage(err, "Failed to list reminders") });
  }
});

router.post("/reminders", async (req: Request<object, object, ReminderRouteBody>, res: Response) => {
  const userId = process.env.EA_USER_ID!;
  try {
    const reminderKind = req.body.reminderKind ?? req.body.reminder_kind ?? "fixed";
    if (reminderKind !== "fixed" && reminderKind !== "time_to_leave") {
      return res.status(400).json({ message: "reminderKind must be fixed or time_to_leave" });
    }
    const sourceType = req.body.sourceType || req.body.source_type;
    const sourceItemId = req.body.sourceItemId || req.body.source_item_id;
    const sourceOccurrenceId = req.body.sourceOccurrenceId || req.body.source_occurrence_id;
    const shared = {
      userId,
      sourceType: sourceType as ReminderSourceType,
      sourceAccountId: (req.body.sourceAccountId || req.body.source_account_id || null) as string | null,
      sourceCalendarId: (req.body.sourceCalendarId || req.body.source_calendar_id || null) as string | null,
      sourceItemId: sourceItemId as string,
      sourceOccurrenceId: (sourceOccurrenceId || null) as string | null,
      payloadSnapshot: (req.body.payloadSnapshot || req.body.payload_snapshot || null) as ReminderPayloadSnapshot | null,
    };
    const input: CreateReminderInput = reminderKind === "time_to_leave"
      ? {
          ...shared,
          reminderKind,
          sourceType: sourceType as "calendar_event",
          eventStart: (req.body.eventStart || req.body.event_start) as string,
          eventLocation: (req.body.eventLocation || req.body.event_location) as string,
          arrivalBufferMinutes: (req.body.arrivalBufferMinutes ?? req.body.arrival_buffer_minutes) as number | undefined,
          isAllDay: (req.body.isAllDay ?? req.body.is_all_day) as boolean | undefined,
          isRecurring: (req.body.isRecurring ?? req.body.is_recurring) as boolean | undefined,
        }
      : {
          ...shared,
          reminderKind,
          anchorKind: (req.body.anchorKind || req.body.anchor_kind) as ReminderAnchorKind,
          anchorAt: (req.body.anchorAt || req.body.anchor_at) as string,
          offsetMinutes: (req.body.offsetMinutes ?? req.body.offset_minutes) as number,
        };
    const reminder = await createReminder(input);
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
    const status = err instanceof TimeToLeaveError ? err.status : 400;
    const code = err instanceof TimeToLeaveError ? err.code : undefined;
    if (!(err instanceof TimeToLeaveError)) {
      console.error("Error creating reminder: reminder_validation_failed");
    }
    return res.status(status).json({
      ...(code ? { code } : null),
      message: errorMessage(err, "Failed to create reminder"),
    });
  }
});

router.delete("/reminders/:id", async (req: Request<{ id: string }>, res: Response) => {
  const userId = process.env.EA_USER_ID!;
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
