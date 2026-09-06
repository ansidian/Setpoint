import { useState, useMemo, useCallback } from "react";
import { AnimatePresence } from "motion/react";
import type { MouseEventHandler, CSSProperties } from "react";
import {
  Inbox, SearchX, CheckCheck, RefreshCw,
} from "lucide-react";

import EmailRow from "./EmailRow";
import InboxRowTransition from "./InboxRowTransition";
import InboxEmptyState from "./InboxEmptyState";
import { Skeleton } from "@/components/ui/skeleton";

import { LANE } from "../../lib/shell-helpers";
import LaneSection from "./LaneSection";

import type { InboxAccount, InboxEmailLike, InboxId } from "./inboxTypes";


const LANE_DESCRIPTIONS: Record<string, string> = {
  __all: "All inbox lanes, including unfinished mail carried over from earlier snapshots.",
  needs_attention: "Mail that needs a reply, decision, or action, including unfinished mail carried over.",
  action: "Mail that needs a reply, decision, or action, including unfinished mail carried over.",
  fyi: "Updates worth reading, with no action needed.",
  noise: "Low-priority mail you can review or dismiss.",
  queued: "New mail waiting for automatic triage.",
  catch_up: "Unread FYI from the previous snapshot, kept as read-only context.",
  untriaged_read: "Read mail that skipped automatic triage. Triage read arrivals in Settings applies to future mail; previously skipped mail stays here.",
  handled: "Mail you marked done. Reopen it to restore its previous lane.",
  snoozed: "Mail deferred until a chosen time. It returns to the Inbox when ready.",
};

