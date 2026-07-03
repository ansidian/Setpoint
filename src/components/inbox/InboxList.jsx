import { useState, useMemo } from "react";
import {
  Mail, Search, CheckCheck, RefreshCw,
  ChevronRight, ChevronDown, X,
} from "lucide-react";
import { briefingPhaseLabel } from "../../lib/shell-helpers";
import { Kbd, StickyHeader, IconBtn } from "./primitives";
import EmailRow from "./EmailRow";
import EmptyStateSplash from "../shared/EmptyStateSplash";
import { Skeleton } from "@/components/ui/skeleton";
import InboxSearchFlagChips from "./InboxSearchFlagChips";
import InboxCategoryFilterChips from "./InboxCategoryFilterChips";
import LaneSection from "./LaneSection";

/* ======================================================================
 * LIST (swimlane or flat)
 * ====================================================================== */
function InboxLiveSkeletonRows({ count = 5, compact = false }) {
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

function InboxLiveLoadingBlock({ compact = false }) {
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
  totalCount, unreadCount, noiseUnreadCount = 0, briefingGeneratedAt, searchRef,
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
  snapshotCategories = [],
  categoryFilter = "__all",
  onCategoryFilterChange,
  readOnly = false,
}) {
  const [collapsed, setCollapsed] = useState(() => (activeSnapshotMode ? { handled: true, untriaged_read: true, noise: true } : {}));
  const effectiveCollapsed = activeSnapshotMode ? { handled: true, untriaged_read: true, noise: true, ...collapsed } : collapsed;
  const toggleLane = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));
  const showSkeletonRows = !activeSnapshotMode && liveEmailsLoading && emails.length === 0;
  const showSearchSkeletonRows = indexedSearchActive && indexedSearchLoading;

  // Only the swimlane layout consumes `grouped`; flat (and mobile, which passes
  // grouping:'flat') render `emails` directly via renderRows. Gate the O(n)
  // bucketing + live re-sort on the layout so non-swimlane views skip it.
  const grouped = useMemo(() => {
    if (layout !== "swimlanes") return null;
    const g = { pinned: [], live: [], queued: [], carryover: [], needs_attention: [], action: [], catch_up: [], fyi: [], handled: [], untriaged_read: [], noise: [] };
    for (const e of emails) {
      if (e._pinned) g.pinned.push(e);
      else if (e._untriaged) g.live.push(e);
      else {
        const laneKey = e._lane === "action" ? "needs_attention" : e._lane;
        g[laneKey]?.push(e);
      }
    }
    // Use resurfaced_at as the sort key for woken snooze emails so they land
    // near the top of "live" alongside freshly-arrived mail. This re-sorts the
    // live bucket purely by date, intentionally overriding the controller's
    // lane-order sub-sort — do NOT drop it.
    const liveKey = (e) => e._resurfacedAt || new Date(e.date).getTime();
    g.live.sort((a, b) => liveKey(b) - liveKey(a));
    return g;
  }, [emails, layout]);

  const renderRows = (list) => list.map((email) => {
    const rowKey = email.id || email.uid;
    return (
      <div
        key={rowKey}
      >
        <EmailRow
          email={email}
          account={accountsById[email.accountId] || accountsById[email._accountKey]}
          selected={selectedId === email.id}
          onOpen={onOpen}
          density={density}
          showPreview={showPreview}
          accent={accent}
          nowTick={nowTick}
        />
      </div>
    );
  });

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", minWidth: 0, flex: 1,
        background: "color-mix(in srgb, var(--sp-mantle) 30%, transparent)",
        borderRight: "1px solid rgba(255,255,255,0.04)",
        minHeight: 0,
      }}
    >
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


      <div
        style={{
          padding: "8px 16px", display: "flex", alignItems: "center", gap: 10,
          borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, color: "rgba(205,214,244,0.6)" }}>
          <span
            style={{
              color: "#fff", fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {unreadCount}
          </span>{" "}
          <span style={{ color: "var(--color-text-faint)" }}>unread · </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{totalCount}</span>
          {indexedSearchActive ? (
            <span style={{ color: "var(--color-text-faint)" }}>
              {` of ${indexedSearchTotal ?? totalCount} indexed results`}
            </span>
          ) : (
            <span style={{ color: "var(--color-text-faint)" }}> total</span>
          )}
        </span>
        <span style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {activeSnapshotMode && snapshotCategories.length > 0 && !indexedSearchActive && (
          <InboxCategoryFilterChips
            accent={accent}
            categories={snapshotCategories}
            activeCategory={categoryFilter}
            onChange={onCategoryFilterChange}
          />
        )}
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
        {activeSnapshotMode && processingCount > 0 && !indexedSearchActive && (
          <div
            style={{
              margin: "10px 12px 6px",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid color-mix(in srgb, var(--sp-blue) 18%, transparent)",
              background: "color-mix(in srgb, var(--sp-blue) 6%, transparent)",
              color: "rgba(205,214,244,0.72)",
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: "var(--sp-blue)",
                boxShadow: "0 0 8px color-mix(in srgb, var(--sp-blue) 65%, transparent)",
              }}
            />
            Processing {processingCount} email{processingCount === 1 ? "" : "s"}
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
            {grouped.live.length > 0 && (
              <div>
                <StickyHeader borderColor="color-mix(in srgb, var(--sp-blue) 12%, transparent)">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleLane("live")}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleLane("live"); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%",
                      cursor: "pointer", background: "transparent", border: "none",
                      fontFamily: "inherit", color: "inherit", padding: 0,
                    }}
                  >
                    <span
                      style={{
                        position: "relative", display: "inline-flex",
                        alignItems: "center", justifyContent: "center",
                        width: 10, height: 10,
                      }}
                    >
                      <span
                        style={{
                          position: "absolute", inset: 0, borderRadius: 999,
                          background: "var(--sp-blue)", opacity: 0.3,
                          animation: "livepulse 2s ease-out infinite",
                        }}
                      />
                      <span
                        style={{
                          width: 5, height: 5, borderRadius: 999, background: "var(--sp-blue)",
                          boxShadow: "0 0 8px var(--sp-blue)",
                        }}
                      />
                    </span>
                    <span
                      style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: 2,
                        textTransform: "uppercase", color: "var(--sp-blue)",
                        minWidth: 0, whiteSpace: "nowrap",
                        overflow: "hidden", textOverflow: "ellipsis",
                      }}
                    >
                      {briefingPhaseLabel(briefingGeneratedAt)}
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 999,
                        background: "color-mix(in srgb, var(--sp-blue) 14%, transparent)", color: "color-mix(in srgb, var(--sp-blue) 90%, transparent)",
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {grouped.live.length} new
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 9, fontWeight: 600, letterSpacing: 0.5,
                        textTransform: "uppercase", color: "var(--color-text-faint)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Not yet triaged
                    </span>
                    {effectiveCollapsed.live ? <ChevronRight size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} /> : <ChevronDown size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} />}
                  </div>
                </StickyHeader>
                {!effectiveCollapsed.live && (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {renderRows(grouped.live)}
                  </div>
                )}
              </div>
            )}
            {["queued", "carryover", "needs_attention", "catch_up", "fyi", "handled", "untriaged_read", "noise"].map((k) => (
              grouped[k].length > 0 && (
                <LaneSection
                  key={k}
                  laneKey={k}
                  emails={grouped[k]}
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
