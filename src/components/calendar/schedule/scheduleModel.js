export function derivePassedState(events) {
  if (!events?.length) return events;
  const nowMs = Date.now();
  return events.map((event) => ({
    ...event,
    passed: event.allDay ? false : (event.endMs || event.startMs) <= nowMs,
  }));
}

export function buildWeekDays(events) {
  const now = new Date();
  const dow = now.getDay();
  const daysUntilNextSunday = (7 - dow) % 7 || 7;
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + daysUntilNextSunday);
  nextSunday.setHours(0, 0, 0, 0);

  const byDay = {};
  for (const event of events || []) {
    const key = event.dayLabel;
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(event);
  }

  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(nextSunday);
    day.setDate(nextSunday.getDate() + i);
    const label = day.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    days.push({
      label,
      events: byDay[label] || [],
    });
  }

  return days;
}