type CollapsedLanes = Record<string, boolean | undefined>;
type GroupedEmails = Record<string, InboxEmailLike[]> & {
  pinned: InboxEmailLike[];
  queued: InboxEmailLike[];
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
    pinned: [], queued: [], needs_attention: [],
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
  collection = "inbox", snoozedLoading = false, snoozedError = null,
  accent, nowTick, emails, accountsById,
  selectedId, onOpen, density, layout, showPreview,
  searchQuery, onClearSearch, onShowAllMail, onMarkAllRead, onRefresh,
  totalCount, unreadCount, noiseUnreadCount = 0,
  liveEmailsLoading = false,
  indexedSearchActive = false,
  indexedSearchLoading = false,
  indexedSearchError = null,
  indexedSearchTotal = null,
  indexedSearchHasMore = false,
  onLoadMoreSearch = () => {},
  activeSnapshotMode = false,
  activeSnapshotError = null,
  lane = "__all",
  readOnly = false,
}: {
  collection?: "inbox" | "snoozed";
  snoozedLoading?: boolean;
  snoozedError?: string | null;
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
  onClearSearch: () => void;
  onShowAllMail: () => void;
  onMarkAllRead: MouseEventHandler<HTMLButtonElement>;
  onRefresh: MouseEventHandler<HTMLButtonElement>;
  totalCount: number;
  unreadCount: number;
  noiseUnreadCount?: number;
  liveEmailsLoading?: boolean;
  indexedSearchActive?: boolean;
  indexedSearchLoading?: boolean;
  indexedSearchError?: string | null;
  indexedSearchTotal?: number | null;
  indexedSearchHasMore?: boolean;
  onLoadMoreSearch?: MouseEventHandler<HTMLButtonElement>;
  activeSnapshotMode?: boolean;
  activeSnapshotError?: string | null;
  lane?: string;
  readOnly?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<CollapsedLanes>(() => (activeSnapshotMode ? { handled: true, untriaged_read: true } : {}));
  const effectiveCollapsed = activeSnapshotMode ? { handled: true, untriaged_read: true, ...collapsed } : collapsed;
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
  const renderRows = useCallback((list: InboxEmailLike[]) => <AnimatePresence initial={false}>{list.map((email) => {
    const rowKey = email.id || email.uid;
    const accountKey = email.accountId || email.account_id || email._accountKey || "";
    return (
      <InboxRowTransition
        key={`${rowKey}:${email._lane}`}
      >
        <EmailRow
          email={email}
          account={accountsById[accountKey]}
          selected={selectedId === (email.id || email.uid)}
          onOpen={onOpen}
          density={density}
          showPreview={showPreview}
          accent={accent}
          nowTick={nowTick}
          showLaneTag={!!email._pinned || !!email._snoozed || indexedSearchActive}
        />
      </InboxRowTransition>
    );
  })}</AnimatePresence>, [accountsById, selectedId, onOpen, density, showPreview, accent, nowTick, indexedSearchActive]);

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", minWidth: 0, flex: 1,
        background: "color-mix(in srgb, var(--sp-mantle) 30%, transparent)",
        borderRight: "1px solid rgba(255,255,255,0.04)",
        minHeight: 0,
      }}
    >
      <header className="inbox-a-queue-heading" data-filtered={!indexedSearchActive && lane !== "__all" && collection !== "snoozed"} style={{ "--inbox-lane-color": LANE[lane]?.color || accent } as CSSProperties}>
        <div className="inbox-a-queue-title">
          <h2>{indexedSearchActive ? "Search results" : collection === "snoozed" ? "Snoozed" : lane === "__all" ? "All mail" : LANE[lane]?.label || "Inbox"}</h2>
          <span className="inbox-a-queue-total">{totalCount}</span>
          {!readOnly && <button className="inbox-a-control inbox-a-icon-control" type="button" onClick={onMarkAllRead} aria-label="Mark all read" title="Mark all read" disabled={unreadCount === 0}><CheckCheck size={14} /></button>}
          {!readOnly && <button className="inbox-a-control inbox-a-icon-control" type="button" onClick={onRefresh} aria-label="Sync now" title="Sync now"><RefreshCw size={13} /></button>}
        </div>
        <p>{indexedSearchActive ? "All accounts · all indexed dates" : <>{readOnly && "Historical snapshot · read only. "}{LANE_DESCRIPTIONS[collection === "snoozed" ? "snoozed" : lane] || LANE_DESCRIPTIONS.__all}</>}</p>
      </header>
      {collection === "snoozed" && !indexedSearchActive && (snoozedError || snoozedLoading) && <div role="status" style={{ padding: "8px 16px", fontSize: 12, color: "#a6adc8" }}>
        {snoozedError ? <>{snoozedError} <button className="inbox-a-control" type="button" onClick={onRefresh}>Retry</button></>
          : snoozedLoading ? "Loading snoozed mail…" : emails.length === 0 ? "No snoozed mail in this view." : "Messages stay here until they return successfully."}
      </div>}

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
      ) : null}

      <div className="inbox-a-mail-list" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
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
          <AnimatePresence initial={false}>
            {grouped.pinned.length > 0 && (
              <LaneSection
                key="pinned"
                laneKey="pinned"
                emails={grouped.pinned}
                collapsed={!!effectiveCollapsed.pinned}
                noiseUnreadCount={0}
                onToggle={toggleLane}
                renderRows={renderRows}
              />
            )}
            {["needs_attention", "fyi", "noise", "handled", "queued", "catch_up", "untriaged_read"].map((k) => (
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
          </AnimatePresence>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {renderRows(emails)}
            {indexedSearchActive && indexedSearchHasMore && (
              <button
                type="button"
                onClick={onLoadMoreSearch}
                disabled={indexedSearchLoading}
                className="inbox-a-control sp-focus-ring"
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
        {emails.length === 0 && !showSkeletonRows && !showSearchSkeletonRows && !snoozedLoading && !snoozedError && !indexedSearchError && !activeSnapshotError && (
          <InboxEmptyState
            icon={indexedSearchActive || searchQuery ? <SearchX size={26} strokeWidth={1.3} /> : <Inbox size={26} strokeWidth={1.3} />}
            title={indexedSearchActive || searchQuery ? "No matching emails" : collection === "snoozed" ? "Nothing snoozed" : lane === "needs_attention" ? "Nothing needs attention" : lane === "handled" ? "Nothing handled yet" : lane !== "__all" ? "No mail in this lane" : "No mail in this view"}
            message={indexedSearchActive || searchQuery ? "Try a different sender, subject, or phrase." : collection === "snoozed" ? "Emails you snooze will wait here until their return time." : lane === "handled" ? "Emails you mark handled will appear here." : "New mail will appear here when it arrives."}
            action={indexedSearchActive || searchQuery
              ? { label: "Clear search", onClick: onClearSearch }
              : lane !== "__all" || collection === "snoozed" ? { label: "View all mail", onClick: onShowAllMail } : undefined}
          />
        )}
      </div>
    </div>
  );
}
