import { ArrowLeft } from "lucide-react";
import { useAlfredWorkspace } from "../dashboard/AlfredWorkspaceContext";
import { memo, useState } from "react";
import "./InboxDesktop.css";
import InboxDesktopHeader from "./InboxDesktopHeader";
import DigestStrip from "./DigestStrip";
import Sidebar from "./Sidebar";
import InboxList from "./InboxList";
import Reader from "./reader/Reader";
import InboxUndoToast from "./InboxUndoToast";
import type { InboxPaneProps } from "./inboxViewTypes";
import { isDemoMode } from "../../demo/config";
import useInboxDiscardPrompt from "./useInboxDiscardPrompt";

function InboxDesktopPane({
  accent,
  collection, setCollection, snoozedCount, snoozedLoading, snoozedError, refreshSnoozed,
  nowTick,
  briefingSummary,
  liveEmailsLoading = false,
  processingCount = 0,
  activeSnapshotError = null,
  emailAccounts,
  onRefresh,
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
  rowAccountsById,
  indexedSearchActive,
  indexedSearchLoading,
  indexedSearchError,
  indexedSearchTotal,
  indexedSearchHasMore,
  loadMoreIndexedSearch,
  onAskAlfred,
  onAttachEmailToAlfred,
  visibleEmails,
  laneCounts,
  chipCounts,
  noiseUnreadCount,
  unreadInView,
  onAction,
  markAllVisibleRead,
  showTriage,
  showDraft,
  showPreview,
  density,
  layout,
  grouping,
  activeSnapshotMode = false,
  snapshotNavigation = null,
  readOnly = false,
  undo,
  onUndo,
  announcement,
}: InboxPaneProps) {
  const alfredWorkspace = useAlfredWorkspace();
  const discussing = !!alfredWorkspace?.open;
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const { requestDiscard, dialog: discardDialog } = useInboxDiscardPrompt(`${selectedEmail?.account_id || selectedEmail?.accountId || ""}:${selectedEmail?.uid || selectedEmail?.email_id || selectedEmail?.id || ""}`);
  const guardWorkspaceExit = (action: () => void) => {
    const proceed = () => { setWorkspaceDirty(false); action(); };
    if (requestDiscard(workspaceDirty, proceed)) proceed();
  };
  const guardedOpen: typeof onOpen = (...args) => {
    guardWorkspaceExit(() => onOpen(...args));
  };
  const guardedCollection = (value: "inbox" | "snoozed") => {
    guardWorkspaceExit(() => { closeSelectedEmail(); setCollection(value); });
  };
  const guardedClose = () => {
    guardWorkspaceExit(closeSelectedEmail);
  };
  const guardedSnapshotNavigation = snapshotNavigation ? {
    ...snapshotNavigation,
    onReturnToCurrent: snapshotNavigation.onReturnToCurrent ? () => {
      guardWorkspaceExit(() => snapshotNavigation.onReturnToCurrent?.());
    } : undefined,
    onNavigate: (direction: "older" | "newer") => {
      guardWorkspaceExit(() => { void snapshotNavigation.onNavigate(direction); });
    },
  } : null;
  const selectedIndex = selectedEmail ? visibleEmails.findIndex((email) => (email.id || email.uid) === (selectedEmail.id || selectedEmail.uid)) : -1;
  const previousEmail = selectedIndex > 0 ? visibleEmails[selectedIndex - 1] : undefined;
  const nextEmail = selectedIndex >= 0 ? visibleEmails[selectedIndex + 1] : undefined;
  const selectedUid = selectedEmail?.uid || selectedEmail?.email_id || selectedEmail?.id;
  const attachSelectedEmail = !isDemoMode() && selectedEmail && selectedUid && onAttachEmailToAlfred
    ? () => onAttachEmailToAlfred({
      uid: String(selectedUid),
      accountId: selectedEmail.account_id
        || selectedEmail.accountId
        || selectedEmail._account?.account_id
        || selectedEmail._account?.id
        || selectedAccount?.account_id
        || selectedAccount?.id
        || null,
      subject: selectedEmail.subject,
      senderName: selectedEmail.from || selectedEmail.from_name,
      senderAddress: selectedEmail.fromEmail || selectedEmail.from_email || selectedEmail.from_address,
      timestamp: selectedEmail.date || selectedEmail.email_date,
    })
    : undefined;
  return (
    <div
      data-testid="inbox-desktop-view"
      className="inbox-a-desktop"
      data-alfred-open={discussing}
      data-reading={!!selectedEmail && layout !== "list-only"}
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
      <InboxDesktopHeader
        accent={accent}
        search={search}
        onSearchChange={setSearch}
        searchRef={searchRef}
        onAskAlfred={onAskAlfred}
        navigation={collection === "snoozed" ? null : guardedSnapshotNavigation}
        readOnly={readOnly}
        processingCount={processingCount}
        liveLoading={liveEmailsLoading}
      />
      {!activeSnapshotMode && (
        <DigestStrip
          accent={accent}
          counts={laneCounts}
          liveLoading={liveEmailsLoading}
          processingCount={processingCount}
          summary={briefingSummary}
          onJumpLane={(key) => setLane(key)}
        />
      )}

      {discussing && selectedEmail && layout !== "list-only" && (
        <div className="inbox-a-discussion-toolbar">
          <button type="button" className="inbox-a-control" onClick={alfredWorkspace?.close}>
            <ArrowLeft size={14} aria-hidden="true" /> Back to mail list
          </button>
        </div>
      )}
      <div className="inbox-a-workspace">
        <Sidebar
          accounts={emailAccounts}
          accountId={accountId}
          onAccountChange={setAccountId}
          accent={accent}
          lane={lane}
          laneCounts={chipCounts}
          onLaneChange={(value) => guardWorkspaceExit(() => { closeSelectedEmail(); setCollection("inbox"); setLane(value); })}
          collection={collection} onCollectionChange={guardedCollection} snoozedCount={snoozedCount}
          searchActive={indexedSearchActive}
          selectedEmail={selectedEmail}
          readOnly={readOnly}
        />

        <div className="inbox-a-panes" data-list-only={layout === "list-only"} data-reading={!!selectedEmail}>
          <div className="inbox-a-queue">
            <InboxList
              accent={accent}
              collection={collection} snoozedLoading={snoozedLoading} snoozedError={snoozedError}
              nowTick={nowTick}
              emails={visibleEmails}
              accountsById={rowAccountsById}
              selectedId={selectedEmail?.id || selectedEmail?.uid || null}
              onOpen={guardedOpen}
              density={density}
              layout={indexedSearchActive ? "flat" : grouping}
              showPreview={showPreview}
              searchQuery={search}
              onClearSearch={() => { setSearch(""); searchRef?.current?.focus(); }}
              onShowAllMail={() => guardWorkspaceExit(() => { closeSelectedEmail(); setCollection("inbox"); setLane("__all"); })}
              onMarkAllRead={markAllVisibleRead}
              onRefresh={collection === "snoozed" ? refreshSnoozed : onRefresh}
              readOnly={readOnly}
              liveEmailsLoading={liveEmailsLoading}
              activeSnapshotError={activeSnapshotError}
              indexedSearchActive={indexedSearchActive}
              indexedSearchLoading={indexedSearchLoading}
              indexedSearchError={indexedSearchError}
              indexedSearchTotal={indexedSearchTotal}
              indexedSearchHasMore={indexedSearchHasMore}
              onLoadMoreSearch={loadMoreIndexedSearch}
              totalCount={visibleEmails.length}
              unreadCount={unreadInView}
              noiseUnreadCount={noiseUnreadCount}
              activeSnapshotMode={activeSnapshotMode}
              lane={lane}
            />
          </div>
          {layout !== "list-only" && (
            <Reader
              key={selectedEmail?.id || selectedEmail?.uid || "empty"}
              email={selectedEmail}
              account={selectedAccount}
              accent={accent}
              onAction={(kind, payload) => { if (kind === "unsnooze") guardWorkspaceExit(() => { onAction(kind, payload); }); else onAction(kind, payload); }}
              onClose={guardedClose}
              onPrevious={previousEmail ? () => guardedOpen(previousEmail) : undefined}
              onNext={nextEmail ? () => guardedOpen(nextEmail) : undefined}
              onWorkspaceDirtyChange={setWorkspaceDirty}
              onRequestDiscard={requestDiscard}
              showTriage={showTriage}
              showDraft={showDraft}
              onAskAlfred={attachSelectedEmail}
              isMobile={false}
              readOnly={readOnly}
            />
          )}
        </div>
        <div ref={alfredWorkspace?.setDockTarget} className="inbox-a-alfred-dock" aria-hidden="true" />
      </div>
      <InboxUndoToast undo={undo} onUndo={onUndo} accent={accent} />
      {discardDialog}
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
    </div>
  );
}

// Memoize the desktop pane so a parent re-render with stable props does not
// cascade into DigestStrip + Sidebar + InboxList + Reader. Combined with the
// per-lane LaneSection memo, a single item mutation no longer re-renders the
// whole pane.
export default memo(InboxDesktopPane);
