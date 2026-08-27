import { SNAPSHOT_LANE_ORDER } from "./activeSnapshotWorkflowModel";
import type { InboxEmailLike } from "./inboxTypes";

export interface SelectVisibleEmailsOptions {
  flatEmails?: InboxEmailLike[];
  indexedSearchActive?: boolean;
  indexedSearchEmails?: InboxEmailLike[];
  accountId?: string;
  lane?: string;
  snoozedMap?: ReadonlyMap<string | number, number>;
  nowTick?: number;
}

// Projects the row list the inbox actually renders: during an indexed search the
// server results win wholesale (returned by reference so EmailRow's memo holds);
// otherwise the flat live/snapshot list is filtered by snooze/account/category/
// lane scope and sorted by lane order, then newest-first
// (resurfaced time taking priority over the raw date). Pinned rows are the
// always-visible overlay: they bypass the snooze/lane/category scopes (account
// scope still applies) and sort ahead of everything, newest pin first.
export function selectVisibleEmails({
  flatEmails = [],
  indexedSearchActive = false,
  indexedSearchEmails = [],
  accountId = "__all",
  lane = "__all",
  snoozedMap = new Map(),
  nowTick = Date.now(),
}: SelectVisibleEmailsOptions = {}): InboxEmailLike[] {
  if (indexedSearchActive) return indexedSearchEmails;
  return flatEmails.filter((email) => {
    if (accountId !== "__all" && email._accountKey !== accountId) return false;
    if (email._pinned) return true;
    const uid = email.uid || email.id;
    const snoozeUntil = uid == null ? null : snoozedMap.get(uid);
    if (snoozeUntil && snoozeUntil > nowTick) return false;
    if (lane !== "__all" && email._lane !== lane) return false;
    return true;
  }).sort((a, b) => {
    if (!!a._pinned !== !!b._pinned) return a._pinned ? -1 : 1;
    if (a._pinned && b._pinned) return (b._pinnedAt || 0) - (a._pinnedAt || 0);
    const aLaneOrder = a._lane ? SNAPSHOT_LANE_ORDER[a._lane] : undefined;
    const bLaneOrder = b._lane ? SNAPSHOT_LANE_ORDER[b._lane] : undefined;
    if (aLaneOrder !== bLaneOrder) {
      return (aLaneOrder ?? 4) - (bLaneOrder ?? 4);
    }
    const aKey = a._resurfacedAt || new Date(a.date || 0).getTime();
    const bKey = b._resurfacedAt || new Date(b.date || 0).getTime();
    return bKey - aKey;
  });
}
