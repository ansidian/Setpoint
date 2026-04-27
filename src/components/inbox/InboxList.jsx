import { useState, useMemo } from "react";
import {
  Mail, Search, CheckCheck, RefreshCw,
  Sparkles, Pin, ChevronRight, ChevronDown, X,
} from "lucide-react";
import { LANE, briefingPhaseLabel } from "../../lib/redesign-helpers";
import { Kbd, StickyHeader, IconBtn, LaneIcon } from "./primitives";
import EmailRow from "./EmailRow";
import EmptyStateSplash from "../shared/EmptyStateSplash";
import { Skeleton } from "@/components/ui/skeleton";

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

export default function InboxList({
  accent, emails, accountsById,
  selectedId, onOpen, density, layout, showPreview, pinnedIds,
  searchQuery, onSearchChange, onMarkAllRead, onRefresh,
  totalCount, unreadCount, briefingAgoLabel, briefingGeneratedAt, searchRef,
  liveEmailsLoading = false,
}) {
  const [collapsed, setCollapsed] = useState({});
  const toggleLane = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));
  const showSkeletonRows = liveEmailsLoading && emails.length === 0;

  const grouped = useMemo(() => {
    const g = { pinned: [], live: [], action: [], fyi: [], noise: [] };
    for (const e of emails) {
      const key = e.uid || e.id;
      if (pinnedIds?.has?.(key) || pinnedIds?.has?.(e.id)) g.pinned.push(e);
      else if (e._untriaged) g.live.push(e);
      else g[e._lane]?.push(e);
    }
    g.pinned.sort((a, b) => new Date(b.date) - new Date(a.date));
    // Use resurfaced_at as the sort key for woken snooze emails so they land
    // near the top of "live" alongside freshly-arrived mail.
    const liveKey = (e) => e._resurfacedAt || new Date(e.date).getTime();
    g.live.sort((a, b) => liveKey(b) - liveKey(a));
    return g;
  }, [emails, pinnedIds]);

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
          pinned={!!(pinnedIds?.has?.(email.uid) || pinnedIds?.has?.(email.id))}
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
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                if (searchQuery) onSearchChange("");
                e.currentTarget.blur();
              }
            }}
            placeholder='Search or ask briefing search, "bills due this week"'
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
        <IconBtn
          onClick={onMarkAllRead}
          title="Mark all read"
          tinted={unreadCount > 0}
          accent={accent}
        >
          <CheckCheck size={11} />
        </IconBtn>
        <IconBtn onClick={onRefresh} title="Refresh"><RefreshCw size={11} /></IconBtn>
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
          <span style={{ color: "rgba(205,214,244,0.4)" }}> total</span>
        </span>
        <span style={{ flex: 1 }} />
        {briefingAgoLabel && (
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 10, color: `${accent}cc`,
            }}
          >
            <Sparkles size={10} color={accent} />
            {briefingAgoLabel}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {liveEmailsLoading && emails.length > 0 && <InboxLiveLoadingBlock compact />}
        {showSkeletonRows ? (
          <InboxLiveLoadingBlock />
        ) : layout === "swimlanes" ? (
          <>
            {grouped.pinned.length > 0 && (
              <div>
                <StickyHeader borderColor={`${accent}22`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleLane("pinned")}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleLane("pinned"); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%",
                      cursor: "pointer", background: "transparent", border: "none",
                      fontFamily: "inherit", color: "inherit", padding: 0,
                    }}
                  >
                    <Pin size={11} color={accent} style={{ flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: 2,
                        textTransform: "uppercase", color: accent,
                        minWidth: 0, whiteSpace: "nowrap",
                        overflow: "hidden", textOverflow: "ellipsis",
                      }}
                    >
                      Pinned
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 999,
                        background: `${accent}22`, color: `${accent}cc`,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {grouped.pinned.length}
                    </span>
                    <span style={{ flex: 1 }} />
                    {collapsed.pinned ? <ChevronRight size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} /> : <ChevronDown size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} />}
                  </div>
                </StickyHeader>
                {!collapsed.pinned && (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {renderRows(grouped.pinned)}
                  </div>
                )}
              </div>
            )}
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
                    {collapsed.live ? <ChevronRight size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} /> : <ChevronDown size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} />}
                  </div>
                </StickyHeader>
                {!collapsed.live && (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {renderRows(grouped.live)}
                  </div>
                )}
              </div>
            )}
            {["action", "fyi", "noise"].map((k) => (
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
                      <span style={{ flex: 1 }} />
                      {collapsed[k] ? <ChevronRight size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} /> : <ChevronDown size={12} color="rgba(205,214,244,0.4)" style={{ flexShrink: 0 }} />}
                    </div>
                  </StickyHeader>
                  {!collapsed[k] && (
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
        {emails.length === 0 && !showSkeletonRows && (
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
                title={searchQuery ? "No emails match this view" : "No emails available"}
                message={searchQuery
                  ? "Try clearing the query, switching lanes, or checking another account."
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
