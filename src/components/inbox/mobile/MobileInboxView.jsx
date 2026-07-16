import {
  CheckCheck,
  Filter,
  Pin,
  Search,
  Sparkles,
} from "lucide-react";
import EmailRow from "../EmailRow";
import Reader from "../reader/Reader";
import MobileFilterSheet from "./MobileFilterSheet";
import { Skeleton } from "@/components/ui/skeleton";
import InboxSearchFlagChips from "../InboxSearchFlagChips";
import { buildActiveSnapshotSummary } from "../snapshotSummary";
import InboxUndoToast from "../InboxUndoToast";
import { selectVisibleMobileChips } from "../inboxCountsModel";

const MOBILE_FILTER_CHIPS = [
  { key: "__all", label: "All" },
  { key: "__live", label: "New" },
  { key: "queued", label: "Queue" },
  { key: "carryover", label: "Carry" },
  { key: "needs_attention", label: "Needs" },
  { key: "catch_up", label: "Catch" },
  { key: "fyi", label: "FYI" },
  { key: "handled", label: "Handled" },
  { key: "untriaged_read", label: "Read" },
  { key: "noise", label: "Noise" },
];

function MobileChip({ active, label, count, onClick, accent }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        flexShrink: 0,
        minWidth: 0,
        minHeight: "var(--sp-touch-min)",
        padding: "8px 6px",
        borderRadius: 999,
        border: `1px solid ${active ? `${accent}48` : "rgba(255,255,255,0.08)"}`,
        background: active ? `${accent}16` : "rgba(255,255,255,0.03)",
        color: active ? "#fff" : "rgba(205,214,244,0.72)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 10.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <span
        style={{
          minWidth: 16,
          height: 16,
          padding: "0 4px",
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: active ? `${accent}28` : "rgba(255,255,255,0.06)",
          color: active ? accent : "var(--color-text-faint)",
          fontSize: 8.5,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}
      >
        {count}
      </span>
    </button>
  );
}

function MobileIconButton({ icon, label, onClick, accent, buttonRef, tinted = false, testId }) {
  const Icon = icon;
  const baseStyle = {
    width: "var(--sp-touch-min)",
    height: "var(--sp-touch-min)",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    border: `1px solid ${tinted ? `${accent}40` : "rgba(255,255,255,0.08)"}`,
    background: tinted ? `${accent}16` : "rgba(255,255,255,0.03)",
    color: tinted ? accent : "rgba(205,214,244,0.7)",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 160ms ease-out, border-color 160ms ease-out, color 160ms ease-out",
  };
  const focusStyle = {
    background: tinted ? `${accent}24` : "rgba(255,255,255,0.07)",
    borderColor: tinted ? `${accent}66` : "rgba(255,255,255,0.14)",
    color: tinted ? "#fff" : "rgba(205,214,244,0.9)",
  };
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      onFocus={(event) => Object.assign(event.currentTarget.style, focusStyle)}
      onBlur={(event) => Object.assign(event.currentTarget.style, baseStyle)}
      style={baseStyle}
    >
      <Icon size={18} />
    </button>
  );
}

