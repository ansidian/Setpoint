export interface CalendarDeadlineProjection {
  upcoming?: readonly unknown[];
  stats?: unknown;
  syncHealth?: unknown;
}

export function dashboardCalendarDeadlineData(
  deadlines: CalendarDeadlineProjection | null | undefined,
  isLoading: boolean,
) {
  return {
    upcoming: Array.isArray(deadlines?.upcoming) ? deadlines.upcoming : [],
    stats: deadlines?.stats || null,
    syncHealth: deadlines?.syncHealth || null,
    isLoading,
  };
}
