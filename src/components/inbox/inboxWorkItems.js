import { snapshotInboxLaneForItem } from "./activeSnapshotWorkflowModel.js";

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

export function readOverrideForUid(readOverrides, uid) {
  if (!uid || !readOverrides) return null;
  if (readOverrides instanceof Map) {
    return readOverrides.has(uid) ? readOverrides.get(uid) : null;
  }
  return Object.prototype.hasOwnProperty.call(readOverrides, uid)
    ? readOverrides[uid]
    : null;
}

export function mergeReadState(read, uid, readOverrides) {
  const override = readOverrideForUid(readOverrides, uid);
  return override == null ? !!read : !!override;
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

export function collectActiveSnapshotEmails(activeSnapshot, liveReadOverrides = {}, { nowMs = Date.now() } = {}) {
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
    return {
      ...item,
      snapshot_item_id: item.snapshot_item_id || item.id,
      id: String(uid),
      uid: String(uid),
      subject: item.subject || "",
      from: item.from || item.from_name || item.from_address || "Unknown",
      fromEmail: item.fromEmail || item.from_email || item.from_address || "",
      from_email: item.from_email || item.fromEmail || item.from_address || "",
      preview: item.preview || item.summary || "",
      body_preview: item.body_preview || item.preview || item.summary || "",
      date: item.date || item.email_date,
      read: untriagedRead ? true : mergeReadState(item.read, uid, liveReadOverrides),
      account_id: item.account_id,
      account_label: account.name,
      account_email: account.email,
      account_color: account.color,
      account_icon: account.icon,
      _accountKey: account.id || account.name,
      _account: account,
      lane: catchUp ? "catch_up" : item.lane,
      _lane: lane,
      _untriaged: resurfaced || pendingSecurityGrace,
      _live: false,
      _activeSnapshot: true,
      _carryover: lane === "carryover",
      _catchUp: lane === "catch_up",
      _arrivalGraceQueued: arrivalGraceQueued,
      _untriagedRead: untriagedRead,
      _resurfaced: resurfaced,
      _resurfacedAt: resurfacedAt,
      _pendingSecurityGrace: pendingSecurityGrace,
      _pendingSecurityGraceAt: pendingSecurityGraceAt,
      _pendingSecurityGraceLabel: pendingSecurityGrace
        ? pendingSecurityGraceLabel(pendingSecurityGraceAt, nowMs)
        : null,
      urgentFlag: item.escalation_badge
        ? { label: item.escalation_badge }
        : item.urgency === "high"
          ? { label: "High" }
          : item.urgentFlag,
    };
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
    out.push({
      ...e,
      id: e.id || e.uid,
      preview: e.preview || e.body_preview || "",
      fromEmail: e.fromEmail || e.from_email,
      read: mergeReadState(e.read, e.uid, liveReadOverrides),
      _accountKey: acc.id || acc.name,
      _account: acc,
      _lane: null,
      _untriaged: true,
      _live: true,
      ...(resurfacedHit ? { _resurfaced: true, _resurfacedAt: resurfacedHit.resurfaced_at } : null),
    });
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
    out.push({
      ...snap,
      id: snap.id || snap.uid,
      preview: snap.preview || snap.body_preview || "",
      fromEmail: snap.fromEmail || snap.from_email,
      // entry.read is Gmail's current UNREAD state as of this poll (server-side
      // probe). A session override wins in both directions so mark-unread and
      // re-read actions stay visible before the next live poll lands.
      read: mergeReadState(entry.read, key, liveReadOverrides),
      _accountKey: acc.id || acc.name,
      _account: acc,
      _lane: null,
      _untriaged: true,
      _live: true,
      _resurfaced: true,
      _resurfacedAt: entry.resurfaced_at,
    });
  }
  return out;
}
