import { snapshotInboxLaneForItem } from "./activeSnapshotWorkflowModel";
import { buildInboxRow } from "./inboxRow";
import type { PinnedEmailEntry } from "../../../shared/types/email";
import type {
  InboxAccount,
  InboxEmailLike,
  InboxId,
  InboxReadOverrides,
  NormalizedInboxRow,
} from "./inboxTypes";

export interface InboxActiveSnapshotLike {
  snapshot?: {
    id?: InboxId;
    updated_at?: string;
  } | null;
  readOnly?: boolean;
  filters?: {
    accounts?: Array<{
      account_id?: string;
      label?: string;
      email?: string;
      color?: string;
      icon?: string;
      count?: number;
    }>;
    categories?: Array<{ category?: string; count?: number }>;
  };
  lanes?: Partial<Record<"queued" | "needs_attention" | "catch_up" | "fyi" | "handled" | "untriaged_read" | "noise", InboxEmailLike[]>>;
  carryover?: InboxEmailLike[];
  processing?: {
    active?: boolean;
    queued?: number;
    running?: number;
    total?: number;
  };
  pinned?: unknown[];
}

export interface ResurfacedEntry {
  uid?: string;
  snapshot?: InboxEmailLike;
  read?: boolean;
  resurfaced_at?: number | null;
}

export { mergeReadState, readOverrideForUid, composeReadOverrides } from "./inboxRow";

// Build a `synthAccount(source)` function bound to the inbox account list.
// Matches a live/resurfaced/pin-snapshot entry's account_label to an existing
// inbox account so the sidebar groups them correctly, else synthesizes a
// minimal account record. Built once per flatEmails recompute so the inner
// lookup can be a Map get.
export function makeSynthAccount(emailAccounts: InboxAccount[]) {
  const accountByName = new Map(emailAccounts.map((a) => [a.name, a]));
  return (source: InboxEmailLike): InboxAccount => accountByName.get(source.account_label || "") || {
    name: source.account_label || "Live",
    color: source.account_color || "#89b4fa",
    icon: source.account_icon || "Mail",
    important: [],
    noise: [],
  };
}

export function isCatchUpEmail(email: InboxEmailLike | null | undefined): boolean {
  return email?._lane === "catch_up"
    || email?.lane === "catch_up"
    || email?._catchUp
    || email?.source === "catch_up";
}

export function collectActiveSnapshotEmails(
  activeSnapshot: InboxActiveSnapshotLike | null | undefined,
  liveReadOverrides: InboxReadOverrides = {},
): NormalizedInboxRow[] {
  if (!activeSnapshot?.snapshot) return [];
  const accountMap = new Map((activeSnapshot.filters?.accounts || []).map((account) => {
    const accountId = account.account_id || "";
    return [
    accountId,
    {
      id: accountId,
      account_id: accountId,
      name: account.label || account.email || accountId,
      email: account.email || "",
      color: account.color || "#cba6da",
      icon: account.icon || "Mail",
      unread: account.count || 0,
      important: [],
      noise: [],
    },
  ] as [string, InboxAccount];
  }));
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
    const arrivalGraceQueued = item.lane === "queued" || item.source === "arrival_grace";
    const untriagedRead = item.lane === "untriaged_read" || item.source === "arrival_grace_read";
    const catchUp = item._snapshotCatchUp || item.lane === "catch_up" || item.source === "catch_up";
    const resurfacedAt = item.resurfaced_at || item._resurfacedAt || (item.source_at ? Date.parse(item.source_at) : null);
    const accountId = item.account_id || "";
    const account = accountMap.get(accountId) || {
      id: accountId,
      account_id: accountId,
      name: item.account_label || item.account_email || accountId,
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
export function collectLiveEmails(
  liveEmails: InboxEmailLike[],
  synthAccount: (email: InboxEmailLike) => InboxAccount,
  liveTrashedUids: ReadonlySet<string>,
  liveReadOverrides: InboxReadOverrides,
  resurfacedMap: ReadonlyMap<string, ResurfacedEntry>,
): NormalizedInboxRow[] {
  const out: NormalizedInboxRow[] = [];
  for (const e of liveEmails) {
    if (!e.uid || liveTrashedUids.has(e.uid)) continue;
    const acc = synthAccount(e);
    const resurfacedHit = resurfacedMap.get(e.uid);
    out.push(buildInboxRow(e, {
      uid: e.uid,
      id: e.id || e.uid,
      account: acc,
      read: e.read,
      readOverrides: liveReadOverrides,
      lane: "queued",
      displayLane: "queued",
      live: true,
      resurfaced: !!resurfacedHit,
      resurfacedAt: resurfacedHit ? resurfacedHit.resurfaced_at : null,
      extras: { _arrivalGraceQueued: true },
    }));
  }
  return out;
}

// Inject resurfaced snapshots (snooze woke up). Gmail's live-poll filter
// uses original internalDate so these wouldn't reach the inbox on their own.
// Caller dedups against previously-collected sources; this drops entries with
// no key or that the user has locally trashed.
export function collectResurfaced(
  resurfacedMap: ReadonlyMap<string, ResurfacedEntry>,
  synthAccount: (email: InboxEmailLike) => InboxAccount,
  liveReadOverrides: InboxReadOverrides,
  liveTrashedUids: ReadonlySet<string>,
): NormalizedInboxRow[] {
  const out: NormalizedInboxRow[] = [];
  for (const entry of resurfacedMap.values()) {
    const snap = entry.snapshot;
    if (!snap) continue;
    const key = snap?.uid || snap?.id;
    if (!key) continue;
    const uid = String(key);
    if (liveTrashedUids.has(uid)) continue;
    const acc = synthAccount(snap);
    out.push(buildInboxRow(snap, {
      uid,
      id: snap.id || snap.uid || uid,
      account: acc,
      // entry.read is Gmail's current UNREAD state as of this poll (server-side
      // probe). A session override wins in both directions so mark-unread and
      // re-read actions stay visible before the next live poll lands.
      read: entry.read,
      readOverrides: liveReadOverrides,
      lane: snap.lane || snap._lane || "needs_attention",
      displayLane: snapshotInboxLaneForItem(snap) || "needs_attention",
      live: true,
      resurfaced: true,
      resurfacedAt: entry.resurfaced_at,
    }));
  }
  return out;
}

// Inject pinned overlay entries (see docs/exec-plans/active/2026-07-01-pinned-emails-design.md).
// Pins live outside snapshots; these rows carry _pinned/_pinnedAt so the
// projection can render the Pinned section without touching snapshot state.
export function collectPinned(
  pinnedEntries: InboxEmailLike[] | null | undefined,
  synthAccount: (email: InboxEmailLike) => InboxAccount,
  liveReadOverrides: InboxReadOverrides,
): NormalizedInboxRow[] {
  const out: NormalizedInboxRow[] = [];
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
export function mergePinnedIntoFlat(flatRows: InboxEmailLike[], pinnedRows: InboxEmailLike[] | null | undefined): InboxEmailLike[] {
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
export function pinnedEntryFromSnapshot(uid: string, pinnedAtMs: number, snap: InboxEmailLike = {}): PinnedEmailEntry {
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
