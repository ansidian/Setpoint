import { useState, useMemo, useCallback } from "react";
import type { MouseEventHandler, RefObject } from "react";
import {
  Mail, Search, CheckCheck, RefreshCw,
  X,
} from "lucide-react";
import { Kbd, IconBtn } from "./primitives";
import EmailRow from "./EmailRow";
import EmptyStateSplash from "../shared/EmptyStateSplash";
import { Skeleton } from "@/components/ui/skeleton";
import InboxSearchFlagChips from "./InboxSearchFlagChips";
import InboxLaneFilterBar from "./InboxLaneFilterBar";
import LaneSection from "./LaneSection";
import DesktopSnapshotNavigator from "./DesktopSnapshotNavigator";
import type { InboxAccount, InboxEmailLike, InboxId } from "./inboxTypes";
import type { InboxSnapshotNavigation } from "./inboxViewTypes";

type CollapsedLanes = Record<string, boolean | undefined>;
type GroupedEmails = Record<string, InboxEmailLike[]> & {
  pinned: InboxEmailLike[];
  queued: InboxEmailLike[];
  carryover: InboxEmailLike[];
  needs_attention: InboxEmailLike[];
  action: InboxEmailLike[];
  catch_up: InboxEmailLike[];
  fyi: InboxEmailLike[];
  handled: InboxEmailLike[];
  untriaged_read: InboxEmailLike[];
  noise: InboxEmailLike[];
};

function createGroupedEmails(): GroupedEmails {
  return {
    pinned: [], queued: [], carryover: [], needs_attention: [],
    action: [], catch_up: [], fyi: [], handled: [], untriaged_read: [], noise: [],
  };
}

/* ======================================================================
 * LIST (swimlane or flat)
 * ====================================================================== */
