import DigestStrip from "./DigestStrip";
import Sidebar from "./Sidebar";
import InboxList from "./InboxList";
import Reader from "./reader/Reader";

export default function InboxDesktopPane({
  accent,
  briefingSummary,
  briefingGeneratedAt,
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
  setSelectedId,
  closeSelectedEmail,
  pinnedSet,
  billOpen,
  setBillOpen,
  accountsById,
  visibleEmails,
  laneCounts,
  liveCount,
  totalUnread,
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
  briefingAgoLabel,
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
        summary={briefingSummary}
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
          compact={sidebarCompact}
          onOpenDashboard={onOpenDashboard}
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
              emails={visibleEmails}
              accountsById={accountsById}
              selectedId={selectedEmail?.id || selectedEmail?.uid || null}
              onOpen={(email) => setSelectedId(email.id || email.uid)}
              density={density}
              layout={grouping}
              showPreview={showPreview}
              pinnedIds={pinnedSet}
              searchQuery={search}
              onSearchChange={setSearch}
              onMarkAllRead={markAllVisibleRead}
              onRefresh={onRefresh}
              totalCount={visibleEmails.length}
              unreadCount={unreadInView}
              briefingAgoLabel={briefingAgoLabel}
              briefingGeneratedAt={briefingGeneratedAt}
              searchRef={searchRef}
            />
          </div>
          {layout !== "list-only" && (
            <Reader
              key={selectedEmail?.id || selectedEmail?.uid || "empty"}
              email={selectedEmail}
              account={selectedAccount}
              accent={accent}
              pinned={!!selectedEmail && (pinnedSet.has(selectedEmail.uid) || pinnedSet.has(selectedEmail.id))}
              onAction={onAction}
              onClose={closeSelectedEmail}
              showTriage={showTriage}
              showDraft={showDraft}
              billOpen={billOpen}
              setBillOpen={setBillOpen}
              trashHoldProgress={trashHold.progress}
              snoozeHoldProgress={snoozeHold.progress}
              isMobile={false}
            />
          )}
        </div>
      </div>
    </div>
  );
}
