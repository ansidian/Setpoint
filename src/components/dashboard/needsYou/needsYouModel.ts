import { daysUntil, formatAmount } from "../../../lib/bill-utils";
import { formatChipDateTime } from "../../../lib/shell-helpers";
import type { ActualBillOccurrence } from "../../../../shared/types/actual";
import type { SnapshotItem } from "../../../../shared/types/snapshots";
import type { DashboardDeadline } from "../../../context/dashboardTaskProjection";

export type NeedsYouEmail = Omit<Partial<SnapshotItem>, "id" | "lane"> & {
  id?: string | number;
  email_id?: string;
  lane?: string;
  snapshot_item_id?: number | null;
};
export type NeedsYouLanes = Partial<Record<"carryover" | "needs_attention" | "fyi", NeedsYouEmail[]>>;
export type NeedsYouDeadline = DashboardDeadline;

function deadlineProjectName(deadline: DashboardDeadline): string | undefined {
  return typeof deadline.project_name === "string" ? deadline.project_name : undefined;
}
export type NeedsYouBill = Partial<ActualBillOccurrence>;
export type NeedsYouDeadlines = { upcoming?: NeedsYouDeadline[] } | null;

interface NeedsYouPill { label: string; tone: string }
export interface NeedsYouCard {
  id: string;
  kind: "urgent" | "backfill";
  source: string;
  sourceIcon: "AlertCircle" | "Circle" | "CreditCard" | "Mail" | "MailOpen" | "Clock";
  tone?: string;
  email?: boolean;
  opened?: boolean;
  handleable?: boolean;
  completable?: boolean;
  snapshotItemId?: number | null;
  uid?: string | number | null;
  jumpKind?: "deadline" | "bill" | "email" | null;
  jumpId?: string | number | null;
  date?: string | null;
  data?: NeedsYouDeadline | NeedsYouBill | NeedsYouEmail | null;
  chipTooltip?: string | null;
  title: string;
  meta: string;
  foot?: string;
  pill: NeedsYouPill;
}

interface RankedNeedsYouCard extends NeedsYouCard {
  _overdue: boolean;
  _dueToday: boolean;
  _rank: number;
}

function isRankedNeedsYouCard(card: RankedNeedsYouCard | null): card is RankedNeedsYouCard {
  return card !== null;
}

const TONE = { rose: "var(--sp-rose)", cream: "var(--sp-cream)", cyan: "var(--sp-cyan)", green: "var(--sp-green)", accent: "var(--sp-accent)" };

function laneRows(snapshotLanes?: NeedsYouLanes | null): NeedsYouEmail[] {
  const s = snapshotLanes || {};
  const seen = new Set<string>();
  return [
    ...(s.carryover || []).map((r) => ({ ...r, lane: "needs_attention" })),
    ...(s.needs_attention || []),
    ...(s.fyi || []),
  ].filter((row) => {
    const key = `${row.account_id}:${row.uid || row.email_id || row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isUrgentEmail(row: NeedsYouEmail) {
  // Reading does NOT clear an email from the band — only an explicit "mark
  // handled" (card or inbox) does, which the server records as handled_at and
  // drops from the lane on refetch. So we deliberately do not filter on read.
  return row.lane === "needs_attention" && row.urgency === "high";
}

function classifyDeadline(d: NeedsYouDeadline): RankedNeedsYouCard | null {
  if (d.status === "complete") return null;
  const days = daysUntil(d.due_date);
  if (days == null || days > 0) return null;
  const overdue = days < 0;
  return {
    id: `deadline:${d.id}`, kind: "urgent", source: "Deadline", sourceIcon: overdue ? "AlertCircle" : "Circle",
    tone: TONE.rose, email: false, opened: false, handleable: false, completable: true, snapshotItemId: null, uid: null,
    // Click-to-open dispatch payload (Blocking Fix 2): the card body routes
    // through onOpen/onJump as { kind: jumpKind, id, date, data } so the band
    // remains the single home for opening an overdue/due-today deadline.
    jumpKind: "deadline", jumpId: d.id, date: d.due_date || null, data: d,
    chipTooltip: formatChipDateTime(d.due_date, d.due_time, days === 0),
    title: d.title || "Deadline",
    meta: `${d.class_name || deadlineProjectName(d) || "Deadline"}${d.priority ? ` · P${d.priority}` : ""}`,
    pill: { label: overdue ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue` : (d.due_time ? `Due today, ${d.due_time}` : "Due today"), tone: TONE.rose },
    _overdue: overdue, _dueToday: days === 0, _rank: overdue ? 0 : 2,
  };
}

