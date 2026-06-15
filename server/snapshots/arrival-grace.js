// Queue window before a newly-arrived email is triaged. During it, an email the
// owner reads is settled without a model call (read-before-triage skip), so a
// shorter window surfaces triage faster at the cost of a smaller free-skip gap.
export const ARRIVAL_GRACE_MS = 30 * 1000;

export const ARRIVAL_GRACE_SOURCE = "arrival_grace";
export const ARRIVAL_GRACE_READ_SOURCE = "arrival_grace_read";
export const ARRIVAL_GRACE_QUEUED_LANE = "queued";
export const ARRIVAL_GRACE_UNTRIAGED_READ_LANE = "untriaged_read";

export function arrivalGraceDeadline(now = new Date()) {
  return new Date(now.getTime() + ARRIVAL_GRACE_MS).toISOString();
}

export function isArrivalGraceSource(value) {
  return value === ARRIVAL_GRACE_SOURCE;
}
