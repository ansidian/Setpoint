import { memo, useState } from "react";
import DigestStrip from "./DigestStrip";
import Sidebar from "./Sidebar";
import InboxList from "./InboxList";
import Reader from "./reader/Reader";
import InboxUndoToast from "./InboxUndoToast";
import type { InboxPaneProps } from "./inboxViewTypes";
import { isDemoMode } from "../../demo/config";

function InboxDesktopPane({
  accent,
  nowTick,
  briefingSummary,
  liveEmailsLoading = false,
  processingCount = 0,
  activeSnapshotError = null,
  emailAccounts,
  onOpenDashboard,
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
  onAskAlfred,
  onAttachEmailToAlfred,
  visibleEmails,
  laneCounts,
  totalUnread,
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
  snapshotCategories = [],
  categoryFilter = "__all",
  setCategoryFilter,
  readOnly = false,
  undo,
  onUndo,
  announcement,
}: InboxPaneProps) {
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const allowWorkspaceExit = () => !workspaceDirty || window.confirm("Discard your unsaved changes?");
  const guardedOpen: typeof onOpen = (...args) => {
    if (!allowWorkspaceExit()) return;
    setWorkspaceDirty(false);
    onOpen(...args);
  };
  const guardedClose = () => {
    if (!allowWorkspaceExit()) return;
    setWorkspaceDirty(false);
    closeSelectedEmail();
  };
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
      <DigestStrip
        accent={accent}
        counts={laneCounts}
        liveLoading={liveEmailsLoading}
        processingCount={processingCount}
        summary={briefingSummary}
        activeSnapshotMode={activeSnapshotMode}
        readOnly={readOnly}
        accountCount={emailAccounts.length}
        onJumpLane={(key) => setLane(key)}
      />

      <div style={{ flex: 1, display: "flex", minHeight: 0, padding: "14px 18px 18px", gap: 14 }}>
        <Sidebar
          accent={accent}
          accounts={emailAccounts}
          accountId={accountId}
          setAccountId={setAccountId}
          lane={lane}
          setLane={setLane}
          laneCounts={laneCounts}
          totalUnread={totalUnread}
          noiseUnreadCount={noiseUnreadCount}
          onOpenDashboard={onOpenDashboard}
          selectedEmail={selectedEmail}
          readOnly={readOnly}
        />

        <div
          style={{
            flex: 1,
            display: "flex",
            minWidth: 0,
            minHeight: 0,
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: 14,
            overflow: "hidden",
            background: "color-mix(in srgb, var(--sp-panel) 40%, transparent)",
            boxShadow: "0 20px 40px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.03)",
          }}
        >
          <div
            style={{
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: billOpen ? "28%" : "43%",
              minWidth: 260,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <InboxList
              accent={accent}
              nowTick={nowTick}
              emails={visibleEmails}
              accountsById={rowAccountsById}
              selectedId={selectedEmail?.id || selectedEmail?.uid || null}
              onOpen={guardedOpen}
              density={density}
              layout={indexedSearchActive ? "flat" : grouping}
              showPreview={showPreview}
              searchQuery={search}
              onSearchChange={setSearch}
              onMarkAllRead={markAllVisibleRead}
              onRefresh={onRefresh}
              readOnly={readOnly}
              liveEmailsLoading={liveEmailsLoading}
              processingCount={processingCount}
              activeSnapshotError={activeSnapshotError}
              indexedSearchActive={indexedSearchActive}
              indexedSearchLoading={indexedSearchLoading}
              indexedSearchError={indexedSearchError}
              indexedSearchTotal={indexedSearchTotal}
              indexedSearchHasMore={indexedSearchHasMore}
              onLoadMoreSearch={loadMoreIndexedSearch}
              onAskAlfred={onAskAlfred}
              totalCount={visibleEmails.length}
              unreadCount={unreadInView}
              noiseUnreadCount={noiseUnreadCount}
              searchRef={searchRef}
              activeSnapshotMode={activeSnapshotMode}
              snapshotCategories={snapshotCategories}
              categoryFilter={categoryFilter}
              onCategoryFilterChange={setCategoryFilter}
            />
          </div>
          {layout !== "list-only" && (
            <Reader
              key={selectedEmail?.id || selectedEmail?.uid || "empty"}
              email={selectedEmail}
              account={selectedAccount}
              accent={accent}
              onAction={onAction}
              onClose={guardedClose}
              onWorkspaceDirtyChange={setWorkspaceDirty}
              showTriage={showTriage}
              showDraft={showDraft}
              billOpen={billOpen}
              setBillOpen={setBillOpen}
              onOpenRecordedBill={onOpenRecordedBill}
              onAskAlfred={attachSelectedEmail}
              isMobile={false}
              readOnly={readOnly}
            />
          )}
        </div>
      </div>
      <InboxUndoToast undo={undo} onUndo={onUndo} accent={accent} />
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
    </div>
  );
}

// Memoize the desktop pane so a parent re-render with stable props does not
// cascade into DigestStrip + Sidebar + InboxList + Reader. Combined with the
// per-lane LaneSection memo, a single item mutation no longer re-renders the
// whole pane.
export default memo(InboxDesktopPane);
