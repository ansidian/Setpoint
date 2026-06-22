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

// Per-lane totals for the sidebar/digest. Skips untriaged rows entirely (they
// are the "live" bucket, counted separately) and ignores snooze; `action`
// mirrors `needs_attention`.
export function computeLaneCounts(emails = [], { accountId = "__all" } = {}) {
  const counts = { queued: 0, needs_attention: 0, action: 0, carryover: 0, catch_up: 0, fyi: 0, handled: 0, untriaged_read: 0, noise: 0 };
  for (const email of emails) {
    if (accountId !== "__all" && email._accountKey !== accountId) continue;
    if (email._untriaged) continue;
    if (email._lane in counts) counts[email._lane] += 1;
  }
  counts.action = counts.needs_attention;
  return counts;
}

// Count of untriaged ("live") rows in the current account scope.
export function computeLiveCount(emails = [], { accountId = "__all" } = {}) {
  return emails.filter(
    (email) => email._untriaged && (accountId === "__all" || email._accountKey === accountId),
  ).length;
}

// Mobile chip-bar counts: unlike computeLaneCounts these honor snooze, include a
// running `__all`/`__live` total, and count untriaged rows toward `__live`.
export function computeMobileChipCounts(emails = [], {
  accountId = "__all",
  snoozedMap = new Map(),
  nowTick = Date.now(),
} = {}) {
  const counts = {
    __all: 0,
    __live: 0,
    queued: 0,
    needs_attention: 0,
    action: 0,
    carryover: 0,
    catch_up: 0,
    fyi: 0,
    handled: 0,
    untriaged_read: 0,
    noise: 0,
  };
  for (const email of emails) {
    const uid = email.uid || email.id;
    const snoozeUntil = snoozedMap.get(uid);
    if (snoozeUntil && snoozeUntil > nowTick) continue;
    if (accountId !== "__all" && email._accountKey !== accountId) continue;
    counts.__all += 1;
    if (email._untriaged) counts.__live += 1;
    else if (email._lane && counts[email._lane] != null) counts[email._lane] += 1;
  }
  counts.action = counts.needs_attention;
  return counts;
}

// Unread rows excluding the untriaged_read lane. Used for both the global total
// (over all flat emails) and the in-view total (over the filtered list).
export function computeUnreadCount(emails = []) {
  return emails.filter((email) => email._lane !== "untriaged_read" && !email.read).length;
}
