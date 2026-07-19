import { collectActiveSnapshotEmails, mergeReadState } from "../inbox/helpers";
import type { ActiveSnapshotView } from "../../../shared/types/snapshots";
import type { InboxEmailLike } from "../inbox/inboxTypes";

type ReadOverrideMap = Record<string, boolean>;
export type DashboardEmail = InboxEmailLike & {
  id?: string | number;
  email_id?: string | null;
  uid?: string | null;
  read?: boolean;
  lane?: string | null;
  _untriaged?: boolean;
  _lane?: string | null;
};
type ResurfacedEmail = DashboardEmail & { snapshot?: DashboardEmail };
type ActiveSnapshotLike = {
  snapshot?: ActiveSnapshotView["snapshot"] | { id: number } | null;
  filters?: {
    accounts?: Array<Partial<ActiveSnapshotView["filters"]["accounts"][number]>>;
    categories?: Array<Partial<ActiveSnapshotView["filters"]["categories"][number]>>;
  };
  carryover?: DashboardEmail[];
  lanes?: Partial<Record<string, DashboardEmail[]>>;
};
export type ActiveSnapshotInput = ActiveSnapshotView | ActiveSnapshotLike;

const BADGE_LANES = new Set(["queued", "carryover", "needs_attention", "action", "catch_up", "fyi"]);

function emailKey(email?: DashboardEmail | null) {
  const uid = email?.uid || email?.id;
  return uid ? String(uid) : null;
}

function addReadOverrideKey(keys: Set<string>, value?: DashboardEmail | null) {
  const key = value?.uid || value?.email_id || value?.id;
  if (key) keys.add(String(key));
}

function isBadgeWorthySnapshotEmail(email: DashboardEmail) {
  if (email?._untriaged) return true;
  return email._lane ? BADGE_LANES.has(email._lane) : false;
}

export function collectActiveReadOverrideKeys({
  activeSnapshotView,
  liveEmails = [],
  resurfacedEntries = [],
}: {
  activeSnapshotView: ActiveSnapshotInput | null;
  liveEmails?: DashboardEmail[];
  resurfacedEntries?: ResurfacedEmail[];
}) {
  const keys = new Set<string>();

  for (const email of liveEmails || []) addReadOverrideKey(keys, email);
  for (const entry of resurfacedEntries || []) {
    addReadOverrideKey(keys, entry);
    addReadOverrideKey(keys, entry?.snapshot);
  }

  if (activeSnapshotView?.snapshot) {
    for (const item of activeSnapshotView.carryover || []) addReadOverrideKey(keys, item);
    for (const lane of Object.values(activeSnapshotView.lanes || {})) {
      for (const item of lane || []) addReadOverrideKey(keys, item);
    }
  }

  return keys;
}

export function computeInboxUnreadSignalCount({
  activeSnapshot,
  liveEmails = [],
  resurfacedEntries = [],
  liveReadOverrides = {},
}: {
  activeSnapshot?: ActiveSnapshotInput | null;
  liveEmails?: DashboardEmail[];
  resurfacedEntries?: ResurfacedEmail[];
  liveReadOverrides?: ReadOverrideMap;
} = {}) {
  const seen = new Set<string>();
  let unread = 0;

  if (activeSnapshot?.snapshot) {
    for (const email of collectActiveSnapshotEmails(activeSnapshot, liveReadOverrides)) {
      const key = emailKey(email);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (isBadgeWorthySnapshotEmail(email) && !email.read) unread += 1;
    }
  }

  const addLiveEmail = (email: DashboardEmail) => {
    const key = emailKey(email);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (!mergeReadState(email.read, key, liveReadOverrides)) unread += 1;
  };

  for (const email of liveEmails || []) addLiveEmail(email);
  for (const entry of resurfacedEntries || []) addLiveEmail(entry);

  return unread;
}
