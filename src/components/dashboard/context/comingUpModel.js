import { daysUntil } from "../../../lib/bill-utils";

function chipFor(days) {
  if (days === 0) return { chipLabel: "Today", chipTone: "rose" };
  if (days === 1) return { chipLabel: "Tomorrow", chipTone: "cream" };
  return { chipLabel: `In ${days}d`, chipTone: "muted" };
}

function asDeadlineList(liveDeadlines) {
  if (Array.isArray(liveDeadlines)) return liveDeadlines;
  return liveDeadlines?.upcoming || [];
}

// Merge upcoming deadlines + unpaid bills into one next-`days`-day list, sorted
// soonest-first, each carrying a time-anchored StatusChip label/tone. Pure: all
// "today" math flows through daysUntil (Pacific-day anchored).
export function buildComingUp({ liveDeadlines, liveBills, days = 7 } = {}) {
  const rows = [];

  for (const d of asDeadlineList(liveDeadlines)) {
    if (d?.status === "complete") continue;
    const n = daysUntil(d?.due_date);
    if (n == null || n < 0 || n > days) continue;
    rows.push({
      id: `deadline:${d.id}`, kind: "deadline", title: d.title || "",
      meta: d.class_name || d.project_name || "Deadline", sortDays: n, ...chipFor(n),
    });
  }

  for (const b of liveBills || []) {
    if (b?.paid) continue;
    const n = daysUntil(b?.next_date);
    if (n == null || n < 0 || n > days) continue;
    const amount = `$${Number(b.amount || 0).toFixed(2)}`;
    rows.push({
      id: `bill:${b.id}`, kind: "bill", title: b.name || "",
      meta: b.payee ? `${amount} · ${b.payee}` : amount, sortDays: n, ...chipFor(n),
    });
  }

  rows.sort((a, b) => {
    if (a.sortDays !== b.sortDays) return a.sortDays - b.sortDays;
    if (a.kind !== b.kind) return a.kind === "deadline" ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  return rows;
}
