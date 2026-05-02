function parseScheduleClock(schedule) {
  if (typeof schedule?.time === "string" && /^\d{2}:\d{2}$/.test(schedule.time)) {
    const [hour, minute] = schedule.time.split(":").map(Number);
    return { hour, minute };
  }
  if (schedule?.hour != null) {
    return { hour: Number(schedule.hour), minute: Number(schedule.minute ?? 0) };
  }
  return null;
}

function formatRelativeWindow(targetMs, nowMs) {
  const diffMs = Math.max(0, targetMs - nowMs);
  const totalMinutes = Math.round(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `in ${minutes}m`;
  if (minutes === 0) return `in ${hours}h`;
  return `in ${hours}h ${minutes}m`;
}

function formatClockTime(date, timeZone = "America/Los_Angeles") {
  return date.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getNextBriefingSchedule(schedules, nowMs = Date.now()) {
  if (!Array.isArray(schedules) || schedules.length === 0) return null;
  const now = new Date(nowMs);
  const upcoming = schedules
    .filter((schedule) => schedule?.enabled !== false)
    .map((schedule) => {
      const clock = parseScheduleClock(schedule);
      if (!clock) return null;
      const next = new Date(now);
      next.setHours(clock.hour, clock.minute, 0, 0);
      if (next.getTime() <= nowMs) next.setDate(next.getDate() + 1);
      return {
        schedule,
        nextMs: next.getTime(),
        label: schedule.label || "Scheduled briefing",
        timeLabel: formatClockTime(next, schedule.tz || "America/Los_Angeles"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.nextMs - b.nextMs);

  if (!upcoming.length) return null;
  const next = upcoming[0];
  return {
    ...next,
    relativeLabel: formatRelativeWindow(next.nextMs, nowMs),
  };
}

function formatAgoLabel(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const dt = new Date(iso);
  const diffMs = Math.max(0, nowMs - dt.getTime());
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function buildBriefingStatus({ briefing, nextBriefing, nowMs, noticeActive }) {
  if (!briefing) return nextBriefing ? {
    label: "Schedule",
    headline: `${nextBriefing.label} ${nextBriefing.relativeLabel}`,
    detail: `${nextBriefing.timeLabel}`,
    sourceLabel: "Scheduled",
    ageLabel: nextBriefing.relativeLabel,
    nextLabel: `Next ${nextBriefing.timeLabel}`,
    nextDetail: nextBriefing.label,
    toneColor: "#89b4fa",
  } : null;

  const dataUpdatedAt = briefing.dataUpdatedAt || briefing.aiGeneratedAt || null;
  const updatedLabel = formatAgoLabel(dataUpdatedAt, nowMs);
  const aiLabel = formatAgoLabel(briefing.aiGeneratedAt, nowMs);
  const quietRefreshes = briefing.skippedAI ? Math.max(1, briefing.nonAiGenerationCount || 1) : 0;
  const dataUpdatedMs = dataUpdatedAt ? new Date(dataUpdatedAt).getTime() : Number.NaN;
  const showRecentUpdate = Number.isFinite(dataUpdatedMs) && nowMs - dataUpdatedMs < 60_000;
  const showUpdateBadge = !!updatedLabel && (noticeActive || showRecentUpdate);
  const activityLabel = showUpdateBadge ? `Updated ${updatedLabel}` : null;
  const activityShortLabel = showUpdateBadge ? "Updated" : null;
  const activityToneColor = "#a6e3a1";

  const nextLine = nextBriefing
    ? `Next ${nextBriefing.label} at ${nextBriefing.timeLabel} (${nextBriefing.relativeLabel})`
    : "No schedules enabled";

  if (briefing.skippedAI) {
    const quietLabel = quietRefreshes > 1 ? `Quiet refresh · ${quietRefreshes} cloned updates` : "Quiet refresh";
    return {
      label: "Latest briefing",
      headline: aiLabel ? `${quietLabel} · source briefing from ${aiLabel}` : quietLabel,
      detail: nextLine,
      sourceLabel: quietRefreshes > 1 ? `Quiet x${quietRefreshes}` : "Quiet",
      ageLabel: aiLabel,
      nextLabel: nextBriefing ? `Next ${nextBriefing.timeLabel}` : "No schedule",
      nextDetail: nextBriefing?.label || null,
      toneColor: "#89b4fa",
      activityLabel,
      activityShortLabel,
      activityToneColor,
    };
  }

  return {
    label: "Latest briefing",
    headline: aiLabel ? `Briefing refreshed ${aiLabel}` : "Briefing refreshed",
    detail: nextLine,
    sourceLabel: "Briefing",
    ageLabel: aiLabel,
    nextLabel: nextBriefing ? `Next ${nextBriefing.timeLabel}` : "No schedule",
    nextDetail: nextBriefing?.label || null,
    toneColor: "#cba6da",
    activityLabel,
    activityShortLabel,
    activityToneColor,
  };
}
