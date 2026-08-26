import type { SnapshotRecord } from "../../../shared/types/snapshots";

type SnapshotSummaryCounts = Partial<Record<"queued" | "needs_attention" | "action" | "fyi" | "noise" | "carryover", number>>;

function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildActiveSnapshotSummary(counts: SnapshotSummaryCounts, accountCount: number): string {
  const needs = counts.needs_attention || counts.action || 0;
  const fyi = counts.fyi || 0;
  const noise = counts.noise || 0;
  const queued = counts.queued || 0;
  const total = queued + needs + fyi + noise + (counts.carryover || 0);
  const laneSummary = [
    queued > 0 ? `${queued} queued` : null,
    `${needs} need attention`,
    `${fyi} FYI`,
    `${noise} noise`,
  ].filter(Boolean).join(", ");
  return [
    `${pluralize(total, "email")} across ${pluralize(accountCount, "account")}.`,
    `${laneSummary}.`,
  ].join(" ");
}

function dateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(date);
}

export function formatSnapshotContext(snapshot: SnapshotRecord | null, now = new Date()): string | null {
  if (!snapshot?.start_at) return null;
  const start = new Date(snapshot.start_at);
  const end = snapshot.end_at ? new Date(snapshot.end_at) : null;
  if (Number.isNaN(start.getTime())) return null;

  const timeZone = snapshot.timezone || "America/Los_Angeles";
  const todayKey = dateKey(now, timeZone);
  const yesterday = new Date(now.getTime() - 86_400_000);
  const snapshotDateKey = dateKey(start, timeZone);
  const dayLabel = snapshotDateKey === todayKey
    ? "Today"
    : snapshotDateKey === dateKey(yesterday, timeZone)
      ? "Yesterday"
      : new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone,
      }).format(start);
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const startLabel = timeFormatter.format(start);
  const endLabel = end && !Number.isNaN(end.getTime())
    ? dateKey(end, timeZone) !== snapshotDateKey && timeFormatter.format(end) === "12:00 AM"
      ? "midnight"
      : timeFormatter.format(end)
    : null;
  const windowLabel = endLabel ? `${startLabel}–${endLabel}` : startLabel;
  const boundaryLabel = snapshot.schedule_label || (snapshot.status === "active" ? "Current" : "Snapshot");
  return `${dayLabel} · ${boundaryLabel} · ${windowLabel}`;
}
