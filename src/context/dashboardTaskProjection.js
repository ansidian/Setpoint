const EMPTY_TODOIST_STATS = {
  incomplete: 0,
  dueToday: 0,
  dueThisWeek: 0,
  totalPoints: 0,
};

export const EMPTY_DEADLINES = {
  ctm: { upcoming: [], stats: null },
  todoist: { upcoming: [], stats: null },
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

export function taskMatches(task, taskId, section = null) {
  if (task?._tombstone || String(task?.id) !== String(taskId)) return false;
  if (section === "todoist") return task.source === "todoist";
  if (section === "ctm") return task.source !== "todoist";
  return true;
}

function ensureTodoistSection(root) {
  if (!root.todoist) {
    root.todoist = { upcoming: [], stats: { ...EMPTY_TODOIST_STATS } };
  }
  if (!Array.isArray(root.todoist.upcoming)) root.todoist.upcoming = [];
  return root.todoist;
}

function recalculateTodoistStats(root, { now = new Date(), skipCompleteForDueCounts = true } = {}) {
  if (!root?.todoist?.upcoming) return root;
  const { today, weekFromNow } = dateWindow(now);
  let dueToday = 0;
  let dueThisWeek = 0;
  for (const task of root.todoist.upcoming) {
    if (task._tombstone) continue;
    if (skipCompleteForDueCounts && task.status === "complete") continue;
    if (task.due_date === today) dueToday += 1;
    if (task.due_date >= today && task.due_date <= weekFromNow) dueThisWeek += 1;
  }
  root.todoist.stats = {
    incomplete: root.todoist.upcoming.filter((task) => !task._tombstone && task.status !== "complete").length,
    dueToday,
    dueThisWeek,
    totalPoints: 0,
  };
  return root;
}

function recalculateSectionStats(root, section, { now = new Date() } = {}) {
  if (!root?.[section]?.upcoming) return root;
  const { today, weekFromNow } = dateWindow(now);
  let totalPoints = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let incomplete = 0;
  for (const task of root[section].upcoming) {
    if (task.status !== "complete") incomplete += 1;
    if (task.due_date === today) dueToday += 1;
    if (task.due_date >= today && task.due_date <= weekFromNow) dueThisWeek += 1;
    if (task.points_possible) totalPoints += task.points_possible;
  }
  root[section].stats = { incomplete, dueToday, dueThisWeek, totalPoints };
  return root;
}

export function applyTodoistTaskUpsert(root, task, { merge = false, now = new Date() } = {}) {
  if (!root || !task?.id) return root;
  const updated = clone(root);
  const todoist = ensureTodoistSection(updated);
  const index = todoist.upcoming.findIndex(
    (entry) => !entry._tombstone && String(entry.id) === String(task.id),
  );
  if (index >= 0) {
    todoist.upcoming[index] = merge ? { ...todoist.upcoming[index], ...task } : task;
  } else {
    todoist.upcoming.push(task);
  }
  return recalculateTodoistStats(updated, { now });
}

export function applyTodoistTaskDelete(root, taskId, { now = new Date() } = {}) {
  if (!root?.todoist?.upcoming) return root;
  const updated = clone(root);
  updated.todoist.upcoming = updated.todoist.upcoming.filter(
    (task) => task._tombstone || String(task.id) !== String(taskId),
  );
  return recalculateTodoistStats(updated, { now });
}

export function applyTaskCompleting(root, taskId, sectionName) {
  if (!root) return root;
  const updated = clone(root);
  for (const section of sectionName ? [sectionName] : ["ctm", "todoist"]) {
    const task = updated[section]?.upcoming?.find((entry) => taskMatches(entry, taskId, section));
    if (task) task._completing = true;
  }
  return updated;
}

export function clearTaskCompleting(root, taskId, sectionName) {
  if (!root) return root;
  const updated = clone(root);
  for (const section of sectionName ? [sectionName] : ["ctm", "todoist"]) {
    const task = updated[section]?.upcoming?.find((entry) => taskMatches(entry, taskId, section));
    if (task) delete task._completing;
  }
  return updated;
}

export function applyTaskComplete(root, taskId, sectionName = null, { now = new Date() } = {}) {
  if (!root) return root;
  const updated = clone(root);
  for (const section of sectionName ? [sectionName] : ["ctm", "todoist"]) {
    if (!updated[section]?.upcoming) continue;
    const task = updated[section].upcoming.find((entry) => taskMatches(entry, taskId, section));
    if (task) {
      task.status = "complete";
      delete task._completing;
    }
    recalculateSectionStats(updated, section, { now });
  }
  return updated;
}

export function applyTaskStatus(root, taskId, status, sectionName = "ctm") {
  if (!root) return root;
  const updated = clone(root);
  for (const section of [sectionName]) {
    const task = updated[section]?.upcoming?.find((entry) => taskMatches(entry, taskId, section));
    if (task) task.status = status;
  }
  return updated;
}

export function dismissTodoistTombstone(root, todoistId, { now = new Date() } = {}) {
  if (!root?.todoist?.upcoming) return root;
  const updated = clone(root);
  updated.todoist.upcoming = updated.todoist.upcoming.filter(
    (task) => !(task._tombstone && task.id === todoistId),
  );
  return recalculateTodoistStats(updated, { now, skipCompleteForDueCounts: false });
}
