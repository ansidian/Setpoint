import { fetchWithTimeout } from "../platform/fetch-with-timeout.ts";
import type { FetchFunction } from "../platform/fetch-with-timeout.ts";
import type { ReminderPayloadSnapshot, ReminderSourceType } from "../../shared/types/reminders.ts";

const FALLBACK_COLOR = 0xcba6da;
const DISCORD_WEBHOOK_TIMEOUT_MS = 10_000;

interface DiscordReminderInput {
  source_type: ReminderSourceType;
  anchor_at: string;
  remind_at: string;
  offset_minutes: number;
  payload_snapshot?: ReminderPayloadSnapshot | null;
  payload_snapshot_json?: string | null;
}

interface DiscordEmbedField { name: string; value: string; inline: boolean }
interface DiscordEmbed {
  title: string;
  url?: string;
  description?: string;
  color: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp: string;
}
export interface DiscordWebhookPayload { content?: string; embeds: DiscordEmbed[] }
export interface DiscordResponse {
  ok: boolean;
  status: number;
  headers?: { get?: (name: string) => string | null };
  text: () => Promise<string>;
}
export type DiscordDeliveryResult =
  | { ok: true; status: number }
  | { ok: false; status: number; rateLimited: boolean; retryAfterMs: number | null; error: string };

function parseSnapshot(reminder: DiscordReminderInput): ReminderPayloadSnapshot {
  if (reminder?.payload_snapshot) return reminder.payload_snapshot;
  if (!reminder?.payload_snapshot_json) return {};
  try {
    const parsed: unknown = JSON.parse(reminder.payload_snapshot_json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as ReminderPayloadSnapshot
      : {};
  } catch {
    return {};
  }
}

function colorToInteger(color: unknown): number {
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return FALLBACK_COLOR;
  return Number.parseInt(color.slice(1), 16);
}

function sourceLabel(sourceType: ReminderSourceType): string {
  return sourceType === "todoist_task" ? "Todoist" : "Calendar";
}

function offsetLabel(offsetMinutes: number): string {
  const absolute = Math.abs(Number(offsetMinutes || 0));
  if (absolute === 0) return "At start time";
  if (absolute % 1440 === 0) {
    const days = absolute / 1440;
    return `${days} day${days === 1 ? "" : "s"} ${offsetMinutes < 0 ? "before" : "after"}`;
  }
  if (absolute % 60 === 0) {
    const hours = absolute / 60;
    return `${hours} hour${hours === 1 ? "" : "s"} ${offsetMinutes < 0 ? "before" : "after"}`;
  }
  return `${absolute} minutes ${offsetMinutes < 0 ? "before" : "after"}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDiscordReminderPayload({ reminder, discordUserId = null }: { reminder: DiscordReminderInput; discordUserId?: string | null }): DiscordWebhookPayload {
  const snapshot = parseSnapshot(reminder);
  const title = snapshot.title || snapshot.name || "Setpoint reminder";
  const context = snapshot.context || snapshot.sourceLabel || sourceLabel(reminder.source_type);
  const fields = [
    { name: "Source", value: context, inline: true },
    { name: "Reminder", value: offsetLabel(reminder.offset_minutes), inline: true },
    { name: "Item time", value: formatDateTime(reminder.anchor_at), inline: false },
    { name: "Reminder time", value: formatDateTime(reminder.remind_at), inline: false },
  ];

  return {
    content: discordUserId ? `<@${discordUserId}>` : undefined,
    embeds: [{
      title,
      url: snapshot.url || undefined,
      description: snapshot.description || undefined,
      color: colorToInteger(snapshot.color),
      fields,
      footer: { text: "Setpoint" },
      timestamp: reminder.remind_at,
    }],
  };
}

async function readResponseText(response: DiscordResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function parseRetryAfterMs(response: DiscordResponse, bodyText: string): number | null {
  const header = response.headers?.get?.("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  }
  try {
    const body: unknown = JSON.parse(bodyText || "{}");
    const retryAfter = Number(typeof body === "object" && body !== null && "retry_after" in body ? body.retry_after : Number.NaN);
    if (Number.isFinite(retryAfter)) return Math.max(0, Math.round(retryAfter * 1000));
  } catch {
    // Non-JSON Discord error responses have no structured backoff.
  }
  return null;
}

export async function sendDiscordWebhook(webhookUrl: string, payload: DiscordWebhookPayload, { fetchFn = fetch as FetchFunction<DiscordResponse> }: { fetchFn?: FetchFunction<DiscordResponse> } = {}): Promise<DiscordDeliveryResult> {
  const response = await fetchWithTimeout(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, { timeoutMs: DISCORD_WEBHOOK_TIMEOUT_MS, fetchFn });
  if (response.ok) {
    return { ok: true, status: response.status };
  }

  const bodyText = await readResponseText(response);
  const error = bodyText || `Discord webhook failed with ${response.status}`;
  if (response.status === 429) {
    return {
      ok: false,
      status: response.status,
      rateLimited: true,
      retryAfterMs: parseRetryAfterMs(response, bodyText),
      error,
    };
  }

  return {
    ok: false,
    status: response.status,
    rateLimited: false,
    retryAfterMs: null,
    error,
  };
}

export function formatGenericDiscordTestPayload({ discordUserId = null }: { discordUserId?: string | null } = {}): DiscordWebhookPayload {
  return {
    content: discordUserId ? `<@${discordUserId}>` : undefined,
    embeds: [{
      title: "Setpoint reminder test",
      description: "Discord reminders are configured.",
      color: FALLBACK_COLOR,
      timestamp: new Date().toISOString(),
    }],
  };
}
