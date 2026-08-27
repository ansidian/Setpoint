import {
  CheckCheck,
  Filter,
  Pin,
  Search,
} from "lucide-react";
import EmailRow from "../EmailRow";
import Reader from "../reader/Reader";
import MobileFilterSheet from "./MobileFilterSheet";
import { Skeleton } from "@/components/ui/skeleton";
import InboxSearchFlagChips from "../InboxSearchFlagChips";
import InboxUndoToast from "../InboxUndoToast";
import MobileSnapshotHeader from "./MobileSnapshotHeader";
import { selectVisibleInboxLaneChips } from "../inboxCountsModel";
import type { CSSProperties, MouseEventHandler, Ref } from "react";
import type { LucideIcon } from "lucide-react";
import type { InboxPaneProps } from "../inboxViewTypes";
import { useState } from "react";

const MOBILE_FILTER_CHIPS = [
  { key: "__all", label: "All" },
  { key: "needs_attention", label: "Needs" },
  { key: "fyi", label: "FYI" },
  { key: "noise", label: "Noise" },
];

function MobileChip({ active, label, count, onClick, accent }: {
  active: boolean;
  label?: string;
  count?: number;
  onClick: MouseEventHandler<HTMLButtonElement>;
  accent: string;
}) {
  return (
    <button
      type="button"
      aria-label={typeof count === "number" ? `${label}, ${count}` : label}
      aria-pressed={active}
      onClick={onClick}
      className="transition-transform duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        minWidth: 0,
        minHeight: "var(--sp-touch-min)",
        padding: 0,
        borderRadius: 8,
        border: "none",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 10.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          height: 30,
          padding: "0 9px",
          borderRadius: 8,
          border: `1px solid ${active ? `${accent}48` : "rgba(255,255,255,0.08)"}`,
          background: active ? `${accent}16` : "rgba(255,255,255,0.03)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: active ? "#fff" : "rgba(205,214,244,0.72)",
          }}
        >
          {label}
        </span>
        {typeof count === "number" && (
          <span
            style={{
              color: active ? accent : "rgba(205,214,244,0.46)",
              fontSize: 9,
              fontWeight: 750,
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {count}
          </span>
        )}
      </span>
    </button>
  );
}

function MobileIconButton({ icon, label, onClick, accent, buttonRef, tinted = false, testId }: {
  icon: LucideIcon;
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  accent: string;
  buttonRef?: Ref<HTMLButtonElement>;
  tinted?: boolean;
  testId?: string;
}) {
  const Icon = icon;
  const baseStyle: CSSProperties = {
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
  const focusStyle: CSSProperties = {
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
      className="transition-transform duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
      onFocus={(event) => Object.assign(event.currentTarget.style, focusStyle)}
      onBlur={(event) => Object.assign(event.currentTarget.style, baseStyle)}
      style={baseStyle}
    >
      <Icon size={18} />
    </button>
  );
}

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
  visibleEmails,
  chipCounts,
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
  snapshotNavigation = null,
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
          onClose={guardedClose}
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
          data-testid="inbox-mobile-list"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}
        >
          <MobileSnapshotHeader
            accent={accent}
            activeSnapshotMode={activeSnapshotMode}
            readOnly={readOnly}
            summary={activeSnapshotMode ? null : briefingSummary}
            noiseUnreadCount={noiseUnreadCount}
            snapshotNavigation={snapshotNavigation}
          />

          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 4,
              padding: "20px 16px 10px",
              marginTop: 0,
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
                  minWidth: 0,
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
                  placeholder="Search indexed mail"
                  style={{
                    flex: 1,
                    minWidth: 0,
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
                gap: 4,
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
                : selectVisibleInboxLaneChips(MOBILE_FILTER_CHIPS, chipCounts)
              ).map((chip) => (
                <MobileChip
                  key={chip.key}
                  active={indexedSearchActive ? true : lane === chip.key}
                  label={chip.label}
                  count={chip.key === "__all" ? undefined : chipCounts[chip.key]}
                  onClick={() => setLane(chip.key)}
                  accent={accent}
                />
              ))}
            </div>

            {(scopedAccount || indexedSearchActive) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  paddingTop: 7,
                  fontSize: 10.5,
                  color: "var(--color-text-faint)",
                }}
              >
                {scopedAccount && <span>{scopedAccount.name || scopedAccount.email}</span>}
                {indexedSearchActive && (
                  <span>{`${visibleEmails.length} of ${indexedSearchTotal ?? visibleEmails.length} indexed`}</span>
                )}
              </div>
            )}
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
                    account={rowAccountsById[email.accountId || ""] || rowAccountsById[email._accountKey || ""]}
                    selected={false}
                    onOpen={guardedOpen}
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
                    account={rowAccountsById[email.accountId || ""] || rowAccountsById[email._accountKey || ""]}
                    selected={false}
                    onOpen={guardedOpen}
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