function classifyBill(b: NeedsYouBill): RankedNeedsYouCard | null {
  if (b.paid) return null;
  const days = daysUntil(b.next_date);
  if (days == null || days !== 0) return null;
  return {
    id: `bill:${b.id}`, kind: "urgent", source: "Bill", sourceIcon: "CreditCard",
    tone: TONE.rose, email: false, opened: false, handleable: false, completable: false, snapshotItemId: null, uid: null,
    // Click-to-open dispatch payload (Blocking Fix 2).
    jumpKind: "bill", jumpId: b.id, date: b.next_date || null, data: b,
    chipTooltip: formatChipDateTime(b.next_date, null, true),
    title: b.name || b.payee || "Bill", meta: `${formatAmount(b.amount)} · No matching payment in Actual`,
    pill: { label: "Due today", tone: TONE.rose },
    _overdue: false, _dueToday: true, _rank: 1,
  };
}

function classifyEmailCard(row: NeedsYouEmail, opened: string[]): RankedNeedsYouCard {
  const id = `email:${row.id ?? row.uid ?? row.email_id}`;
  // A read email (server `read`) reflects as opened too, so a previously-read
  // but unhandled email shows the opened treatment while still staying in band.
  const isOpen = opened.includes(id) || !!row.read;
  const uid = row.uid ?? row.email_id ?? String(row.id);
  return {
    id, kind: "urgent", source: "Email", sourceIcon: isOpen ? "MailOpen" : "Mail",
    tone: TONE.rose, email: true, opened: isOpen, completable: false,
    handleable: row.snapshot_item_id != null, snapshotItemId: row.snapshot_item_id ?? null,
    // Click-to-open dispatch: the card body opens the email reader (consistent
    // with deadline/bill cards), so there is no separate "Open email" button.
    jumpKind: "email", jumpId: uid, date: null, data: row,
    uid,
    title: row.subject || "(no subject)",
    meta: `${row.from || row.from_name || row.from_address || "Unknown sender"}${row.action ? ` · ${row.action}` : isOpen ? " · Opened" : ""}`,
    pill: { label: "Needs attention", tone: TONE.rose },
    _overdue: false, _dueToday: false, _rank: 3,
  };
}

function buildInbox(rows: NeedsYouEmail[], opened: string[], handled: string[]) {
  const inboxRows = rows
    .map((r) => {
      const id = `email:${r.id ?? r.uid ?? r.email_id}`;
      const isNeeds = r.lane === "needs_attention";
      return {
        id, lane: isNeeds ? "needs_attention" : "fyi",
        dotTone: isNeeds ? TONE.rose : TONE.cyan,
        dotState: opened.includes(id) ? "hollow" : "solid",
        label: `${r.from || "Unknown"} · ${r.subject || ""}`,
        age: r.date || null,
        snapshotItemId: r.snapshot_item_id ?? null,
      };
    })
    .filter((r) => !handled.includes(r.id));
  const needCount = inboxRows.filter((r) => r.lane === "needs_attention").length;
  const inboxChip = needCount > 0
    ? { text: `${needCount} need you`, tone: TONE.rose, calm: false }
    : { text: "Inbox calm", tone: TONE.green, calm: true };
  return { inboxRows, inboxChip };
}

// Pure: returns the Set of every card id the current server data could
// produce, computed BEFORE the `handled` filters run — so an id the `handled`
// array would otherwise permanently suppress is still recognized here. This is
// the candidate universe the band's stale-id pruning effect (ARCH-06) compares
// `opened`/`handled` against: an id no longer in this set means the server no
// longer has the item, so it's safe to drop from those arrays; an id still
// present means either it's a legitimately still-active item, or it's in
// flight (optimistically hidden, server not yet refetched) — either way, not
// pruned yet.
export function collectNeedsYouCandidateIds({ snapshotLanes, liveDeadlines, liveBills }: {
  snapshotLanes?: NeedsYouLanes | null;
  liveDeadlines?: NeedsYouDeadlines;
  liveBills?: NeedsYouBill[] | null;
} = {}) {
  const rows = laneRows(snapshotLanes);
  const ids = new Set<string>();

  rows.filter(isUrgentEmail).forEach((r) => ids.add(`email:${r.id ?? r.uid ?? r.email_id}`));

  (liveDeadlines?.upcoming || []).forEach((d) => {
    if (d.status === "complete") return;
    ids.add(`deadline:${d.id}`);
  });

  (liveBills || []).forEach((b) => {
    if (b.paid) return;
    ids.add(`bill:${b.id}`);
  });

  return ids;
}

