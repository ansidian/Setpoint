import { memo } from "react";
import DigestStrip from "./DigestStrip";
import Sidebar from "./Sidebar";
import InboxList from "./InboxList";
import Reader from "./reader/Reader";
import InboxUndoToast from "./InboxUndoToast";

function InboxDesktopPane({
  accent,
  nowTick,
  briefingSummary,
  briefingGeneratedAt,
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
  rowAccountsById,
  indexedSearchActive,
  indexedSearchLoading,
  indexedSearchError,
  onAskAlfred,
  visibleEmails,
  laneCounts,
  liveCount,
  totalUnread,
  noiseUnreadCount,
  unreadInView,
  onAction,
  markAllVisibleRead,
  trashHold,
  snoozeHold,
  showTriage,
  showDraft,
  showPreview,
  density,
  sidebarCompact,
  layout,
  grouping,
  activeSnapshotMode = false,
  snapshotCategories = [],
  categoryFilter = "__all",
  setCategoryFilter,
  readOnly = false,
  undo,
  onUndo,
}) {
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
        color: "#cdd6f4",
      }}
    >
      <DigestStrip
        accent={accent}
        counts={laneCounts}
        liveCount={liveCount}
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
          compact={sidebarCompact}
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
            background: "rgba(22,22,30,0.4)",
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
              onOpen={onOpen}
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
              onAskAlfred={onAskAlfred}
              totalCount={visibleEmails.length}
              unreadCount={unreadInView}
              noiseUnreadCount={noiseUnreadCount}
              briefingGeneratedAt={briefingGeneratedAt}
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
              onClose={closeSelectedEmail}
              showTriage={showTriage}
              showDraft={showDraft}
              billOpen={billOpen}
              setBillOpen={setBillOpen}
              trashHoldProgress={trashHold.progress}
              snoozeHoldProgress={snoozeHold.progress}
              isMobile={false}
              readOnly={readOnly}
            />
          )}
        </div>
      </div>
      <InboxUndoToast undo={undo} onUndo={onUndo} accent={accent} />
    </div>
  );
}

// Memoize the desktop pane so a parent re-render with stable props does not
// cascade into DigestStrip + Sidebar + InboxList + Reader. Combined with the
// per-lane LaneSection memo, a single item mutation no longer re-renders the
// whole pane.
export default memo(InboxDesktopPane);
