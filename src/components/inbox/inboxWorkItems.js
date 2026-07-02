import { snapshotInboxLaneForItem } from "./activeSnapshotWorkflowModel.js";
import { buildInboxRow } from "./inboxRow.js";

export { mergeReadState, readOverrideForUid, composeReadOverrides } from "./inboxRow.js";

// Build a `synthAccount(source)` function bound to the inbox account list.
// Matches a live/resurfaced/pin-snapshot entry's account_label to an existing
// inbox account so the sidebar groups them correctly, else synthesizes a
// minimal account record. Built once per flatEmails recompute so the inner
// lookup can be a Map get.
export function makeSynthAccount(emailAccounts) {
  const accountByName = new Map(emailAccounts.map((a) => [a.name, a]));
  return (source) => accountByName.get(source.account_label) || {
    name: source.account_label || "Live",
    color: source.account_color || "#89b4fa",
    icon: source.account_icon || "Mail",
    important: [],
    noise: [],
  };
}

export function isCatchUpEmail(email) {
  return email?._lane === "catch_up"
    || email?.lane === "catch_up"
    || email?._catchUp
    || email?.source === "catch_up";
}

export function pendingSecurityGraceLabel(classifyAtMs, nowMs = Date.now()) {
  if (!Number.isFinite(classifyAtMs)) return "Triage delayed";
  const remainingMs = classifyAtMs - nowMs;
  if (remainingMs <= 0) return "Classifying";
  if (remainingMs <= 60_000) return "Classifying in <1m";
  if (remainingMs <= 2 * 60_000) return "Classifying soon";
  return "Triage delayed";
}

export function collectActiveSnapshotEmails(activeSnapshot, liveReadOverrides = {}) {
  if (!activeSnapshot?.snapshot) return [];
  const accountMap = new Map((activeSnapshot.filters?.accounts || []).map((account) => [
    account.account_id,
    {
      id: account.account_id,
      account_id: account.account_id,
      name: account.label || account.email || account.account_id,
      email: account.email || "",
      color: account.color || "#cba6da",
      icon: account.icon || "Mail",
      unread: account.count || 0,
      important: [],
      noise: [],
    },
  ]));
  const rows = [
    ...(activeSnapshot.lanes?.queued || []),
    ...(activeSnapshot.carryover || []).map((item) => ({ ...item, _snapshotCarryover: true })),
    ...(activeSnapshot.lanes?.needs_attention || []),
    ...(activeSnapshot.lanes?.catch_up || []).map((item) => ({ ...item, _snapshotCatchUp: true })),
    ...(activeSnapshot.lanes?.fyi || []),
    ...(activeSnapshot.lanes?.handled || []),
    ...(activeSnapshot.lanes?.untriaged_read || []),
    ...(activeSnapshot.lanes?.noise || []),
  ];

  return rows.map((item) => {
    const uid = item.uid || item.email_id || item.id;
    const resurfaced = item.source === "resurfaced_snooze" || item._resurfaced;
    const pendingSecurityGrace = item.source === "pending_security_grace";
    const arrivalGraceQueued = item.lane === "queued" || item.source === "arrival_grace";
    const untriagedRead = item.lane === "untriaged_read" || item.source === "arrival_grace_read";
    const catchUp = item._snapshotCatchUp || item.lane === "catch_up" || item.source === "catch_up";
    const resurfacedAt = item.resurfaced_at || item._resurfacedAt || (item.source_at ? Date.parse(item.source_at) : null);
    const pendingSecurityGraceAt = pendingSecurityGrace && item.source_at ? Date.parse(item.source_at) : null;
    const account = accountMap.get(item.account_id) || {
      id: item.account_id,
      account_id: item.account_id,
      name: item.account_label || item.account_email || item.account_id,
      email: item.account_email || "",
      color: item.account_color || "#cba6da",
      icon: item.account_icon || "Mail",
      important: [],
      noise: [],
    };
    const lane = snapshotInboxLaneForItem(item);
    return buildInboxRow(item, {
      uid: String(uid),
      id: String(uid),
      account,
      read: item.read,
      readOverrides: liveReadOverrides,
      forceRead: untriagedRead,
      lane: catchUp ? "catch_up" : item.lane,
      displayLane: lane,
      activeSnapshot: true,
      untriaged: resurfaced || pendingSecurityGrace,
      resurfaced,
      resurfacedAt,
      extras: {
        snapshot_item_id: item.snapshot_item_id || item.id,
        account_label: account.name,
        account_email: account.email,
        account_color: account.color,
        account_icon: account.icon,
        _carryover: lane === "carryover",
        _catchUp: lane === "catch_up",
        _arrivalGraceQueued: arrivalGraceQueued,
        _untriagedRead: untriagedRead,
        _pendingSecurityGrace: pendingSecurityGrace,
        _pendingSecurityGraceAt: pendingSecurityGraceAt,
        // The human countdown label is computed live in EmailRow / LiveEmailNotice
        // from _pendingSecurityGraceAt + the controller's nowTick, so it advances
        // on each tick instead of freezing at row-build time.
        urgentFlag: item.escalation_badge
          ? { label: item.escalation_badge }
          : item.urgency === "high"
            ? { label: "High" }
            : item.urgentFlag,
      },
    });
  });
}

