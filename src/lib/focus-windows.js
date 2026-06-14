import { dayBucket, dueDateToMs, formatDuration } from "./shell-helpers";

const BUFFER_MS = 5 * 60 * 1000;
const MIN_PROTECTED_MS = 25 * 60 * 1000;
const MIN_SHORT_MS = 10 * 60 * 1000;
const TZ = "America/Los_Angeles";

function pacificDateKey(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function endOfPacificDayMs(now) {
  return new Date(`${pacificDateKey(now)}T23:59:59.999`).getTime();
}

function formatClock(ms) {
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRange(startMs, endMs) {
  return `${formatClock(startMs)}-${formatClock(endMs)}`;
}

function summarizePressure(deadlines, now) {
  const summary = {
    overdue: 0,
    today: 0,
    soon: 0,
    level: "low",
  };

  for (const deadline of deadlines || []) {
    if (!deadline || deadline.status === "complete") continue;
    const dueAtMs = dueDateToMs(deadline.due_date, deadline.due_time);
    if (!Number.isFinite(dueAtMs)) continue;

    const bucket = dayBucket(dueAtMs, now);
    if (dueAtMs < now || bucket < 0) {
      summary.overdue += 1;
    } else if (bucket === 0) {
      summary.today += 1;
    } else if (bucket <= 2) {
      summary.soon += 1;
    }
  }

  if (summary.overdue > 0 || summary.today > 0) summary.level = "high";
  else if (summary.soon > 0) summary.level = "medium";
  return summary;
}

function relevantPressureDeadlineMs(deadline, now) {
  if (!deadline || deadline.status === "complete") return null;
  const dueAtMs = dueDateToMs(deadline.due_date, deadline.due_time);
  if (!Number.isFinite(dueAtMs)) return null;
  const bucket = dayBucket(dueAtMs, now);
  if (dueAtMs < now || bucket <= 0) return dueAtMs;
  if (bucket <= 2) return dueAtMs;
  return null;
}

function collectCandidateWindows(events, now) {
  const endOfDayMs = endOfPacificDayMs(now);
  const blockers = [...(events || [])]
    .filter((event) => (
      event &&
      !event.allDay &&
      Number.isFinite(event.startMs) &&
      Number.isFinite(event.endMs) &&
      dayBucket(event.startMs, now) === 0 &&
      event.endMs > now
    ))
    .sort((a, b) => a.startMs - b.startMs);

  const rawGaps = [];
  let cursor = now;

  for (const event of blockers) {
    const gapEnd = Math.max(cursor, event.startMs - BUFFER_MS);
    if (gapEnd > cursor) {
      rawGaps.push({
        startMs: cursor,
        endMs: gapEnd,
        nextEvent: event,
      });
    }
    cursor = Math.max(cursor, event.endMs + BUFFER_MS);
  }

  if (cursor < endOfDayMs) {
    rawGaps.push({
      startMs: cursor,
      endMs: endOfDayMs,
      nextEvent: null,
    });
  }

  return {
    blockers,
    rawGaps,
    endOfDayMs,
  };
}

function scoreWindow(window, pressure, now) {
  const durationMin = Math.max(
    0,
    Math.round((window.endMs - window.startMs) / 60000),
  );
  const startDelayMin = Math.max(
    0,
    Math.round((window.startMs - now) / 60000),
  );
  const nextInterruptionMin = window.nextEvent
    ? Math.max(0, Math.round((window.nextEvent.startMs - window.endMs) / 60000))
    : durationMin;

  let score = durationMin;
  if (durationMin >= 45) score += 12;
  if (durationMin >= 60) score += 18;
  if (durationMin >= 90) score += 24;
  if (durationMin >= 120) score += 10;

  if (!window.nextEvent) score += 8;
  else if (nextInterruptionMin >= 90) score += 10;
  else if (nextInterruptionMin >= 60) score += 6;
  else if (nextInterruptionMin < 30) score -= 8;

  if (pressure.level === "high") {
    score += Math.max(0, 18 - Math.floor(startDelayMin / 6));
  } else if (pressure.level === "medium") {
    score += Math.max(0, 10 - Math.floor(startDelayMin / 12));
  }

  return {
    ...window,
    durationMin,
    nextInterruptionMin,
    startDelayMin,
    score,
    reachesEndOfDay: !window.nextEvent,
  };
}

function chooseQuality(window, pressure, remainingEvents) {
  if (window.reachesEndOfDay && remainingEvents === 0) return "Rest of day open";
  if (
    window.durationMin >= 90 &&
    (window.nextInterruptionMin >= 90 || window.reachesEndOfDay) &&
    pressure.level === "low"
  ) {
    return "Most protected";
  }
  if (window.durationMin >= 60 && (window.nextInterruptionMin >= 60 || window.reachesEndOfDay)) {
    return "Cleanest";
  }
  if (window.durationMin >= 45) return "Usable";
  return "Fragile";
}

function choosePurpose(window, pressure) {
  if (window.durationMin >= 75 && pressure.level !== "high") return "deep-work block";
  if (window.durationMin >= 50 && pressure.level === "low") return "deep-work block";
  if (window.durationMin >= 40 && pressure.level !== "low") return "catch-up window";
  return "admin block";
}

function chooseContext(window, pressure, remainingEvents) {
  if (pressure.level !== "low" && window.startDelayMin <= 120) {
    return "before deadline pressure rises";
  }
  if (!window.reachesEndOfDay && remainingEvents >= 2) {
    return "before the day fragments";
  }
  if (!window.reachesEndOfDay) return "before your next event";
  return "with the rest of the day open";
}

function composeExplanation(window, pressure, purpose, context, quality) {
  if (quality === "Rest of day open") {
    if (pressure.level === "high") {
      return "No more events today. Best used to get ahead of the next deadline.";
    }
    if (pressure.level === "medium") {
      return "No more events today. Strong stretch before the next deadline cluster.";
    }
    return "No more events today. This is your best stretch for uninterrupted work.";
  }

  if (purpose === "deep-work block") {
    if (context === "before deadline pressure rises") {
      return "Long enough for real progress before deadline pressure rises.";
    }
    if (context === "before the day fragments") {
      return "Long enough for deep work before the day fragments.";
    }
    if (context === "before your next event") {
      return "Long enough for deep work before your next event.";
    }
    return "Long enough for deep work while the calendar stays open.";
  }

  if (purpose === "catch-up window") {
    if (pressure.level === "high") {
      return "Good catch-up time before the next deadline needs attention.";
    }
    if (context === "before deadline pressure rises") {
      return "Good catch-up time before deadline pressure rises.";
    }
    return "Useful catch-up time before the day tightens up.";
  }

  if (pressure.level === "high") {
    return "Best for lighter work before the next deadline needs attention.";
  }
  if (context === "before deadline pressure rises") {
    return "Best for lighter work before deadline pressure rises.";
  }
  if (context === "before your next event") {
    return "Best for lighter work before your next event.";
  }
  return "Best for lighter work while the calendar stays open.";
}

function decorateWindow(window, pressure, remainingEvents) {
  const quality = chooseQuality(window, pressure, remainingEvents);
  const purpose = choosePurpose(window, pressure);
  const context = chooseContext(window, pressure, remainingEvents);
  const explanation = composeExplanation(window, pressure, purpose, context, quality);

  return {
    ...window,
    quality,
    purpose,
    context,
    timeRangeLabel: formatRange(window.startMs, window.endMs),
    durationLabel: formatDuration(window.durationMin),
    explanation,
  };
}

function bestShortGap(rawGaps) {
  return rawGaps
    .map((gap) => ({
      ...gap,
      durationMin: Math.max(0, Math.round((gap.endMs - gap.startMs) / 60000)),
    }))
    .filter((gap) => gap.durationMin >= Math.round(MIN_SHORT_MS / 60000))
    .sort((a, b) => {
      if (b.durationMin !== a.durationMin) return b.durationMin - a.durationMin;
      return a.startMs - b.startMs;
    })[0] || null;
}

export function deriveFocusWindows({ events = [], deadlines = [], now = Date.now() }) {
  const pressure = summarizePressure(deadlines, now);
  const { blockers, rawGaps } = collectCandidateWindows(events, now);
  const remainingEvents = blockers.filter((event) => event.startMs > now).length;

  const candidates = rawGaps
    .filter((gap) => gap.endMs - gap.startMs >= MIN_PROTECTED_MS)
    .map((gap) => scoreWindow(gap, pressure, now))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.durationMin !== a.durationMin) return b.durationMin - a.durationMin;
      return a.startMs - b.startMs;
    });

  if (candidates.length > 0) {
    const primaryWindow = decorateWindow(candidates[0], pressure, remainingEvents);
    const backupWindow = candidates[1]
      ? decorateWindow(candidates[1], pressure, remainingEvents)
      : null;

    return {
      pressure,
      primaryWindow,
      backupWindow,
      openWindowStatus: null,
    };
  }

  const shortGap = bestShortGap(rawGaps);
  if (shortGap) {
    return {
      pressure,
      primaryWindow: null,
      backupWindow: null,
      openWindowStatus: {
        kind: "short-window",
        timeRangeLabel: formatRange(shortGap.startMs, shortGap.endMs),
        durationLabel: formatDuration(shortGap.durationMin),
      },
    };
  }

  return {
    pressure,
    primaryWindow: null,
    backupWindow: null,
    openWindowStatus: {
      kind: remainingEvents === 0 ? "open-day" : "none",
    },
  };
}

export function focusPressureTarget(deadlines = [], now = Date.now()) {
  const relevant = deadlines
    .map((deadline) => ({
      deadline,
      dueAtMs: relevantPressureDeadlineMs(deadline, now),
    }))
    .filter((entry) => Number.isFinite(entry.dueAtMs))
    .sort((a, b) => a.dueAtMs - b.dueAtMs);

  if (!relevant.length) return null;

  const entry = relevant[0];
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(entry.dueAtMs));

  return {
    date,
    id: entry.deadline?.id != null ? String(entry.deadline.id) : null,
    deadline: entry.deadline,
  };
}

export function focusPressureDate(deadlines = [], now = Date.now()) {
  return focusPressureTarget(deadlines, now)?.date || null;
}
