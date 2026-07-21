interface DeadlineLike {
  id?: unknown;
  due_date?: string | null;
  status?: string;
  _tombstone?: boolean;
  points_possible?: number | null;
}

export function computeDeadlineStats(deadlines: DeadlineLike[]) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });
  const today = fmt.format(new Date());
  // Calendar-day math, not now+168h: a fixed ms shift is DST-fragile (e.g.
  // across spring-forward, +7*86400000ms from the night before can land 8
  // Pacific calendar days out instead of 7).
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 7);
  const weekFromNow = d.toISOString().slice(0, 10);
  let totalPoints = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let incomplete = 0;

  for (const deadline of deadlines) {
    if (deadline.status !== "complete") incomplete++;
    if (deadline.due_date === today) dueToday++;
    if (deadline.due_date && deadline.due_date >= today && deadline.due_date <= weekFromNow) dueThisWeek++;
    if (deadline.points_possible) totalPoints += deadline.points_possible;
  }

  return { incomplete, dueToday, dueThisWeek, totalPoints };
}
