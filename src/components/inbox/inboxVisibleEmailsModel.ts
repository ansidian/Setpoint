import { compareDesktopInboxEmails } from "./inboxDisplayModel";
import type { InboxEmailLike } from "./inboxTypes";

export interface SelectVisibleEmailsOptions {
  flatEmails?: InboxEmailLike[];
  indexedSearchActive?: boolean;
  indexedSearchEmails?: InboxEmailLike[];
  accountId?: string;
  lane?: string;
  snoozedMap?: ReadonlyMap<string | number, number>;
  nowTick?: number;
  sortOrder?: "lane" | "newest";
  unreadOnly?: boolean;
}

// Projects the rows used by the list, mark-all and reader advancement. Desktop
// preserves indexed-result order or sorts live/snapshot rows by lane and
// resurfaced recency. Mobile uses message date across lanes and can narrow the
// current source to unread rows. Pins bypass snooze/lane scopes, but respect
// account and unread filters. Desktop Queued precedes Pins; mobile remains pinned-first.
export function selectVisibleEmails({
  flatEmails = [],
  indexedSearchActive = false,
  indexedSearchEmails = [],
  accountId = "__all",
  lane = "__all",
  snoozedMap = new Map(),
  nowTick = Date.now(),
  sortOrder = "lane",
  unreadOnly = false,
}: SelectVisibleEmailsOptions = {}): InboxEmailLike[] {
  if (indexedSearchActive && sortOrder === "lane" && !unreadOnly) return indexedSearchEmails;
  const sourceEmails = indexedSearchActive ? indexedSearchEmails : flatEmails;
  const filteredEmails = sourceEmails.filter((email) => {
    if (unreadOnly && (email.read || email._lane === "untriaged_read")) return false;
    // Search owns its scope; local filters only narrow its returned rows.
    if (indexedSearchActive) return true;
    if (accountId !== "__all" && email._accountKey !== accountId) return false;
    if (email._pinned) return true;
    const uid = email.uid || email.id;
    const snoozeUntil = uid == null ? null : snoozedMap.get(uid);
    if (snoozeUntil && snoozeUntil > nowTick) return false;
    if (lane !== "__all" && email._lane !== lane) return false;
    return true;
  });
  if (indexedSearchActive && sortOrder === "lane") return filteredEmails;
  return filteredEmails.sort((a, b) => {
    if (sortOrder === "lane") return compareDesktopInboxEmails(a, b);
    if (!!a._pinned !== !!b._pinned) return a._pinned ? -1 : 1;
    if (a._pinned && b._pinned) return (b._pinnedAt || 0) - (a._pinnedAt || 0);
    const aDate = new Date(a.date || 0).getTime() || 0;
    const bDate = new Date(b.date || 0).getTime() || 0;
    return bDate - aDate;
  });
}
