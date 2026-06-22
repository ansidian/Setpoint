import { SNAPSHOT_LANE_ORDER } from "./activeSnapshotWorkflowModel.js";

// Projects the row list the inbox actually renders: during an indexed search the
// server results win wholesale (returned by reference so EmailRow's memo holds);
// otherwise the flat live/snapshot list is filtered by snooze/account/category/
// lane scope and sorted untriaged-first, then by lane order, then newest-first
// (resurfaced time taking priority over the raw date).
export function selectVisibleEmails({
  flatEmails = [],
  indexedSearchActive = false,
  indexedSearchEmails = [],
  accountId = "__all",
  categoryFilter = "__all",
  lane = "__all",
  snoozedMap = new Map(),
  nowTick = Date.now(),
} = {}) {
  if (indexedSearchActive) return indexedSearchEmails;
  return flatEmails.filter((email) => {
    const uid = email.uid || email.id;
    const snoozeUntil = snoozedMap.get(uid);
    if (snoozeUntil && snoozeUntil > nowTick) return false;
    if (accountId !== "__all" && email._accountKey !== accountId) return false;
    if (categoryFilter !== "__all" && email.category !== categoryFilter) return false;
    if (lane === "__live" && !email._untriaged) return false;
    if (lane !== "__all" && lane !== "__live" && email._lane !== lane) return false;
    return true;
  }).sort((a, b) => {
    if (a._untriaged && !b._untriaged) return -1;
    if (!a._untriaged && b._untriaged) return 1;
    if (SNAPSHOT_LANE_ORDER[a._lane] !== SNAPSHOT_LANE_ORDER[b._lane]) {
      return (SNAPSHOT_LANE_ORDER[a._lane] ?? 4) - (SNAPSHOT_LANE_ORDER[b._lane] ?? 4);
    }
    const aKey = a._resurfacedAt || new Date(a.date).getTime();
    const bKey = b._resurfacedAt || new Date(b.date).getTime();
    return bKey - aKey;
  });
}
