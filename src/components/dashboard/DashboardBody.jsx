import { memo, useState, useEffect, useMemo, useCallback, useRef } from "react";
import TodayTimeline from "./TodayTimeline";
import NeedsYouBand from "./needsYou/NeedsYouBand";
import ContextColumn from "./context/ContextColumn.jsx";
import { getEventSelectionId } from "../../lib/shell-helpers";
import {
  ThreeTierLayout,
  DashboardSurface,
} from "./layout/DashboardScenePrimitives";
import { calendarContentSignature } from "../../hooks/currentDashboardModel";
import { markSnapshotItemHandled } from "../../api";
import { useDashboard } from "../../context/DashboardContext";

const EMPTY_EMAIL_ACCOUNTS = [];

function DashboardBodyInner({
  liveData, activeSnapshot, calendarRange, accent,
  isMobile = false, calendarDeadlines = undefined, calendarDeadlinesError = false,
  onOpenEmail, onOpenDeadline, onOpenBillsCalendar, onOpenEventsCalendar,
}) {
  const { handleCompleteTask } = useDashboard();
  const seededEvents = useMemo(() => liveData.liveCalendar || [], [liveData.liveCalendar]);
  const [events, setEvents] = useState([]);
  const [liveEventsReady, setLiveEventsReady] = useState(false);
  const today = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()),
    [],
  );
  const ensureCalendarRange = calendarRange.ensureRange;
  const calendarRevision = calendarRange.revision;

  // The seed is only read by the effect's catch() fallback, so keep it in a ref
  // (synced in its own effect) instead of the range-fetch effect's deps —
  // otherwise a fresh liveCalendar identity on every poll/refetch re-fires the
  // whole range fetch. The fetch effect legitimately re-runs only when the range
  // fn / today / calendarRevision change.
  const seededEventsRef = useRef(seededEvents);
  useEffect(() => {
    seededEventsRef.current = seededEvents;
  }, [seededEvents]);

  useEffect(() => {
    const endDate = new Date(`${today}T12:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 14);
    const end = endDate.toISOString().slice(0, 10);
    let cancelled = false;
    ensureCalendarRange(today, end)
      .then((result) => {
        if (!cancelled) {
          // Only swap the events reference when the resolved range content
          // actually differs, so an unchanged refetch doesn't reconcile the
          // (memoized) timeline/hero with a new-but-equal array.
          setEvents((prev) => (
            calendarContentSignature(prev) === calendarContentSignature(result) ? prev : result
          ));
          setLiveEventsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents((prev) => (prev.length > 0 ? prev : seededEventsRef.current));
          setLiveEventsReady(true);
        }
      });
    return () => { cancelled = true; };
  }, [ensureCalendarRange, today, calendarRevision]);
  const calendarDeadlinesReady = calendarDeadlines != null;
  const allowCurrentDeadlineFallback = calendarDeadlines === undefined || calendarDeadlinesError;
  const currentDeadlines = liveData.liveDeadlines || {};
  const deadlines = useMemo(
    () => {
      if (calendarDeadlinesReady) return calendarDeadlines?.upcoming || [];
      return allowCurrentDeadlineFallback ? currentDeadlines.upcoming || [] : [];
    },
    [allowCurrentDeadlineFallback, calendarDeadlines?.upcoming, calendarDeadlinesReady, currentDeadlines.upcoming],
  );
  const bills = liveData.liveBills || [];
  const activeSnapshotEmailAccounts = useMemo(() => {
    if (!activeSnapshot?.snapshot) return null;
    const accounts = new Map((activeSnapshot.filters?.accounts || []).map((account) => [
      account.account_id,
      {
        id: account.account_id,
        name: account.label || account.email || account.account_id,
        email: account.email || "",
        color: account.color || accent,
        icon: account.icon || "Mail",
        unread: 0,
        important: [],
        noise: [],
      },
    ]));
    const ensureAccount = (item) => {
      const key = item.account_id || "snapshot";
      if (!accounts.has(key)) {
        accounts.set(key, {
          id: key,
          name: item.account_label || item.account_email || "Snapshot",
          email: item.account_email || "",
          color: item.account_color || accent,
          icon: item.account_icon || "Mail",
          unread: 0,
          important: [],
          noise: [],
        });
      }
      return accounts.get(key);
    };
    const rows = [
      ...(activeSnapshot.carryover || []).map((item) => ({ ...item, lane: "needs_attention" })),
      ...(activeSnapshot.lanes?.needs_attention || []),
      ...(activeSnapshot.lanes?.fyi || []),
    ];
    for (const item of rows) {
      const account = ensureAccount(item);
      const lane = item.lane === "fyi" ? "fyi" : "action";
      const email = {
        id: String(item.uid || item.email_id || item.id),
        uid: String(item.uid || item.email_id || item.id),
        subject: item.subject || "",
        from: item.from || item.from_name || item.from_address || "Unknown",
        date: item.date || item.email_date || item.email_date_at_snapshot,
        read: !!item.read,
        triage: lane,
      };
      account.important.push(email);
      if (!email.read) account.unread += 1;
    }
    return Array.from(accounts.values());
  }, [accent, activeSnapshot]);
  const emailAccounts = activeSnapshotEmailAccounts || EMPTY_EMAIL_ACCOUNTS;
  // NeedsYouBand reads liveDeadlines.upcoming (object form); `deadlines` is the
  // flattened array, so wrap it (memoized to keep the band's model cache stable).
  const bandDeadlines = useMemo(() => ({ upcoming: deadlines }), [deadlines]);
  const displayEvents = liveEventsReady ? events : seededEvents;
  const eventLoadingState = liveEventsReady
    ? "ready"
    : seededEvents.length > 0
      ? "refreshing"
      : "empty_loading";

  const handleRailJump = useCallback((payload, anchor) => {
    if (!payload) return;
    if (payload.kind === "email" && payload.email?.id) {
      onOpenEmail(payload.email.id);
    } else if (payload.kind === "deadline") {
      onOpenDeadline(payload.data || payload, anchor);
    } else if (payload.kind === "bill") {
      onOpenBillsCalendar(payload.data?.next_date || payload.date || null, payload.id || payload.data?.id || null, payload.data);
    } else if (payload.kind === "event" && payload.data?.startMs) {
      const ymd = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
      }).format(new Date(payload.data.startMs));
      onOpenEventsCalendar(ymd, payload.id || getEventSelectionId(payload.data), payload.data);
    }
  }, [onOpenEmail, onOpenDeadline, onOpenBillsCalendar, onOpenEventsCalendar]);

  // Stable inbox-open handler shared by the band and the context column, so a
  // pure poll/refresh re-render does not hand them a fresh arrow identity.
  const handleOpenInbox = useCallback(() => onOpenEmail(null), [onOpenEmail]);

  // Wire the band's "handled" action straight to the snapshot endpoint; it emits
  // the SSE the dashboard refetches on, so no extra dispatch hook is needed here.
  const handleMarkHandled = useCallback((snapshotItemId) => {
    if (snapshotItemId != null) Promise.resolve(markSnapshotItemHandled(snapshotItemId)).catch(() => {});
  }, []);

  // Deadline "Mark done" in the band routes through the same canonical completer
  // the deadline popover uses (optimistic flag → completeDeadlineOccurrence →
  // revert on failure), so the Todoist task is actually marked complete.
  const handleCompleteDeadline = useCallback((id, data) => {
    Promise.resolve(handleCompleteTask(id, data)).catch(() => {});
  }, [handleCompleteTask]);

  const band = (
    <NeedsYouBand
      snapshotLanes={activeSnapshot?.lanes}
      liveDeadlines={bandDeadlines}
      liveBills={bills}
      maxCards={5}
      isMobile={isMobile}
      onOpenEmail={onOpenEmail}
      onMarkHandled={handleMarkHandled}
      onCompleteDeadline={handleCompleteDeadline}
      onOpen={handleRailJump}
    />
  );

  const timeline = (
    <TodayTimeline accent={accent} isMobile={isMobile} events={displayEvents} deadlines={deadlines}
      onJump={handleRailJump} eventLoadingState={eventLoadingState} scrollContained={!isMobile} />
  );

  const timelinePanel = (
    <DashboardSurface isMobile={isMobile}
      style={{ minHeight: isMobile ? 520 : 0, height: !isMobile ? "100%" : undefined, display: "flex", flexDirection: "column" }}>
      {timeline}
    </DashboardSurface>
  );

  const contextColumn = (
    <ContextColumn accent={accent} isMobile={isMobile} liveWeather={liveData.liveWeather}
      liveDeadlines={deadlines} liveBills={bills} snapshotLanes={activeSnapshot?.lanes}
      emailAccounts={emailAccounts}
      onJump={handleRailJump} onOpenInbox={handleOpenInbox} onCompleteDeadline={handleCompleteDeadline} />
  );

  return <ThreeTierLayout isMobile={isMobile} band={band} timelinePanel={timelinePanel} contextColumn={contextColumn} />;
}

// Memoized so the dashboard poll loop / SSE refetch / 5-min refresh skip
// re-rendering the whole hero+timeline+rails subtree when DashboardBody's props
// are referentially unchanged (the bulk liveData slice is now stable across the
// isPolling/refreshing toggles — see useCurrentDashboard).
export const DashboardBody = memo(DashboardBodyInner);
