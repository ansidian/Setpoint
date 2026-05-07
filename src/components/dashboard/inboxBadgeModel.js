import { collectActiveSnapshotEmails, mergeReadState } from "../inbox/helpers.js";

const BADGE_LANES = new Set(["carryover", "needs_attention", "action", "fyi"]);

function emailKey(email) {
  const uid = email?.uid || email?.id;
  return uid ? String(uid) : null;
}

function isBadgeWorthySnapshotEmail(email) {
  if (email?._untriaged) return true;
  return BADGE_LANES.has(email?._lane);
}

export function computeInboxUnreadSignalCount({
  activeSnapshot,
  liveEmails = [],
  resurfacedEntries = [],
  liveReadOverrides = {},
} = {}) {
  const seen = new Set();
  let unread = 0;

  if (activeSnapshot?.snapshot) {
    for (const email of collectActiveSnapshotEmails(activeSnapshot, liveReadOverrides)) {
      const key = emailKey(email);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (isBadgeWorthySnapshotEmail(email) && !email.read) unread += 1;
    }
  }

  const addLiveEmail = (email) => {
    const key = emailKey(email);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (!mergeReadState(email.read, key, liveReadOverrides)) unread += 1;
  };

  for (const email of liveEmails || []) addLiveEmail(email);
  for (const entry of resurfacedEntries || []) addLiveEmail(entry);

  return unread;
}