function MobileLiveSkeletonRows({ count = 4, compact = false }) {
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

function MobileLiveLoadingBlock({ compact = false, activeSnapshotMode = false }) {
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
  nowTick,
  briefingSummary,
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
  onAskAlfred,
  visibleEmails,
  mobileChipCounts,
  totalUnread,
  noiseUnreadCount = 0,
  unreadInView,
  markAllVisibleRead,
  onAction,
  showTriage,
  showDraft,
  showPreview,
  density,
  scopedAccount,
  liveEmailsLoading = false,
  activeSnapshotMode = false,
  readOnly = false,
  undo,
  onUndo,
  announcement,
}) {
  const snapshotSummary = activeSnapshotMode
    ? buildActiveSnapshotSummary(mobileChipCounts, emailAccounts.length)
    : briefingSummary;
  // visibleEmails arrives pinned-first (selectVisibleEmails sorts pinned rows
  // ahead of everything else, newest pin first), so splitting off the pinned
  // block for the compact group header is a findIndex split, not a re-sort.
  const pinnedCount = visibleEmails.findIndex((e) => !e._pinned);
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
          onAction={onAction}
          onClose={closeSelectedEmail}
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
          data-testid="inbox-mobile-list"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}
        >
          <div style={{ padding: "10px 16px 0" }}>
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                background: `linear-gradient(135deg, ${accent}12, color-mix(in srgb, var(--sp-cyan) 4%, transparent))`,
                border: `1px solid ${accent}2c`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={13} color={accent} />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1.8,
                    textTransform: "uppercase",
                    color: accent,
                  }}
                >
                  {activeSnapshotMode ? "Active snapshot" : "Inbox snapshot"}
                </span>
                <span style={{ flex: 1 }} />
                {noiseUnreadCount > 0 && (
                  <span style={{ fontSize: 10.5, color: "var(--color-text-faint)", whiteSpace: "nowrap" }}>
                    <span style={{ color: "rgba(205,214,244,0.78)", fontWeight: 700 }}>{noiseUnreadCount}</span> noise unread
                  </span>
                )}
              </div>
              {snapshotSummary && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    lineHeight: 1.4,
                    color: "rgba(205,214,244,0.82)",
                  }}
                >
                  {snapshotSummary}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 4,
              padding: "12px 16px 10px",
              marginTop: 14,
              // Opaque sticky header (mirrors the desktop StickyHeader pattern). A
              // backdrop-filter blur here forced a full-viewport GPU re-rasterization
              // on every scroll frame — one of the most expensive mobile scroll costs.
              // The background was already ~98% opaque, so dropping the blur is visually
              // near-identical while removing the per-frame compositor work.
              background: "linear-gradient(180deg, color-mix(in srgb, var(--sp-deep) 99%, transparent), color-mix(in srgb, var(--sp-deep) 97%, transparent))",
              borderTop: "1px solid rgba(255,255,255,0.04)",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "0 10px",
                  height: 36,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Search size={13} color="rgba(205,214,244,0.45)" />
                <input
                  ref={searchRef}
                  aria-label="Search indexed mail"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      onAskAlfred(search);
                    }
                  }}
                  placeholder="Search indexed mail"
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "var(--sp-text)",
                    fontSize: 16,
                    fontFamily: "inherit",
                  }}
                />
              </div>
              <MobileIconButton
                icon={Sparkles}
                label="Ask Alfred"
                onClick={() => onAskAlfred(search)}
                accent={accent}
                tinted={false}
                testId="inbox-mobile-ask-alfred-trigger"
              />
              <MobileIconButton
                icon={Filter}
                label="Open filters"
                onClick={() => setMobileFiltersOpen(true)}
                accent={accent}
                testId="inbox-mobile-filter-trigger"
              />
              {!readOnly && (
                <MobileIconButton
                  icon={CheckCheck}
                  label="Mark all read"
                  onClick={markAllVisibleRead}
                  accent={accent}
                  tinted={unreadInView > 0}
                />
              )}
            </div>
            <div
              data-testid="inbox-mobile-chip-grid"
              style={{
                display: "flex",
                flexWrap: "nowrap",
                alignItems: "center",
                gap: 6,
                paddingTop: 10,
                overflowX: "auto",
                scrollbarWidth: "none",
                WebkitOverflowScrolling: "touch",
              }}
            >
              <InboxSearchFlagChips
                query={search}
                onChange={setSearch}
                accent={accent}
                compact
              />
              {(indexedSearchActive
                ? [{ key: "__all", label: "All" }]
                : selectVisibleMobileChips(MOBILE_FILTER_CHIPS, mobileChipCounts, { activeLane: lane })
              ).map((chip) => (
                <MobileChip
                  key={chip.key}
                  active={indexedSearchActive ? true : lane === chip.key}
                  label={chip.label}
                  count={indexedSearchActive ? visibleEmails.length : mobileChipCounts[chip.key]}
                  onClick={() => setLane(chip.key)}
                  accent={accent}
                />
              ))}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingTop: 10,
                fontSize: 11,
                color: "var(--color-text-faint)",
              }}
            >
              <span>{scopedAccount ? scopedAccount.name || scopedAccount.email : "All accounts"}</span>
              <span style={{ opacity: 0.35 }}>·</span>
              <span>
                {indexedSearchActive
                  ? `${visibleEmails.length} of ${indexedSearchTotal ?? visibleEmails.length} indexed`
                  : `${visibleEmails.length} shown`}
              </span>
            </div>
          </div>

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
            ) : visibleEmails.length > 0 ? (
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
                {pinnedRows.map((email) => (
                  <EmailRow
                    key={email.id || email.uid}
                    email={email}
                    account={rowAccountsById[email.accountId] || rowAccountsById[email._accountKey]}
                    selected={false}
                    onOpen={onOpen}
                    density={density}
                    showPreview={showPreview}
                    accent={accent}
                    nowTick={nowTick}
                    showLaneTag
                  />
                ))}
                {restRows.map((email) => (
                  <EmailRow
                    key={email.id || email.uid}
                    email={email}
                    account={rowAccountsById[email.accountId] || rowAccountsById[email._accountKey]}
                    selected={false}
                    onOpen={onOpen}
                    density={density}
                    showPreview={showPreview}
                    accent={accent}
                    nowTick={nowTick}
                    showLaneTag
                  />
                ))}
                {indexedSearchActive && indexedSearchHasMore && (
                  <div style={{ padding: "6px 16px 0" }}>
                    <button
                      type="button"
                      onClick={loadMoreIndexedSearch}
                      disabled={indexedSearchLoading}
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
              </>
            ) : (
              <div
                style={{
                  padding: "36px 18px",
                  textAlign: "center",
                  color: "var(--color-text-faint)",
                  fontSize: 12,
                }}
              >
                {indexedSearchActive ? "No indexed mail matches" : "No emails match this view."}
              </div>
            )}
          </div>
        </div>
      )}

      <MobileFilterSheet
        open={mobileFiltersOpen}
        accent={accent}
        accountId={accountId}
        setAccountId={setAccountId}
        accounts={emailAccounts}
        totalUnread={totalUnread}
        onClose={() => setMobileFiltersOpen(false)}
      />
      <InboxUndoToast undo={undo} onUndo={onUndo} accent={accent} />
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
    </div>
  );
}
