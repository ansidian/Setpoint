export function carryForwardCompletedTodoist(newList, prevList, boundary) {
  if (!prevList?.length) return newList;
  const keyOf = (task) => `${task.id}:${task.due_date}`;
  const keys = new Set(newList.map(keyOf));
  const carried = [];
  for (const task of prevList) {
    if (task.status !== "complete" || task._tombstone) continue;
    if (!task.due_date || task.due_date < boundary) continue;
    const key = keyOf(task);
    if (keys.has(key)) continue;
    carried.push(task);
    keys.add(key);
  }
  return carried.length ? [...newList, ...carried] : newList;
}

export function computeDeadlineStats(deadlines) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });
  const today = fmt.format(new Date());
  const weekFromNow = fmt.format(new Date(Date.now() + 7 * 86400000));
  let totalPoints = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let incomplete = 0;

  for (const deadline of deadlines) {
    if (deadline.status !== "complete") incomplete++;
    if (deadline.due_date === today) dueToday++;
    if (deadline.due_date >= today && deadline.due_date <= weekFromNow) dueThisWeek++;
    if (deadline.points_possible) totalPoints += deadline.points_possible;
  }

  return { incomplete, dueToday, dueThisWeek, totalPoints };
}
