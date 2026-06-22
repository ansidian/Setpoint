// Where a "mark read" for one email has to be applied. The same three-way
// routing was duplicated (and risked drifting) in the controller's
// `markAllVisibleRead` and its 500ms auto-mark-read effect:
//   - live rows reconcile through the session-wide live read-override map
//   - active-snapshot rows reconcile the same way, but only when they carry a uid
//   - everything else is an indexed-search hit, toggled in local search state
export const READ_SCOPE = {
  LIVE: "live",
  SNAPSHOT: "snapshot",
  INDEXED: "indexed",
};

export function resolveReadScope(email) {
  if (email?._live) return READ_SCOPE.LIVE;
  if (email?._activeSnapshot && email?.uid) return READ_SCOPE.SNAPSHOT;
  return READ_SCOPE.INDEXED;
}

// Plans the bulk "mark everything visible read" action. `overrideUids` are the
// live/snapshot rows whose read state flows through the live override map;
// `allUids` are every unread row with a uid (these also hit the bulk API + local
// search read state). Live and snapshot overrides are idempotent map writes, so
// collapsing the original two-pass loop into one preserves the resulting state.
export function planMarkAllVisibleRead(visibleEmails = []) {
  const unread = visibleEmails.filter((email) => !email.read);
  const overrideUids = [];
  for (const email of unread) {
    const scope = resolveReadScope(email);
    if ((scope === READ_SCOPE.LIVE || scope === READ_SCOPE.SNAPSHOT) && email.uid) {
      overrideUids.push(email.uid);
    }
  }
  const allUids = unread.map((email) => email.uid).filter(Boolean);
  return { unread, overrideUids, allUids };
}