// Build entries for live-polled emails that are not yet attached to the active
// snapshot. Merges resurfaced metadata when a live uid is also
// present in resurfacedMap — Gmail's `newer_than:Nh` poll re-fetches
// recently-woken snoozes on its own; without this merge the live entry wins
// dedup and the Snoozed badge / wake-time sort would be lost.
export function collectLiveEmails(liveEmails, synthAccount, liveTrashedUids, liveReadOverrides, resurfacedMap) {
  const out = [];
  for (const e of liveEmails) {
    if (liveTrashedUids.has(e.uid)) continue;
    const acc = synthAccount(e);
    const resurfacedHit = resurfacedMap.get(e.uid);
    out.push(buildInboxRow(e, {
      uid: e.uid,
      id: e.id || e.uid,
      account: acc,
      read: e.read,
      readOverrides: liveReadOverrides,
      live: true,
      untriaged: true,
      resurfaced: !!resurfacedHit,
      resurfacedAt: resurfacedHit ? resurfacedHit.resurfaced_at : null,
    }));
  }
  return out;
}

// Inject resurfaced snapshots (snooze woke up). Gmail's live-poll filter
// uses original internalDate so these wouldn't reach the inbox on their own.
// Caller dedups against previously-collected sources; this drops entries with
// no key or that the user has locally trashed.
export function collectResurfaced(resurfacedMap, synthAccount, liveReadOverrides, liveTrashedUids) {
  const out = [];
  for (const entry of resurfacedMap.values()) {
    const snap = entry.snapshot;
    const key = snap?.uid || snap?.id;
    if (!key) continue;
    if (liveTrashedUids.has(key)) continue;
    const acc = synthAccount(snap);
    out.push(buildInboxRow(snap, {
      uid: key,
      id: snap.id || snap.uid,
      account: acc,
      // entry.read is Gmail's current UNREAD state as of this poll (server-side
      // probe). A session override wins in both directions so mark-unread and
      // re-read actions stay visible before the next live poll lands.
      read: entry.read,
      readOverrides: liveReadOverrides,
      live: true,
      untriaged: true,
      resurfaced: true,
      resurfacedAt: entry.resurfaced_at,
    }));
  }
  return out;
}

// Inject pinned overlay entries (see docs/exec-plans/active/2026-07-01-pinned-emails-design.md).
// Pins live outside snapshots; these rows carry _pinned/_pinnedAt so the
// projection can render the Pinned section without touching snapshot state.
export function collectPinned(pinnedEntries, synthAccount, liveReadOverrides) {
  const out = [];
  for (const entry of pinnedEntries || []) {
    if (!entry?.uid) continue;
    const acc = synthAccount(entry);
    out.push(buildInboxRow(entry, {
      uid: entry.uid,
      id: entry.uid,
      account: acc,
      read: entry.read,
      readOverrides: liveReadOverrides,
      lane: entry.lane || undefined,
      extras: {
        _pinned: true,
        _pinnedAt: entry.pinned_at ? Date.parse(entry.pinned_at) : 0,
        _providerRemoved: entry.provider_state === "archived" || entry.provider_state === "deleted",
      },
    }));
  }
  return out;
}

// Dedup rule: an email both pinned and present in the current list appears ONCE,
// as its existing row decorated with the pin flags — keeping snapshot_item_id so
// lane actions still route. Pinned-only rows (origin in a frozen snapshot) append.
export function mergePinnedIntoFlat(flatRows, pinnedRows) {
  if (!pinnedRows?.length) return flatRows;
  const pinnedByUid = new Map(pinnedRows.map((row) => [row.uid || row.id, row]));
  const decorated = new Set();
  const out = flatRows.map((row) => {
    const key = row.uid || row.id;
    const pinRow = pinnedByUid.get(key);
    if (!pinRow) return row;
    decorated.add(key);
    return { ...row, _pinned: true, _pinnedAt: pinRow._pinnedAt };
  });
  for (const pinRow of pinnedRows) {
    if (!decorated.has(pinRow.uid || pinRow.id)) out.push(pinRow);
  }
  return out;
}

// Shapes a client-side buildEmailSnapshot() capture into the PinnedEntry shape
// loadPinnedEntries returns, for optimistic pins before the next payload refresh.
export function pinnedEntryFromSnapshot(uid, pinnedAtMs, snap = {}) {
  return {
    uid,
    pinned_at: new Date(pinnedAtMs).toISOString(),
    account_id: snap.account_id || null,
    subject: snap.subject ?? "",
    from_name: snap.from ?? "",
    from_address: snap.from_email ?? "",
    preview: snap.preview ?? "",
    date: snap.date ?? null,
    read: !!snap.read,
    account_label: snap.account_label || null,
    account_email: snap.account_email || null,
    account_color: snap.account_color || null,
    account_icon: snap.account_icon || null,
    lane: null,
    urgency: snap.urgency ?? null,
    category: null,
    handled_at: null,
    provider_state: null,
  };
}
