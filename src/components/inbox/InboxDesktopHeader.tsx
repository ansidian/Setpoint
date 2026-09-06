import type { RefObject } from "react";
import { History, LoaderCircle, Search, X } from "lucide-react";
import InboxSearchFlagChips from "./InboxSearchFlagChips";
import DesktopSnapshotNavigator from "./DesktopSnapshotNavigator";
import { formatSnapshotContext } from "./snapshotSummary";
import type { InboxSnapshotNavigation } from "./inboxViewTypes";

export default function InboxDesktopHeader({
  accent, search, onSearchChange, searchRef,
  onAskAlfred, navigation, readOnly, processingCount, liveLoading,
}: {
  accent: string;
  search: string;
  onSearchChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null> | null;
  onAskAlfred: (query: string) => void;
  navigation: InboxSnapshotNavigation | null;
  readOnly: boolean;
  processingCount: number;
  liveLoading: boolean;
}) {
  const updating = !readOnly && (liveLoading || processingCount > 0);
  const busy = navigation?.historyLoading || !!navigation?.navigating;
  const context = formatSnapshotContext(navigation?.snapshot || null);
  return <>
    <header className="inbox-a-page-header">
      <div className="inbox-a-page-title">
        <h1>Inbox</h1>
        <p>{updating ? <><LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" /> {processingCount > 0 ? `Updating ${processingCount} emails` : "Checking mail"}</> : context || "A clear next step for every email."}</p>
      </div>
      <div className="inbox-a-search-tools">
        <div className="inbox-a-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            aria-label="Search indexed mail"
            placeholder="Search mail across all dates"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.metaKey || event.ctrlKey) onAskAlfred(search);
                else event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                if (search) onSearchChange("");
                event.currentTarget.blur();
              }
            }}
          />
          {search ? <button className="inbox-a-control inbox-a-icon-control" type="button" aria-label="Clear search" onClick={() => { onSearchChange(""); searchRef?.current?.focus(); }}><X size={14} /></button> : <kbd>⌘ F</kbd>}
        </div>
        <InboxSearchFlagChips query={search} onChange={onSearchChange} accent={accent} />
      </div>
      <div className="inbox-a-scope-tools">
        {navigation && <button
          className="inbox-a-control inbox-a-history-control"
          type="button"
          aria-label={readOnly ? "Return to current snapshot" : "Show older snapshot"}
          disabled={busy || (!readOnly && !navigation.canOlder)}
          onClick={() => {
            if (readOnly && navigation.onReturnToCurrent) navigation.onReturnToCurrent();
            else void navigation.onNavigate(readOnly ? "newer" : "older");
          }}
        >
          {busy ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <History size={14} />}
          {readOnly ? "Current" : "History"}
        </button>}
      </div>
    </header>
    {readOnly && navigation && <DesktopSnapshotNavigator navigation={navigation} liveLoading={false} processingCount={0} readOnly />}
    {!readOnly && navigation?.error && <p role="status" className="inbox-a-history-error">Couldn’t load snapshots. Try History again.</p>}
  </>;
}
