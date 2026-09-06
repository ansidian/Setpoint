import type { InboxEmailLike } from "./inboxTypes";

type LaneCounts = Record<string, number>;

export function computeScopedNoiseUnreadCount(emails: InboxEmailLike[] = [], {
  accountId = "__all",
  indexedSearchActive = false,
  snoozedMap = new Map(),
  nowTick = Date.now(),
}: { accountId?: string; indexedSearchActive?: boolean; snoozedMap?: ReadonlyMap<string | number, number>; nowTick?: number } = {}): number {
  if (indexedSearchActive) return 0;

  let count = 0;
  for (const email of emails || []) {
    const uid = email?.uid || email?.id;
    const snoozeUntil = uid ? snoozedMap.get(uid) : null;
    if (!email._pinned && snoozeUntil && snoozeUntil > nowTick) continue;
    if (accountId !== "__all" && email?._accountKey !== accountId) continue;
    if (email?._lane === "noise" && !email.read) count += 1;
  }
  return count;
}

// Per-lane totals for the sidebar/digest. Ignores snooze; `action` mirrors
// `needs_attention`.
export function computeLaneCounts(emails: InboxEmailLike[] = [], { accountId = "__all" }: { accountId?: string; snoozedMap?: ReadonlyMap<string | number, number> } = {}): LaneCounts {
  const counts: LaneCounts = { queued: 0, needs_attention: 0, action: 0, carryover: 0, catch_up: 0, fyi: 0, handled: 0, untriaged_read: 0, noise: 0 };
  for (const email of emails) {
    if (accountId !== "__all" && email._accountKey !== accountId) continue;
    if (email._lane && email._lane in counts) counts[email._lane] = (counts[email._lane] ?? 0) + 1;
  }
  counts.action = counts.needs_attention ?? 0;
  return counts;
}

// Primary chip-bar counts: unlike computeLaneCounts these honor snooze and
// include a running `__all` total. Shared by desktop and mobile.
export function computeInboxChipCounts(emails: InboxEmailLike[] = [], {
  accountId = "__all",
  snoozedMap = new Map(),
  nowTick = Date.now(),
}: { accountId?: string; snoozedMap?: ReadonlyMap<string | number, number>; nowTick?: number } = {}): LaneCounts {
  const counts: LaneCounts = {
    __all: 0,
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
    const snoozeUntil = uid == null ? null : snoozedMap.get(uid);
    if (!email._pinned && snoozeUntil && snoozeUntil > nowTick) continue;
    if (accountId !== "__all" && email._accountKey !== accountId) continue;
    counts.__all = (counts.__all ?? 0) + 1;
    if (email._lane && counts[email._lane] != null) counts[email._lane] = (counts[email._lane] ?? 0) + 1;
  }
  counts.action = counts.needs_attention ?? 0;
  return counts;
}

// Unread rows excluding the untriaged_read lane. Used for both the global total
// (over all flat emails) and the in-view total (over the filtered list).
export function computeUnreadCount(emails: InboxEmailLike[] = []): number {
  return emails.filter((email) => email._lane !== "untriaged_read" && !email.read).length;
}
