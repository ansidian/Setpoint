import { daysUntil } from "../../../../lib/bill-utils";
import { formatShortDate, TRACKED_UTILITIES } from "./billsModel.js";

export function pickBestUtilityMatch(matches, today) {
  if (!matches?.length) return null;
  let bestUpcoming = null;
  let bestRecentPaid = null;
  let fallback = null;
  for (const entry of matches) {
    const nextDate = entry.next_date || null;
    if (nextDate && nextDate >= today) {
      if (!bestUpcoming || nextDate.localeCompare(bestUpcoming.next_date) < 0) {
        bestUpcoming = entry;
      }
      continue;
    }
    if (entry.paid && nextDate) {
      if (!bestRecentPaid || nextDate.localeCompare(bestRecentPaid.next_date) > 0) {
        bestRecentPaid = entry;
      }
      continue;
    }
    if (!fallback || (nextDate && (!fallback.next_date || nextDate.localeCompare(fallback.next_date) > 0))) {
      fallback = entry;
    }
  }
  return bestUpcoming || bestRecentPaid || fallback || null;
}

export function deriveUtilityStatus(data, today) {
  const schedules = data?.allSchedules || data?.schedules || [];
  const payeeMap = data?.payeeMap || {};
  const rows = TRACKED_UTILITIES.map((utility) => {
    const matches = schedules.filter((entry) => {
      const payeeCond = entry.conditions?.find((condition) => condition.field === "payee");
      const payeeName = payeeCond ? payeeMap[payeeCond.value] : null;
      const haystack = `${payeeName || ""} ${entry.payee || ""} ${entry.name || ""}`.toLowerCase();
      return haystack.includes(utility.match);
    });
    const schedule = pickBestUtilityMatch(matches, today);
    const nextDate = schedule?.next_date || null;
    const amtCond = schedule?.conditions?.find((condition) => condition.field === "amount");
    const amount = amtCond?.value ? Math.abs(amtCond.value) / 100 : schedule?.amount ?? null;
    const paid = !!schedule?.paid;
    const isPast = !!nextDate && nextDate < today;
    return {
      ...utility,
      found: !!schedule,
      next_date: nextDate,
      amount,
      paid,
      isStale: !!schedule && isPast && !paid,
      isHonored: !!schedule && paid,
    };
  });

  return rows.sort((a, b) => {
    if (!a.next_date && !b.next_date) return 0;
    if (!a.next_date) return 1;
    if (!b.next_date) return -1;
    return a.next_date.localeCompare(b.next_date);
  });
}

export function deriveUtilityDateText(utility) {
  const days = utility.next_date ? daysUntil(utility.next_date) : null;
  const isPastDate = !!utility.next_date && days != null && days < 0;
  return !utility.found
    ? "not found"
    : utility.isHonored && isPastDate
      ? `paid ${formatShortDate(utility.next_date)}`
      : utility.isStale
        ? `last ${formatShortDate(utility.next_date)}`
        : `next ${formatShortDate(utility.next_date)}`;
}
