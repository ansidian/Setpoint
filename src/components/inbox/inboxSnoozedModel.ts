import { buildInboxRow } from "./inboxRow";
import type { SnoozedEmailEntry } from "../../../shared/types/email";
import type { InboxAccount, InboxPinnedOverride, InboxReadOverrides } from "./inboxTypes";

export function collectSnoozed(entries: SnoozedEmailEntry[], accounts: InboxAccount[], readOverrides: InboxReadOverrides,
  pinnedUids: Set<string>, pinnedOverrides: Map<string, InboxPinnedOverride>, returningUid: string | null) {
  return entries.map((entry) => {
    const account = accounts.find((account) => (account.id || account.account_id) === entry.account_id) || {
      id: entry.account_id || "__unavailable", account_id: entry.account_id,
      name: entry.account_label || entry.account_email || "Unavailable account",
      email: entry.account_email, color: entry.account_color || "#a6adc8", icon: entry.account_icon || "Mail",
    };
    return buildInboxRow(entry, {
      uid: entry.uid, account, readOverrides, lane: entry.lane, displayLane: entry.triage_status === "pending" ? "queued" : entry.lane,
      extras: {
        _snoozed: true, _snoozedUntil: entry.until_ts,
        _snoozedUnavailable: !entry.account_id || entry.account_unavailable || entry.missing_source || entry.provider_state === "trashed",
        _snoozedReturning: returningUid === entry.uid,
        _pinned: pinnedOverrides.get(entry.uid)?.pinned ?? (entry.pinned || pinnedUids.has(entry.uid)),
      },
    });
  }).sort((left, right) => Number(left._snoozedUntil) - Number(right._snoozedUntil) || left.uid.localeCompare(right.uid));
}

export function formatSnoozeTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(timestamp);
}
