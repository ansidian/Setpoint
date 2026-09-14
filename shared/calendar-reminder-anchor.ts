const PACIFIC_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsAt(epoch: number) {
  return Object.fromEntries(PACIFIC_DATE_TIME.formatToParts(epoch)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)])) as Record<
      "year" | "month" | "day" | "hour" | "minute", number
    >;
}

/** All-day layout timestamps are synthetic noon UTC; reminders start at Pacific midnight. */
export function calendarReminderAnchorAt(event: { startMs?: number; allDay?: boolean }): string | null {
  if (event.startMs == null || !Number.isFinite(event.startMs)) return null;
  if (!event.allDay) return new Date(event.startMs).toISOString();

  const date = partsAt(event.startMs);
  const midnight = Date.UTC(date.year, date.month - 1, date.day);
  let epoch = midnight;
  // Re-evaluate the offset at midnight, including days when DST changes later.
  for (let pass = 0; pass < 4; pass += 1) {
    const actual = partsAt(epoch);
    const delta = midnight - Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    if (delta === 0) break;
    epoch += delta;
  }
  return new Date(epoch).toISOString();
}
