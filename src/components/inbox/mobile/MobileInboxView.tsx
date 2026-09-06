import { AnimatePresence } from "motion/react";
import InboxRowTransition from "../InboxRowTransition";
import { publicAssetUrl } from "@/publicAsset";
import {
  Inbox,
  SearchX,
  Filter,
  Pin,
  Search,
} from "lucide-react";
import InboxEmptyState from "../InboxEmptyState";
import MobileEmailRow from "./MobileEmailRow";
import Reader from "../reader/Reader";
import MobileFilterSheet from "./MobileFilterSheet";
import { Skeleton } from "@/components/ui/skeleton";
import InboxUndoToast from "../InboxUndoToast";
import MobileSnapshotHeader from "./MobileSnapshotHeader";
import { LANE } from "../../../lib/shell-helpers";
import "./MobileInbox.css";
import type { InboxPaneProps } from "../inboxViewTypes";
import { useLayoutEffect, useRef, useState } from "react";

function MobileLiveSkeletonRows({ count = 4, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div data-testid="inbox-mobile-live-skeleton" style={{ padding: compact ? "6px 0 2px" : "8px 16px 24px" }}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          style={{
            padding: compact ? "10px 0" : "14px 0",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Skeleton style={{ width: 30, height: 30, borderRadius: 999, background: "rgba(205,214,244,0.10)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton style={{ width: index % 2 ? "62%" : "74%", height: 10, background: "rgba(205,214,244,0.11)" }} />
              <Skeleton style={{ width: index % 2 ? "76%" : "58%", height: 8, marginTop: 8, background: "rgba(205,214,244,0.07)" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MobileLiveLoadingBlock({ compact = false, activeSnapshotMode = false }: { compact?: boolean; activeSnapshotMode?: boolean }) {
  return (
    <div
      data-testid="inbox-mobile-live-loading-block"
      style={{
        margin: "8px 16px 2px",
        padding: compact ? "10px 12px 8px" : "10px 12px 12px",
        borderRadius: 10,
        border: "1px solid color-mix(in srgb, var(--sp-blue) 18%, transparent)",
        background: "color-mix(in srgb, var(--sp-blue) 6%, transparent)",
        color: "rgba(205,214,244,0.72)",
        fontSize: 11,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Skeleton style={{ width: 8, height: 8, borderRadius: 999, background: "color-mix(in srgb, var(--sp-blue) 75%, transparent)" }} />
        {activeSnapshotMode ? "Syncing active snapshot" : "Checking live mail"}
      </div>
      <MobileLiveSkeletonRows count={compact ? 2 : 3} compact />
    </div>
  );
}

export default function MobileInboxView({
  accent,
  collection, setCollection, snoozedCount, snoozedLoading, snoozedError, refreshSnoozed,
  mobileShellActions,
  mobileScrollTopRequestId,
  onMobileReaderBack,
  mobileReaderBackLabel,
  nowTick,
  emailAccounts,
  accountId,
  setAccountId,
  lane,
  setLane,
  search,
  setSearch,
  searchRef,
  selectedEmail,
  selectedAccount,
  onOpen,
  closeSelectedEmail,
  mobileFiltersOpen,
  setMobileFiltersOpen,
  billOpen,
  setBillOpen,
  onOpenRecordedBill,
  rowAccountsById,
  indexedSearchActive,
  indexedSearchLoading,
  indexedSearchError,
  indexedSearchTotal,
  indexedSearchHasMore,
  loadMoreIndexedSearch,
  visibleEmails,
  chipCounts,
  totalUnread,
  unreadInView,
  markAllVisibleRead,
  mobileUnreadOnly,
  setMobileUnreadOnly,
  onAction,
  showTriage,
  showDraft,
  showPreview,
  scopedAccount,
  liveEmailsLoading = false,
  activeSnapshotMode = false,
  readOnly = false,
  snapshotNavigation = null,
  undo,
  onUndo,
  announcement,
}: InboxPaneProps) {
  const [searchExpanded, setSearchExpanded] = useState(!!search);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchOpen = searchExpanded || !!search;
  useLayoutEffect(() => {
    if (searchExpanded) searchRef.current?.focus();
  }, [searchExpanded, searchRef]);
  const cancelSearch = () => {
    setSearch("");
    setSearchExpanded(false);
    requestAnimationFrame(() => searchButtonRef.current?.focus());
  };
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listScrollTopRef = useRef(0);
  const readerOpen = !!selectedEmail;

  useLayoutEffect(() => {
    if (readerOpen || !listRef.current) return undefined;
    const scrollTop = listScrollTopRef.current;
    listRef.current.scrollTop = scrollTop;
    // The shell restores its navigation in the same render; reapply after its
    // height settles so returning to the list preserves the scanning position.
    const frame = window.requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = scrollTop;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [readerOpen]);

  useLayoutEffect(() => {
    listScrollTopRef.current = 0;
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [collection, accountId, lane, search, mobileUnreadOnly, snapshotNavigation?.snapshot?.id, mobileScrollTopRequestId]);

  const allowWorkspaceExit = () => !workspaceDirty || window.confirm("Discard your unsaved changes?");
  const guardedOpen: typeof onOpen = (...args) => {
    if (!allowWorkspaceExit()) return;
    setWorkspaceDirty(false);
    onOpen(...args);
  };
  const guardedClose = () => {
    if (!allowWorkspaceExit()) return;
    setWorkspaceDirty(false);
    (onMobileReaderBack || closeSelectedEmail)();
  };
  // visibleEmails arrives pinned-first (selectVisibleEmails sorts pinned rows
  // ahead of everything else, newest pin first), so splitting off the pinned
  // block for the compact group header is a findIndex split, not a re-sort.
  const pinnedCount = collection === "snoozed" && !indexedSearchActive ? 0 : visibleEmails.findIndex((e) => !e._pinned);
  const pinnedRows = pinnedCount === -1 ? visibleEmails : visibleEmails.slice(0, pinnedCount);
  const restRows = pinnedCount === -1 ? [] : visibleEmails.slice(pinnedCount);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "transparent",
        color: "var(--sp-text)",
      }}
    >
      {selectedEmail ? (
        <Reader
          key={selectedEmail?.id || selectedEmail?.uid || "empty"}
          email={selectedEmail}
          account={selectedAccount}
          accent={accent}
          onAction={(kind, payload) => { if (kind === "unsnooze" && !allowWorkspaceExit()) return; onAction(kind, payload); }}
          onClose={guardedClose}
          backLabel={mobileReaderBackLabel}
          onWorkspaceDirtyChange={setWorkspaceDirty}
          showTriage={showTriage}
          showDraft={showDraft}
          billOpen={billOpen}
          setBillOpen={setBillOpen}
          onOpenRecordedBill={onOpenRecordedBill}
          isMobile
          readOnly={readOnly}
        />
      ) : (
        <div
          ref={listRef}
          onScroll={(event) => { listScrollTopRef.current = event.currentTarget.scrollTop; }}
          data-testid="inbox-mobile-list"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}
        >
          <div className="mobile-inbox-controls">
            <div className="mobile-inbox-search-row">
              {searchOpen ? (
                <>
                  <label className="mobile-inbox-search">
                    <Search size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <input
                      ref={searchRef}
                      aria-label="Search indexed mail"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelSearch(); } }}
                      placeholder="Search mail"
                      type="search"
                      enterKeyHint="search"
                    />
                  </label>
                  <button type="button" className="mobile-inbox-control" onClick={cancelSearch}>Cancel</button>
                </>
              ) : (
                <>
                  <h1 className="mobile-inbox-title"><img src={publicAssetUrl("favicon.svg")} alt="" width={22} height={22} />{collection === "snoozed" ? "Snoozed" : "Inbox"}</h1>
                  <button
                    type="button"
                    className="mobile-inbox-control"
                    aria-label="Unread in this view"
                    aria-pressed={mobileUnreadOnly}
                    onClick={() => setMobileUnreadOnly((value) => !value)}
                  >
                    Unread
                  </button>
                  <button
                    ref={searchButtonRef}
                    type="button"
                    className="mobile-inbox-control mobile-inbox-control-icon"
                    aria-label="Search mail"
                    onClick={() => setSearchExpanded(true)}
                  >
                    <Search size={18} />
                  </button>
                  <button
                    type="button"
                    className="mobile-inbox-control mobile-inbox-control-icon"
                    aria-label="Open filters"
                    aria-haspopup="dialog"
                    aria-expanded={mobileFiltersOpen}
                    data-active={accountId !== "__all" || (!indexedSearchActive && collection === "inbox" && lane !== "__all")}
                    data-testid="inbox-mobile-filter-trigger"
                    onClick={() => setMobileFiltersOpen(true)}
                  >
                    <Filter size={18} />
                  </button>
                  {mobileShellActions}
                </>
              )}
            </div>
            {collection === "inbox" && <MobileSnapshotHeader readOnly={readOnly} snapshotNavigation={snapshotNavigation} />}
            {(scopedAccount || (!indexedSearchActive && collection === "inbox" && lane !== "__all") || indexedSearchActive) && (
              <div className="mobile-inbox-scope">
                {scopedAccount && <span>{scopedAccount.name || scopedAccount.email}</span>}
                {!indexedSearchActive && collection === "inbox" && lane !== "__all" && <span>{LANE[lane]?.label || lane}</span>}
                {indexedSearchActive && (
                  <span>{mobileUnreadOnly
                    ? `${visibleEmails.length} unread in loaded results`
                    : `${visibleEmails.length} of ${indexedSearchTotal ?? visibleEmails.length} results`}</span>
                )}
              </div>
            )}
          </div>

          {collection === "snoozed" && !indexedSearchActive && <div role="status" style={{ padding: "10px 16px", color: "#a6adc8", fontSize: 12 }}>
            {snoozedError ? <>{snoozedError} <button className="mobile-inbox-control" onClick={() => { void refreshSnoozed(); }}>Retry</button></>
              : snoozedLoading ? "Loading snoozed mail…" : `${visibleEmails.length} messages · ordered by return time`}
          </div>}
          <div style={{ padding: "6px 0 20px" }}>
            {indexedSearchError && (
              <div
                style={{
                  margin: "8px 16px",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid color-mix(in srgb, var(--sp-rose) 18%, transparent)",
                  background: "color-mix(in srgb, var(--sp-rose) 6%, transparent)",
                  color: "var(--sp-rose)",
                  fontSize: 11,
                }}
              >
                {indexedSearchError}
              </div>
            )}
            {!indexedSearchActive && liveEmailsLoading && visibleEmails.length > 0 && (
              <MobileLiveLoadingBlock compact activeSnapshotMode={activeSnapshotMode} />
            )}
            {indexedSearchActive && indexedSearchLoading ? (
              <div data-testid="inbox-mobile-search-skeleton">
                <MobileLiveSkeletonRows count={5} />
              </div>
            ) : !indexedSearchActive && liveEmailsLoading && visibleEmails.length === 0 ? (
              <MobileLiveLoadingBlock activeSnapshotMode={activeSnapshotMode} />
            ) : (
              <>
                {pinnedRows.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 16px",
                    }}
                  >
                    <Pin size={10} color="#b4befe" />
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 1.8,
                        textTransform: "uppercase",
                        color: "#b4befe",
                      }}
                    >
                      Pinned
                    </span>
                  </div>
                )}
                <AnimatePresence initial={false}>
                {pinnedRows.map((email) => (
                  <InboxRowTransition key={email.id || email.uid}>
                  <MobileEmailRow
                    email={email}
                    account={rowAccountsById[email.accountId || ""] || rowAccountsById[email._accountKey || ""]}
                    onOpen={guardedOpen}
                    showPreview={showPreview}
                    accent={accent}
                    nowTick={nowTick}
                  />
                  </InboxRowTransition>
                ))}
                </AnimatePresence>
                <AnimatePresence initial={false}>
                {restRows.map((email) => (
                  <InboxRowTransition key={email.id || email.uid}>
                  <MobileEmailRow
                    email={email}
                    account={rowAccountsById[email.accountId || ""] || rowAccountsById[email._accountKey || ""]}
                    onOpen={guardedOpen}
                    showPreview={showPreview}
                    accent={accent}
                    nowTick={nowTick}
                  />
                  </InboxRowTransition>
                ))}
                </AnimatePresence>
                {visibleEmails.length === 0 && !indexedSearchError && !snoozedError && (
                  <InboxEmptyState
                    icon={indexedSearchActive ? <SearchX size={26} strokeWidth={1.3} /> : <Inbox size={26} strokeWidth={1.3} />}
                    title={mobileUnreadOnly ? "No unread messages" : indexedSearchActive ? "No matching emails" : collection === "snoozed" ? "Nothing snoozed" : "No mail in this view"}
                    message={mobileUnreadOnly ? (indexedSearchHasMore ? "There are no unread messages in the loaded results." : "Turn off Unread to see the other messages in this view.") : indexedSearchActive ? "Try a different sender, subject, or phrase." : collection === "snoozed" ? "Emails you snooze will wait here until their return time." : "New mail will appear here when it arrives."}
                    action={mobileUnreadOnly
                      ? { label: "Show read and unread", onClick: () => setMobileUnreadOnly(false) }
                      : indexedSearchActive ? { label: "Clear search", onClick: () => { setSearch(""); setSearchExpanded(true); window.requestAnimationFrame(() => searchRef?.current?.focus()); } } : undefined}
                  />
                )}
              </>
            )}
            {indexedSearchActive && indexedSearchHasMore && (
              <div style={{ padding: "6px 16px 0" }}>
                <button
                  type="button"
                  onClick={loadMoreIndexedSearch}
                  disabled={indexedSearchLoading}
                  className="transition-transform duration-150 enabled:hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60 enabled:active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
                  style={{
                    width: "100%",
                    minHeight: "var(--sp-touch-min)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    color: "rgba(205,214,244,0.7)",
                    cursor: indexedSearchLoading ? "default" : "pointer",
                    opacity: indexedSearchLoading ? 0.6 : 1,
                    fontFamily: "inherit",
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  {indexedSearchLoading ? "Loading…" : "Show more results"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <MobileFilterSheet
        collection={collection} setCollection={setCollection} snoozedCount={snoozedCount}
        open={mobileFiltersOpen}
        accent={accent}
        accountId={accountId}
        setAccountId={setAccountId}
        accounts={emailAccounts}
        totalUnread={totalUnread}
        chipCounts={chipCounts}
        lane={lane}
        setLane={setLane}
        indexedSearchActive={indexedSearchActive}
        snapshotNavigation={activeSnapshotMode ? snapshotNavigation : null}
        unreadInView={unreadInView}
        onMarkAllRead={markAllVisibleRead}
        readOnly={readOnly}
        onClose={() => setMobileFiltersOpen(false)}
      />
      <InboxUndoToast undo={undo} onUndo={onUndo} accent={accent} />
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
    </div>
  );
}
