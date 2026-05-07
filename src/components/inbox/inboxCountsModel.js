export function computeScopedNoiseUnreadCount(emails = [], {
  accountId = "__all",
  categoryFilter = "__all",
  indexedSearchActive = false,
  snoozedMap = new Map(),
  nowTick = Date.now(),
} = {}) {
  if (indexedSearchActive) return 0;

  let count = 0;
  for (const email of emails || []) {
    const uid = email?.uid || email?.id;
    const snoozeUntil = uid ? snoozedMap.get(uid) : null;
    if (snoozeUntil && snoozeUntil > nowTick) continue;
    if (accountId !== "__all" && email?._accountKey !== accountId) continue;
    if (categoryFilter !== "__all" && email?.category !== categoryFilter) continue;
    if (email?._lane === "noise" && !email.read) count += 1;
  }
  return count;
}
