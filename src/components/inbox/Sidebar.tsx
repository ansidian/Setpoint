import type { CSSProperties } from "react";
import InboxLaneFilterBar from "./InboxLaneFilterBar";
import { resolveReaderActions } from "./reader/readerActionsModel";
import type { InboxAccount, InboxEmailLike } from "./inboxTypes";

export default function Sidebar({
  accounts, accountId, onAccountChange,
  accent, collection = "inbox", onCollectionChange, snoozedCount = 0,
  lane, laneCounts, onLaneChange, searchActive, selectedEmail = null, readOnly = false,
}: {
  accounts: InboxAccount[];
  accountId: string;
  onAccountChange: (value: string) => void;
  accent: string;
  collection?: "inbox" | "snoozed";
  onCollectionChange: (collection: "inbox" | "snoozed") => void;
  snoozedCount?: number;
  lane: string;
  laneCounts: Record<string, number | undefined>;
  onLaneChange: (lane: string) => void;
  searchActive: boolean;
  selectedEmail?: InboxEmailLike | null;
  readOnly?: boolean;
}) {
  const actions = resolveReaderActions(selectedEmail, { readOnly });
  return (
    <aside className="inbox-a-rail" aria-label="Inbox views" style={{ "--ea-accent": accent } as CSSProperties}>
      <select className="inbox-a-account-select" aria-label="Email account" value={accountId} onChange={(event) => onAccountChange(event.target.value)}>
        <option value="__all">All accounts</option>
        {accounts.map((account) => <option key={account.id || account.name} value={account.id || account.name}>{account.name || account.email || "Account"}</option>)}
      </select>
      <InboxLaneFilterBar
        accent={accent}
        activeLane={collection === "inbox" ? lane : "snoozed"}
        counts={{ ...laneCounts, snoozed: snoozedCount }}
        onChange={(value) => value === "snoozed" ? onCollectionChange("snoozed") : onLaneChange(value)}
      />
      {searchActive && <p className="inbox-a-rail-note">Search spans all accounts. Clear it to return to this view.</p>}
      <footer className="inbox-a-rail-footer">
        <div className="inbox-a-shortcuts" aria-label="Keyboard shortcuts">
          <span><kbd>J</kbd> / <kbd>K</kbd> next / previous</span>
          {(actions.canHandle || actions.canReopen) && <span><kbd>H</kbd> {actions.canReopen ? "reopen" : "mark handled"}</span>}
          {selectedEmail && actions.showDestructiveActions && <span><kbd>S</kbd> snooze</span>}
          <span><kbd>⌘F</kbd> search · <kbd>⌘Z</kbd> undo</span>
        </div>
      </footer>
    </aside>
  );
}
