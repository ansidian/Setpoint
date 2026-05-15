const EMPTY_DEADLINE_STATS = {
  incomplete: 0,
  dueToday: 0,
  dueThisWeek: 0,
  totalPoints: 0,
};

export const EMPTY_DEADLINES = {
  upcoming: [],
  stats: null,
};

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function localDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(date);
}

function dateWindow(now = new Date()) {
  const start = new Date(now);
  const end = new Date(now.getTime() + 7 * 86400000);
  return {
    today: localDate(start),
    weekFromNow: localDate(end),
  };
}

export function deadlineMatches(deadline, deadlineId) {
  if (deadline?._tombstone || String(deadline?.id) !== String(deadlineId)) return false;
  return true;
}

function ensureDeadlineRoot(root) {
  if (!root) return { upcoming: [], stats: { ...EMPTY_DEADLINE_STATS } };
  if (!Array.isArray(root.upcoming)) root.upcoming = [];
  if (!root.stats) root.stats = { ...EMPTY_DEADLINE_STATS };
  return root;
}

function recalculateDeadlineStats(root, { now = new Date(), skipCompleteForDueCounts = true } = {}) {
  if (!root?.upcoming) return root;
  const { today, weekFromNow } = dateWindow(now);
  let dueToday = 0;
  let dueThisWeek = 0;
  for (const deadline of root.upcoming) {
    if (deadline._tombstone) continue;
    if (skipCompleteForDueCounts && deadline.status === "complete") continue;
    if (deadline.due_date === today) dueToday += 1;
    if (deadline.due_date >= today && deadline.due_date <= weekFromNow) dueThisWeek += 1;
  }
  root.stats = {
    incomplete: root.upcoming.filter((deadline) => !deadline._tombstone && deadline.status !== "complete").length,
    dueToday,
    dueThisWeek,
    totalPoints: 0,
  };
  return root;
}

export function applyDeadlineUpsert(root, deadline, { merge = false, now = new Date() } = {}) {
  if (!deadline?.id) return root;
  const updated = clone(root || EMPTY_DEADLINES);
  const deadlines = ensureDeadlineRoot(updated);
  const index = deadlines.upcoming.findIndex(
    (entry) => !entry._tombstone && String(entry.id) === String(deadline.id),
  );
  if (index >= 0) {
    deadlines.upcoming[index] = merge ? { ...deadlines.upcoming[index], ...deadline } : deadline;
  } else {
    deadlines.upcoming.push(deadline);
  }
  return recalculateDeadlineStats(updated, { now, skipCompleteForDueCounts: false });
}

export function applyDeadlineDelete(root, deadlineId, { now = new Date() } = {}) {
  if (!root?.upcoming) return root;
  const updated = clone(root);
  updated.upcoming = updated.upcoming.filter(
    (deadline) => deadline._tombstone || String(deadline.id) !== String(deadlineId),
  );
  return recalculateDeadlineStats(updated, { now, skipCompleteForDueCounts: false });
}

export function applyDeadlineCompleting(root, deadlineId) {
  if (!root) return root;
  const updated = clone(root);
  const deadline = updated.upcoming?.find((entry) => deadlineMatches(entry, deadlineId));
  if (deadline) deadline._completing = true;
  return updated;
}

export function clearDeadlineCompleting(root, deadlineId) {
  if (!root) return root;
  const updated = clone(root);
  const deadline = updated.upcoming?.find((entry) => deadlineMatches(entry, deadlineId));
  if (deadline) delete deadline._completing;
  return updated;
}

export function applyDeadlineComplete(root, deadlineId, { now = new Date() } = {}) {
  if (!root) return root;
  const updated = clone(root);
  const deadline = updated.upcoming?.find((entry) => deadlineMatches(entry, deadlineId));
  if (deadline) {
    deadline.status = "complete";
    delete deadline._completing;
  }
  return recalculateDeadlineStats(updated, { now, skipCompleteForDueCounts: false });
}
