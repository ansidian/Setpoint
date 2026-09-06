import type { ActiveSnapshotView, SnapshotItem } from "../../../../shared/types/snapshots";

export type InboxPeekLane = "needs_attention" | "carryover" | "fyi" | "queued";

function identity(row: SnapshotItem) {
  return `${row.account_id}:${row.uid || row.email_id || row.id}`;
}

function unique(rows: SnapshotItem[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = identity(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unreadThenRecent(a: SnapshotItem, b: SnapshotItem) {
  if (a.read !== b.read) return a.read ? 1 : -1;
  return (Date.parse(b.email_date || b.date || "") || 0) - (Date.parse(a.email_date || a.date || "") || 0);
}

export function buildInboxPeek(snapshot: ActiveSnapshotView | null | undefined, excludedEmailIds: readonly string[] = []) {
  if (!snapshot?.snapshot) return { available: false, processing: false, counts: { needs_attention: 0, carryover: 0, fyi: 0, queued: 0 }, rows: [] };
  const carryover = unique(snapshot.carryover || []);
  const carryoverIds = new Set(carryover.map(identity));
  const attention = unique(snapshot.lanes.needs_attention || []).filter((row) => !carryoverIds.has(identity(row)));
  const attentionIds = new Set([...attention, ...carryover].map(identity));
  const fyi = unique(snapshot.lanes.fyi || []).filter((row) => !attentionIds.has(identity(row)));
  const excluded = new Set(excludedEmailIds);
  const eligible = (row: SnapshotItem) => !excluded.has(row.uid) && !excluded.has(row.email_id) && !row.handled_at;
  const rows = [
    ...[...attention, ...carryover].filter(eligible).sort(unreadThenRecent).map((email) => ({ key: identity(email), lane: carryoverIds.has(identity(email)) ? "carryover" as const : "needs_attention" as const, email })),
    ...fyi.filter(eligible).sort(unreadThenRecent).map((email) => ({ key: identity(email), lane: "fyi" as const, email })),
  ].slice(0, 3);
  return {
    available: true,
    processing: !!snapshot.processing?.active,
    counts: { needs_attention: attention.length, carryover: carryover.length, fyi: fyi.length, queued: unique(snapshot.lanes.queued || []).length },
    rows,
  };
}
