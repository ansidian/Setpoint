const FALLBACK_COLOR = 0xcba6da;

function parseSnapshot(reminder) {
  if (reminder?.payload_snapshot) return reminder.payload_snapshot;
  if (!reminder?.payload_snapshot_json) return {};
  try {
    return JSON.parse(reminder.payload_snapshot_json);
  } catch {
    return {};
  }
}

function colorToInteger(color) {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return FALLBACK_COLOR;
  return Number.parseInt(color.slice(1), 16);
}

function sourceLabel(sourceType) {
  return sourceType === "todoist_task" ? "Todoist" : "Calendar";
}

function offsetLabel(offsetMinutes) {
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

function formatDateTime(value) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDiscordReminderPayload({ reminder, discordUserId = null }) {
  const snapshot = parseSnapshot(reminder);
  const title = snapshot.title || snapshot.name || "EA Dashboard reminder";
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
      footer: { text: "EA Dashboard" },
      timestamp: reminder.remind_at,
    }],
  };
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function parseRetryAfterMs(response, bodyText) {
  const header = response.headers?.get?.("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  }
  try {
    const body = JSON.parse(bodyText || "{}");
    const retryAfter = Number(body.retry_after);
    if (Number.isFinite(retryAfter)) return Math.max(0, Math.round(retryAfter * 1000));
  } catch {
    // Non-JSON Discord error responses have no structured backoff.
  }
  return null;
}

export async function sendDiscordWebhook(webhookUrl, payload, { fetchFn = fetch } = {}) {
  const response = await fetchFn(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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

export function formatGenericDiscordTestPayload({ discordUserId = null } = {}) {
  return {
    content: discordUserId ? `<@${discordUserId}>` : undefined,
    embeds: [{
      title: "EA Dashboard reminder test",
      description: "Discord reminders are configured.",
      color: FALLBACK_COLOR,
      timestamp: new Date().toISOString(),
    }],
  };
}
