import { collectActiveSnapshotEmails, mergeReadState } from "../inbox/helpers.js";

const BADGE_LANES = new Set(["queued", "carryover", "needs_attention", "action", "catch_up", "fyi"]);

function emailKey(email) {
  const uid = email?.uid || email?.id;
  return uid ? String(uid) : null;
}

function addReadOverrideKey(keys, value) {
  const key = value?.uid || value?.email_id || value?.id;
  if (key) keys.add(String(key));
}

function isBadgeWorthySnapshotEmail(email) {
  if (email?._untriaged) return true;
  return BADGE_LANES.has(email?._lane);
}

export function collectActiveReadOverrideKeys({
  activeSnapshotView,
  liveEmails = [],
  resurfacedEntries = [],
}) {
  const keys = new Set();

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
