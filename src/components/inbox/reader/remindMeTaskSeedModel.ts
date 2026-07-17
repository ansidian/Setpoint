import { epochFromLa, laComponents } from "../../../lib/dashboard-helpers";
import { getGmailUrl } from "../../../lib/email-links";
import type { InboxEmailLike } from "../inboxTypes";

const GENERIC_ACTIONS = new Set(["review", "ignore", "no action needed"]);

export interface RemindMeTaskSeed {
  title: string;
  description: string;
  dueEpochMs: number | null;
  detectedDateLabel: string | null;
  triaged: boolean;
  sourceUrl: string | null;
}

function substantiveAction(action: unknown) {
  const value = typeof action === "string" ? action.trim() : "";
  return value && !GENERIC_ACTIONS.has(value.toLowerCase()) ? value : null;
}

function provenance(email: InboxEmailLike) {
  const senderName = email.from_name || email.from || "Unknown sender";
  const senderAddress = email.from_address || email.from_email || email.fromEmail;
  const sender = senderAddress ? `${senderName} <${senderAddress}>` : senderName;
  const lines = [`From: ${sender}`, `Subject: ${email.subject || "(no subject)"}`];
  const sourceUrl = getGmailUrl(email);
  if (sourceUrl) lines.push(`Source: ${sourceUrl}`);
  return lines.join("\n");
}

function dueBeforeDeadline(deadlineAt: string | null | undefined, nowMs: number) {
  if (!deadlineAt) return { dueEpochMs: null, detectedDateLabel: null };
  const parsed = Date.parse(deadlineAt);
  if (!Number.isFinite(parsed)) return { dueEpochMs: null, detectedDateLabel: null };
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(deadlineAt);
  const effectivelyMidnight = /T00:00(?::00(?:\.000)?)?(?:Z|[+-]00:00)$/.test(deadlineAt);
  let year: number;
  let month: number;
  let day: number;
  let hour: number;
  let minute: number;
  if (dateOnly || effectivelyMidnight) {
    const match = deadlineAt.match(/^(\d{4})-(\d{2})-(\d{2})/)!;
    year = Number(match[1]); month = Number(match[2]) - 1; day = Number(match[3]);
    hour = 9; minute = 0;
  } else {
    const parts = laComponents(parsed);
    ({ year, month, day, hour, minute } = parts);
  }
  const dueEpochMs = epochFromLa(year, month, day - 1, hour, minute);
  const detectedDateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: dateOnly || effectivelyMidnight ? undefined : "short",
  }).format(new Date(dateOnly ? epochFromLa(year, month, day, 9, 0) : parsed));
  return { dueEpochMs: dueEpochMs > nowMs ? dueEpochMs : null, detectedDateLabel };
}

export function buildRemindMeTaskSeed(email: InboxEmailLike, nowMs = Date.now()): RemindMeTaskSeed {
  const triaged = !email._untriaged && !email._untriagedRead && !!(
    email.action || email.summary || email.deadline_at || email.claude
  );
  const source = provenance(email);
  const sourceUrl = getGmailUrl(email);
  if (!triaged) {
    return { title: "", description: source, dueEpochMs: null, detectedDateLabel: null, triaged: false, sourceUrl };
  }
  const summary = (email.summary || email.claude?.summary || email.aiSummary || "").trim();
  return {
    title: substantiveAction(email.action) || email.subject?.trim() || "",
    description: [summary, source].filter(Boolean).join("\n\n"),
    ...dueBeforeDeadline(email.deadline_at, nowMs),
    triaged: true,
    sourceUrl,
  };
}