export function buildNeedsYouModel({ snapshotLanes, liveDeadlines, liveBills, handled = [], opened = [], maxCards = 5, backfillLimit = 2 }: {
  snapshotLanes?: NeedsYouLanes | null;
  liveDeadlines?: NeedsYouDeadlines;
  liveBills?: NeedsYouBill[] | null;
  handled?: string[];
  opened?: string[];
  maxCards?: number;
  backfillLimit?: number;
} = {}) {
  const rows = laneRows(snapshotLanes);
  const emailCards = rows.filter(isUrgentEmail)
    .map((r) => classifyEmailCard(r, opened))
    .filter((c) => !handled.includes(c.id));

  const deadlineCards = (liveDeadlines?.upcoming || [])
    .map(classifyDeadline).filter(isRankedNeedsYouCard)
    .filter((c) => !handled.includes(c.id));
  const billCards = (liveBills || [])
    .map(classifyBill).filter(isRankedNeedsYouCard)
    .filter((c) => !handled.includes(c.id));

  const all = [...deadlineCards, ...billCards, ...emailCards].sort((a, b) => a._rank - b._rank);

  const countN = all.length;
  const nOverdue = all.filter((c) => c._overdue).length;
  const countColor = nOverdue > 0 ? TONE.rose : TONE.accent;

    const nDueToday = all.filter((c) => c._dueToday).length;
    const nEmail = all.filter((c) => c.email).length;
    const breakdown: Array<{ text: string; color: string }> = [];
    if (nOverdue) breakdown.push({ text: `${nOverdue} overdue`, color: TONE.rose });
    if (nDueToday) breakdown.push({ text: `${nDueToday} due today`, color: TONE.rose });
    if (nEmail) breakdown.push({ text: `${nEmail} urgent ${nEmail === 1 ? "email" : "emails"}`, color: TONE.cream });

    const urgentVisible = all.slice(0, maxCards);
    const moreCount = Math.max(0, all.length - maxCards);
    const moreLabel = moreCount === 1 ? "more item needs you" : "more need you";

    const slotsLeft = moreCount === 0
      ? Math.min(backfillLimit, Number.isFinite(maxCards) ? Math.max(0, maxCards - urgentVisible.length) : backfillLimit)
      : 0;
    const upcoming = [
      ...(liveDeadlines?.upcoming || [])
        .filter((d) => d.status !== "complete")
        .map((d) => ({ when: daysUntil(d.due_date), kind: "deadline", id: `deadline:${d.id}`, title: d.title, meta: `${d.class_name || deadlineProjectName(d) || "Deadline"}`, foot: "Deadline", completable: true, jumpKind: "deadline" as const, jumpId: d.id, date: d.due_date, data: d, chipTooltip: formatChipDateTime(d.due_date, d.due_time, false) }))
        .filter((x): x is typeof x & { when: number } => x.when != null && x.when > 0),
      ...(liveBills || [])
        .filter((b) => !b.paid)
        .map((b) => ({ when: daysUntil(b.next_date), kind: "bill", id: `bill:${b.id}`, title: b.name || b.payee, meta: `${formatAmount(b.amount)}`, foot: "Bill", completable: false, jumpKind: "bill" as const, jumpId: b.id, date: b.next_date, data: b, chipTooltip: formatChipDateTime(b.next_date, null, false) }))
        .filter((x): x is typeof x & { when: number } => x.when != null && x.when > 0),
    ]
      .filter((u) => !handled.includes(u.id))
      .sort((a, b) => a.when - b.when).slice(0, slotsLeft);
    const backfillCards: NeedsYouCard[] = upcoming.map((u) => ({
      id: u.id, kind: "backfill", source: "Coming up", sourceIcon: "Clock",
      title: u.title || "", meta: u.meta, foot: u.foot, chipTooltip: u.chipTooltip,
      // Upcoming deadlines and bills open through the same detail route as due
      // items; deadlines also keep the canonical completion payload.
      completable: !!u.completable, jumpKind: u.jumpKind ?? null, jumpId: u.jumpId ?? null, date: u.date ?? null, data: u.data ?? null,
      pill: { label: u.when === 1 ? "Tomorrow" : `In ${u.when} days`, tone: TONE.cream },
    }));

    const clean = (c: RankedNeedsYouCard): NeedsYouCard => {
      const { _overdue: _ignoredOverdue, _dueToday: _ignoredDueToday, _rank: _ignoredRank, ...rest } = c;
      return rest;
    };

    const { inboxRows, inboxChip } = buildInbox(rows, opened, handled);

    return { countN, countColor, breakdown, urgentCards: urgentVisible.map(clean), backfillCards, moreCount, moreLabel, inboxRows, inboxChip };
}
