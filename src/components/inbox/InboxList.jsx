import { useState, useMemo } from "react";
import {
  Mail, Search, CheckCheck, RefreshCw,
  ChevronRight, ChevronDown, X,
} from "lucide-react";
import { LANE, briefingPhaseLabel } from "../../lib/shell-helpers";
import { Kbd, StickyHeader, IconBtn, LaneIcon } from "./primitives";
import EmailRow from "./EmailRow";
import EmptyStateSplash from "../shared/EmptyStateSplash";
import { Skeleton } from "@/components/ui/skeleton";
import InboxSearchFlagChips from "./InboxSearchFlagChips";
import InboxCategoryFilterChips from "./InboxCategoryFilterChips";

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
        border: "1px solid rgba(137,180,250,0.18)",
        background: "rgba(137,180,250,0.06)",
        color: "rgba(205,214,244,0.72)",
        fontSize: 11,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Skeleton style={{ width: 8, height: 8, borderRadius: 999, background: "rgba(137,180,250,0.75)" }} />
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
  accent, emails, accountsById,
  selectedId, onOpen, density, layout, showPreview,
  searchQuery, onSearchChange, onMarkAllRead, onRefresh,
  totalCount, unreadCount, noiseUnreadCount = 0, briefingGeneratedAt, searchRef,
  liveEmailsLoading = false,
  indexedSearchActive = false,
  indexedSearchLoading = false,
  indexedSearchError = null,
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

  const grouped = useMemo(() => {
    const g = { live: [], queued: [], carryover: [], needs_attention: [], action: [], catch_up: [], fyi: [], handled: [], untriaged_read: [], noise: [] };
    for (const e of emails) {
      if (e._untriaged) g.live.push(e);
      else {
        const laneKey = e._lane === "action" ? "needs_attention" : e._lane;
        g[laneKey]?.push(e);
      }
    }
    // Use resurfaced_at as the sort key for woken snooze emails so they land
    // near the top of "live" alongside freshly-arrived mail.
    const liveKey = (e) => e._resurfacedAt || new Date(e.date).getTime();
    g.live.sort((a, b) => liveKey(b) - liveKey(a));
    return g;
  }, [emails]);

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
        />
      </div>
    );
  });

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", minWidth: 0, flex: 1,
        background: "rgba(24,24,37,0.30)",
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
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontSize: 12, color: "#cdd6f4", fontFamily: "inherit",
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
                e.currentTarget.style.background = "rgba(243,139,168,0.14)";
                e.currentTarget.style.borderColor = "rgba(243,139,168,0.32)";
                e.currentTarget.style.color = "#f38ba8";
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
          <span style={{ color: "rgba(205,214,244,0.4)" }}>unread · </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{totalCount}</span>
          <span style={{ color: "rgba(205,214,244,0.4)" }}>
            {indexedSearchActive
              ? ` indexed result${totalCount === 1 ? "" : "s"}`
              : " total"}
          </span>
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
              color: "#f38ba8",
              borderBottom: "1px solid rgba(243,139,168,0.12)",
              background: "rgba(243,139,168,0.06)",
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
              color: "#f38ba8",
              borderBottom: "1px solid rgba(243,139,168,0.12)",
              background: "rgba(243,139,168,0.06)",
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
              border: "1px solid rgba(137,180,250,0.18)",
              background: "rgba(137,180,250,0.06)",
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
                background: "#89b4fa",
                boxShadow: "0 0 8px rgba(137,180,250,0.65)",
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
            {grouped.live.length > 0 && (
              <div>
                <StickyHeader borderColor="rgba(137,180,250,0.12)">
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
                          background: "#89b4fa", opacity: 0.3,
                          animation: "livepulse 2s ease-out infinite",
                        }}
                      />
                      <span
                        style={{
                          width: 5, height: 5, borderRadius: 999, background: "#89b4fa",
                          boxShadow: "0 0 8px #89b4fa",
                        }}
                      />
                    </span>
                    <span
                      style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: 2,
                        textTransform: "uppercase", color: "#89b4fa",
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
                        background: "rgba(137,180,250,0.14)", color: "rgba(137,180,250,0.9)",
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
                        textTransform: "uppercase", color: "rgba(205,214,244,0.4)",
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
                <div key={k}>
                  <StickyHeader borderColor="rgba(255,255,255,0.03)">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleLane(k)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleLane(k); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                        cursor: "pointer", background: "transparent", border: "none",
                        fontFamily: "inherit", color: "inherit", padding: 0,
                      }}
                    >
                      <span style={{ flexShrink: 0, display: "inline-flex" }}>
                        <LaneIcon laneKey={k} />
                      </span>
                      <span
                        style={{
                          fontSize: 10, fontWeight: 700, letterSpacing: 2,
                          textTransform: "uppercase", color: LANE[k].color,
                          minWidth: 0, whiteSpace: "nowrap",
                          overflow: "hidden", textOverflow: "ellipsis",
                        }}
                      >
                        {LANE[k].label}
                      </span>
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 999,
                          background: LANE[k].soft, color: `${LANE[k].color}cc`,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {grouped[k].length}
                      </span>
                      {k === "noise" && noiseUnreadCount > 0 && (
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: 9,
                            fontWeight: 650,
                            padding: "2px 6px",
                            borderRadius: 999,
                            background: "rgba(205,214,244,0.07)",
                            border: "1px solid rgba(205,214,244,0.12)",
                            color: "rgba(205,214,244,0.58)",
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {noiseUnreadCount} unread
                        </span>
                      )}
                      <span style={{ flex: 1 }} />
                      {effectiveCollapsed[k] ? <ChevronRight size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} /> : <ChevronDown size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} />}
                    </div>
                  </StickyHeader>
                  {!effectiveCollapsed[k] && (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {renderRows(grouped[k])}
                    </div>
                  )}
                </div>
              )
            ))}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {renderRows(emails)}
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
                  ? "Try another sender, subject, or phrase from indexed INBOX mail."
                  : searchQuery
                  ? "Try a sender, subject word, or another account. Search covers indexed INBOX mail only."
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