function InboxLiveSkeletonRows({ count = 5, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div data-testid="inbox-live-skeleton" style={{ padding: compact ? "6px 0 2px" : "10px 12px 16px" }}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          style={{
            padding: compact ? "10px 0" : "12px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Skeleton style={{ width: 28, height: 28, borderRadius: 999, background: "rgba(205,214,244,0.10)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton style={{ width: index % 2 ? "58%" : "72%", height: 10, background: "rgba(205,214,244,0.11)" }} />
              <Skeleton style={{ width: index % 2 ? "78%" : "64%", height: 8, marginTop: 8, background: "rgba(205,214,244,0.07)" }} />
            </div>
            <Skeleton style={{ width: 42, height: 8, background: "rgba(205,214,244,0.08)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function InboxLiveLoadingBlock({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-testid="inbox-live-loading-block"
      style={{
        margin: "10px 12px 6px",
        padding: compact ? "10px 12px 8px" : "10px 12px 12px",
        borderRadius: 8,
        border: "1px solid color-mix(in srgb, var(--sp-blue) 18%, transparent)",
        background: "color-mix(in srgb, var(--sp-blue) 6%, transparent)",
        color: "rgba(205,214,244,0.72)",
        fontSize: 11,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Skeleton style={{ width: 8, height: 8, borderRadius: 999, background: "color-mix(in srgb, var(--sp-blue) 75%, transparent)" }} />
        Checking live mail
      </div>
      <InboxLiveSkeletonRows count={compact ? 2 : 3} compact />
    </div>
  );
}

function InboxSearchSkeletonRows() {
  return (
    <div data-testid="inbox-search-skeleton">
      <InboxLiveSkeletonRows count={5} />
    </div>
  );
}

export default function InboxList({
  accent, nowTick, emails, accountsById,
  selectedId, onOpen, density, layout, showPreview,
  searchQuery, onSearchChange, onMarkAllRead, onRefresh,
  totalCount, unreadCount, noiseUnreadCount = 0, searchRef,
  liveEmailsLoading = false,
  indexedSearchActive = false,
  indexedSearchLoading = false,
  indexedSearchError = null,
  indexedSearchTotal = null,
  indexedSearchHasMore = false,
  onLoadMoreSearch = () => {},
  onAskAlfred = () => {},
  activeSnapshotMode = false,
  processingCount = 0,
  activeSnapshotError = null,
  lane = "__all",
  laneCounts = {},
  onLaneChange = () => {},
  snapshotNavigation = null,
  readOnly = false,
}: {
  accent: string;
  nowTick?: number;
  emails: InboxEmailLike[];
  accountsById: Record<string, InboxAccount | undefined>;
  selectedId: InboxId | null;
  onOpen: (email: InboxEmailLike) => void;
  density: string;
  layout: string;
  showPreview: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onMarkAllRead: MouseEventHandler<HTMLButtonElement>;
  onRefresh: MouseEventHandler<HTMLButtonElement>;
  totalCount: number;
  unreadCount: number;
  noiseUnreadCount?: number;
  searchRef: RefObject<HTMLInputElement | null> | null;
  liveEmailsLoading?: boolean;
  indexedSearchActive?: boolean;
  indexedSearchLoading?: boolean;
  indexedSearchError?: string | null;
  indexedSearchTotal?: number | null;
  indexedSearchHasMore?: boolean;
  onLoadMoreSearch?: MouseEventHandler<HTMLButtonElement>;
  onAskAlfred?: (query: string) => void;
  activeSnapshotMode?: boolean;
  processingCount?: number;
  activeSnapshotError?: string | null;
  lane?: string;
  laneCounts?: Record<string, number | undefined>;
  onLaneChange?: (lane: string) => void;
  snapshotNavigation?: InboxSnapshotNavigation | null;
  readOnly?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<CollapsedLanes>(() => (activeSnapshotMode ? { handled: true, untriaged_read: true, noise: true } : {}));
  const effectiveCollapsed = activeSnapshotMode ? { handled: true, untriaged_read: true, noise: true, ...collapsed } : collapsed;
  const toggleLane = (k: string) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));
  const showSkeletonRows = !activeSnapshotMode && liveEmailsLoading && emails.length === 0;
  const showSearchSkeletonRows = indexedSearchActive && indexedSearchLoading;

  // Only the swimlane layout consumes `grouped`; flat (and mobile, which passes
  // grouping:'flat') render `emails` directly via renderRows. Gate the O(n)
  // bucketing + live re-sort on the layout so non-swimlane views skip it.
  const grouped = useMemo(() => {
    const g = createGroupedEmails();
    if (layout !== "swimlanes") return g;
    for (const e of emails) {
      if (e._pinned) g.pinned.push(e);
      else {
        const laneKey = e._lane === "action" ? "needs_attention" : e._lane;
        if (laneKey) g[laneKey]?.push(e);
      }
    }
    return g;
  }, [emails, layout]);

  // Stable across unrelated InboxList re-renders (filters, sheet toggles, hover
  // state, etc.) so LaneSection's memo actually engages — see LaneSection.tsx.
  // selectedId and nowTick still legitimately churn this on selection changes
  // and the relative-time tick.
  const renderRows = useCallback((list: InboxEmailLike[]) => list.map((email) => {
    const rowKey = email.id || email.uid;
    const accountKey = email.accountId || email.account_id || email._accountKey || "";
    return (
      <div
        key={rowKey}
      >
        <EmailRow
          email={email}
          account={accountsById[accountKey]}
          selected={selectedId === email.id}
          onOpen={onOpen}
          density={density}
          showPreview={showPreview}
          accent={accent}
          nowTick={nowTick}
        />
      </div>
    );
  }), [accountsById, selectedId, onOpen, density, showPreview, accent, nowTick]);

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", minWidth: 0, flex: 1,
        background: "color-mix(in srgb, var(--sp-mantle) 30%, transparent)",
        borderRight: "1px solid rgba(255,255,255,0.04)",
        minHeight: 0,
      }}
    >
      {activeSnapshotMode && (
        <DesktopSnapshotNavigator
          navigation={snapshotNavigation}
          liveLoading={liveEmailsLoading}
          processingCount={processingCount}
          readOnly={readOnly}
        />
      )}
      <div
        style={{
          padding: "12px 14px", display: "flex", alignItems: "center", gap: 10,
          borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0,
        }}
      >
        <div
          style={{
            flex: 1, display: "flex", alignItems: "center", gap: 8,
            padding: "7px 10px", borderRadius: 8,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <Search size={12} color="rgba(205,214,244,0.4)" />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onAskAlfred(searchQuery);
              } else if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                if (searchQuery) onSearchChange("");
                e.currentTarget.blur();
              }
            }}
            aria-label="Search indexed mail"
            placeholder="Search indexed mail"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontSize: 12, color: "var(--sp-text)", fontFamily: "inherit",
            }}
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              title="Clear search"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 18, height: 18, padding: 0,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 4, cursor: "pointer",
                color: "rgba(205,214,244,0.7)", fontFamily: "inherit",
                transition: "background 120ms, border-color 120ms, color 120ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "color-mix(in srgb, var(--sp-rose) 14%, transparent)";
                e.currentTarget.style.borderColor = "color-mix(in srgb, var(--sp-rose) 32%, transparent)";
                e.currentTarget.style.color = "var(--sp-rose)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                e.currentTarget.style.color = "rgba(205,214,244,0.7)";
              }}
            >
              <X size={10} />
            </button>
          ) : (
            <Kbd>⌘F</Kbd>
          )}
        </div>
        <InboxSearchFlagChips
          query={searchQuery}
          onChange={onSearchChange}
          accent={accent}
        />
        {!readOnly && (
          <IconBtn
            onClick={onMarkAllRead}
            title="Mark all read"
            tinted={unreadCount > 0}
            accent={accent}
          >
            <CheckCheck size={11} />
          </IconBtn>
        )}
        {!readOnly && <IconBtn onClick={onRefresh} title="Sync now"><RefreshCw size={11} /></IconBtn>}
      </div>


      {indexedSearchActive ? (
        <div
          style={{
            padding: "8px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            flexShrink: 0,
            fontSize: 11,
            color: "rgba(205,214,244,0.6)",
          }}
        >
          <span style={{ color: "#fff", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {totalCount}
          </span>{" "}
          <span style={{ color: "var(--color-text-faint)" }}>
            {`of ${indexedSearchTotal ?? totalCount} indexed results`}
          </span>
        </div>
      ) : (
        <InboxLaneFilterBar
          accent={accent}
          activeLane={lane}
          counts={laneCounts}
          onChange={onLaneChange}
        />
      )}

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {indexedSearchError && (
          <div
            style={{
              padding: "10px 14px",
              fontSize: 11,
              color: "var(--sp-rose)",
              borderBottom: "1px solid color-mix(in srgb, var(--sp-rose) 12%, transparent)",
              background: "color-mix(in srgb, var(--sp-rose) 6%, transparent)",
            }}
          >
            {indexedSearchError}
          </div>
        )}
        {activeSnapshotError && !indexedSearchActive && (
          <div
            style={{
              padding: "10px 14px",
              fontSize: 11,
              color: "var(--sp-rose)",
              borderBottom: "1px solid color-mix(in srgb, var(--sp-rose) 12%, transparent)",
              background: "color-mix(in srgb, var(--sp-rose) 6%, transparent)",
            }}
          >
            {activeSnapshotError}
          </div>
        )}
        {!activeSnapshotMode && liveEmailsLoading && emails.length > 0 && <InboxLiveLoadingBlock compact />}
        {showSearchSkeletonRows ? (
          <InboxSearchSkeletonRows />
        ) : showSkeletonRows ? (
          <InboxLiveLoadingBlock />
        ) : layout === "swimlanes" ? (
          <>
            {grouped.pinned.length > 0 && (
              <LaneSection
                laneKey="pinned"
                emails={grouped.pinned}
                collapsed={!!effectiveCollapsed.pinned}
                noiseUnreadCount={0}
                onToggle={toggleLane}
                renderRows={renderRows}
              />
            )}
            {["queued", "carryover", "needs_attention", "catch_up", "fyi", "handled", "untriaged_read", "noise"].map((k) => (
              grouped[k]!.length > 0 && (
                <LaneSection
                  key={k}
                  laneKey={k}
                  emails={grouped[k]!}
                  collapsed={!!effectiveCollapsed[k]}
                  // Only the noise lane renders the unread pill; pass a stable 0 to the
                  // others so a noise-count change doesn't bust every lane's memo.
                  noiseUnreadCount={k === "noise" ? noiseUnreadCount : 0}
                  onToggle={toggleLane}
                  renderRows={renderRows}
                />
              )
            ))}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {renderRows(emails)}
            {indexedSearchActive && indexedSearchHasMore && (
              <button
                type="button"
                onClick={onLoadMoreSearch}
                disabled={indexedSearchLoading}
                style={{
                  margin: "10px 12px 16px",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(205,214,244,0.7)",
                  fontFamily: "inherit",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: indexedSearchLoading ? "default" : "pointer",
                  opacity: indexedSearchLoading ? 0.6 : 1,
                  transition: "background 120ms, border-color 120ms, color 120ms",
                }}
                onMouseEnter={(e) => {
                  if (indexedSearchLoading) return;
                  e.currentTarget.style.background = "color-mix(in srgb, var(--sp-blue) 14%, transparent)";
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--sp-blue) 32%, transparent)";
                  e.currentTarget.style.color = "var(--sp-blue)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  e.currentTarget.style.color = "rgba(205,214,244,0.7)";
                }}
              >
                {indexedSearchLoading ? "Loading…" : "Show more results"}
              </button>
            )}
          </div>
        )}
        {emails.length === 0 && !showSkeletonRows && !showSearchSkeletonRows && (
          <div
            style={{
              padding: "20px 20px 0",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "flex-start",
            }}
          >
            <div
              data-testid="inbox-list-empty-state-card"
              style={{
                width: "100%",
                aspectRatio: "1 / 1",
              }}
            >
              <EmptyStateSplash
                icon={<Mail size={26} strokeWidth={1.8} />}
                eyebrow="Inbox"
                title={indexedSearchActive ? "No indexed mail matches" : searchQuery ? "No emails match this view" : "No emails available"}
                message={indexedSearchActive
                  ? "Try another sender, subject, or phrase. Search covers mail indexed from your inboxes — mail archived before it was ever indexed isn't included."
                  : searchQuery
                  ? "Try a sender, subject word, or another account. Search covers mail indexed from your inboxes."
                  : "This slice of the inbox is calm right now. Live arrivals and triaged mail will appear here as they land."}
                compact
                minHeight="100%"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
