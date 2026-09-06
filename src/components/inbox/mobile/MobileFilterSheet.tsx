import SnapshotNavigationControls from "../SnapshotNavigationControls";
import { formatSnapshotContext } from "../snapshotSummary";
import type { InboxSnapshotNavigation } from "../inboxViewTypes";
import { Check, CheckCheck } from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";
import type { Dispatch, SetStateAction } from "react";
import type { InboxAccount } from "../inboxTypes";

const LANES = [
  { key: "__all", label: "All mail" },
  { key: "queued", label: "Queued" },
  { key: "needs_attention", label: "Needs attention" },
  { key: "catch_up", label: "Catch-up" },
  { key: "fyi", label: "FYI" },
  { key: "handled", label: "Handled" },
  { key: "untriaged_read", label: "Untriaged read" },
  { key: "noise", label: "Noise" },
];

export default function MobileFilterSheet({
  collection, setCollection, snoozedCount,
  snapshotNavigation,
  open, accent, accountId, setAccountId, accounts, totalUnread,
  lane, setLane, chipCounts, indexedSearchActive, unreadInView, onMarkAllRead, readOnly, onClose,
}: {
  collection: "inbox" | "snoozed";
  setCollection: (collection: "inbox" | "snoozed") => void;
  snoozedCount: number;
  snapshotNavigation: InboxSnapshotNavigation | null;
  open: boolean;
  accent: string;
  accountId: string;
  setAccountId: Dispatch<SetStateAction<string>>;
  accounts: InboxAccount[];
  totalUnread: number;
  lane: string;
  chipCounts: Record<string, number>;
  setLane: Dispatch<SetStateAction<string>>;
  indexedSearchActive: boolean;
  unreadInView: number;
  onMarkAllRead: () => void;
  readOnly: boolean;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Filters">
      <div data-testid="inbox-mobile-filter-sheet" className="mobile-filter-content">
        {!indexedSearchActive && <section className="mobile-filter-group" aria-label="Collection">
          <h3>Collection</h3><div className="mobile-filter-lanes">
            <button className="mobile-filter-option" aria-pressed={collection === "inbox"} onClick={() => { setCollection("inbox"); onClose(); }}>Inbox</button>
            <button className="mobile-filter-option" aria-pressed={collection === "snoozed"} onClick={() => { setCollection("snoozed"); onClose(); }}>Snoozed · {snoozedCount}</button>
          </div>
        </section>}
        {!indexedSearchActive && snapshotNavigation && (
          <section className="mobile-filter-group" aria-label="Snapshots">
            <h3>Snapshot</h3>
            <p className="mobile-filter-snapshot-copy">{formatSnapshotContext(snapshotNavigation.snapshot) || (readOnly ? "Historical snapshot" : "Current snapshot")}</p>
            <SnapshotNavigationControls navigation={snapshotNavigation} historical={readOnly} mobile onNavigate={(direction) => { void snapshotNavigation.onNavigate(direction); }} />
          </section>
        )}
        {!indexedSearchActive && collection === "inbox" && (
          <section className="mobile-filter-group" aria-label="Triage">
            <h3>Triage</h3>
            <div className="mobile-filter-lanes">
              {LANES.filter((item) => item.key === "__all" || item.key === lane || (chipCounts[item.key] ?? 0) > 0).map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className="mobile-filter-option"
                  aria-pressed={lane === item.key}
                  onClick={() => { setLane(item.key); onClose(); }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        )}
        <section className="mobile-filter-group" aria-label="Accounts">
          <h3>Accounts</h3>
          <button
            type="button"
            className="mobile-filter-option mobile-filter-account"
            aria-pressed={accountId === "__all"}
            onClick={() => { setAccountId("__all"); onClose(); }}
          >
            <span className="mobile-filter-account-copy">All accounts</span>
            <span className="mobile-filter-count">{totalUnread} unread</span>
            {accountId === "__all" && <Check size={14} color={accent} aria-hidden="true" />}
          </button>
          {accounts.map((account) => {
            const accountKey = account.id || account.name;
            const active = accountId === accountKey;
            return (
              <button
                key={accountKey}
                type="button"
                className="mobile-filter-option mobile-filter-account"
                aria-pressed={active}
                onClick={() => { setAccountId(accountKey); onClose(); }}
              >
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: account.color || accent, flexShrink: 0 }} />
                <span className="mobile-filter-account-copy">
                  {account.name || account.email}
                  {account.name && account.email !== account.name && <small>{account.email}</small>}
                </span>
                {active && <Check size={14} color={account.color || accent} aria-hidden="true" />}
              </button>
            );
          })}
        </section>
        {!readOnly && (
          <button
            type="button"
            className="mobile-filter-mark-read"
            disabled={unreadInView === 0}
            onClick={() => { onMarkAllRead(); onClose(); }}
          >
            <CheckCheck size={16} color={accent} aria-hidden="true" />
            Mark all read in this view{unreadInView > 0 ? ` (${unreadInView})` : ""}
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
