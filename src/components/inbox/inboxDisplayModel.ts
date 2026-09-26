import { emailSelectionKey } from "./inboxBatchModel";
import type { InboxEmailLike, InboxId } from "./inboxTypes";

export const DESKTOP_INBOX_LANES = ["queued", "pinned", "needs_attention", "fyi", "noise", "handled", "catch_up", "untriaged_read"] as const;
export type DesktopInboxLane = typeof DESKTOP_INBOX_LANES[number];
export type LaneDisclosure = Partial<Record<DesktopInboxLane, boolean>>;

export function desktopInboxLane(email: InboxEmailLike): DesktopInboxLane {
  if (email._pinned) return "pinned";
  if (email._lane === "action" || email._lane === "carryover") return "needs_attention";
  return (email._lane || "fyi") as DesktopInboxLane;
}

export function compareDesktopInboxEmails(a: InboxEmailLike, b: InboxEmailLike): number {
  const aLane = desktopInboxLane(a);
  const bLane = desktopInboxLane(b);
  const laneOrder = DESKTOP_INBOX_LANES.indexOf(aLane) - DESKTOP_INBOX_LANES.indexOf(bLane);
  if (laneOrder) return laneOrder;
  if (aLane === "pinned") return (b._pinnedAt || 0) - (a._pinnedAt || 0);
  const recency = (email: InboxEmailLike) => (aLane !== "queued" && email._resurfacedAt) || new Date(email.date || 0).getTime() || 0;
  return recency(b) - recency(a);
}

export function projectInboxDisplay(emails: InboxEmailLike[], {
  focusUnread = false, selectedId = null, collapsed = {}, expandedRead = {},
}: { focusUnread?: boolean; selectedId?: InboxId | null; collapsed?: LaneDisclosure; expandedRead?: LaneDisclosure } = {}) {
  const sections = DESKTOP_INBOX_LANES.map(lane => {
    const source = emails.filter(email => desktopInboxLane(email) === lane);
    const read = focusUnread && lane !== "pinned" && lane !== "needs_attention"
      ? source.filter(email => (email.read || email._lane === "untriaged_read") && email.id !== selectedId && email.uid !== selectedId)
      : [];
    const tucked = new Set(read.map(emailSelectionKey));
    const primary = source.filter(email => !tucked.has(emailSelectionKey(email)));
    const rows = [...primary, ...(expandedRead[lane] ? read : [])];
    return { lane, source, primary, read, rows, collapsed: !!collapsed[lane], readExpanded: !!expandedRead[lane] };
  }).filter(section => section.source.length > 0);
  return { sections, displayed: sections.flatMap(section => section.collapsed ? [] : section.rows) };
}

// Compare identity within each lane so triage moves and newly-unread mail also
// reopen a focused lane, without replaying on ordinary read/metadata updates.
export function unreadLaneKeys(emails: InboxEmailLike[]): string[] {
  return emails.filter(email => !email.read && email._lane !== "untriaged_read")
    .map(email => `${desktopInboxLane(email)}:${emailSelectionKey(email)}`);
}

export function reopenUnreadLanes(collapsed: LaneDisclosure, previous: readonly string[], next: readonly string[]): LaneDisclosure {
  const seen = new Set(previous);
  const result = { ...collapsed };
  for (const key of next) if (!seen.has(key)) result[key.split(":")[0] as DesktopInboxLane] = false;
  return result;
}
