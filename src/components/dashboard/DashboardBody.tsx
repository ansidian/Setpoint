import { memo, useState, useEffect, useMemo, useCallback, useRef } from "react";
import TodayTimeline from "./TodayTimeline";
import NeedsYouBand from "./needsYou/NeedsYouBand";
import ContextColumn from "./context/ContextColumn";
import { getEventSelectionId } from "../../lib/shell-helpers";
import {
  ThreeTierLayout,
  DashboardSurface,
} from "./layout/DashboardScenePrimitives";
import { calendarContentSignature, stabilizeDeadlines } from "../../hooks/currentDashboardModel";
import { markSnapshotItemHandled } from "../../api";
import { useDashboard } from "../../context/DashboardContext";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";
import type { ActiveSnapshotView } from "../../../shared/types/snapshots";
import type { DashboardDeadline, DashboardDeadlineRoot } from "../../context/dashboardTaskProjection";
import type { CurrentDashboardLiveData } from "../../hooks/currentDashboardModel";
import type { NeedsYouBill } from "./needsYou/needsYouModel";
import { buildNeedsYouModel } from "./needsYou/needsYouModel";
import { DashboardScheduleNotices } from "./timeline/DashboardScheduleNotices";
import DashboardFinance from "./finance/DashboardFinance";
import "./finance/finance-cards.css";
import "./dashboard-interactions.css";

interface DashboardBodyCalendarRange {
  ensureRange: (start: string, end: string) => Promise<Array<Partial<NormalizedCalendarEvent>>>;
  getEvents?: unknown;
  hasMonth?: unknown;
  isMonthLoading?: unknown;
  loading?: boolean;
  error?: unknown;
  revision?: number;
}

type DashboardCalendarEvent = Pick<NormalizedCalendarEvent, "id" | "title" | "startMs" | "endMs"> &
  Partial<NormalizedCalendarEvent>;

interface DashboardJumpPayload {
  kind?: string | null;
  id?: string | number | null;
  date?: string | null;
  data?: unknown;
  email?: unknown;
}

interface DashboardBodyProps {
  liveData: {
    liveBills?: NeedsYouBill[];
    liveCalendar?: DashboardCalendarEvent[] | null;
    liveWeather?: CurrentDashboardLiveData["liveWeather"];
    liveDeadlines?: CurrentDashboardLiveData["liveDeadlines"] | Partial<DashboardDeadlineRoot>;
  };
  activeSnapshot?: ActiveSnapshotView | null;
  calendarRange: DashboardBodyCalendarRange;
  accent: string;
  isMobile?: boolean;
  calendarDeadlines?: DashboardDeadlineRoot | null;
  calendarDeadlinesLoading?: boolean;
  calendarDeadlinesError?: boolean;
  domainRefreshing?: boolean;
  onOpenEmail: (id: string | number | null) => void;
  onOpenInbox?: (lane?: "needs_attention" | "carryover" | "fyi" | "queued") => void;
  onOpenDeadline: (task: DashboardDeadline, anchor?: HTMLElement) => void;
  onOpenBillsCalendar: (date: string | null, itemId: string | number | null, item?: Record<string, unknown>, anchor?: HTMLElement) => void;
  onOpenEventsCalendar: (date: string | null, itemId: string | number | null, item?: Record<string, unknown>, anchor?: HTMLElement) => void;
}

function DashboardBodyInner({
  liveData: liveDataInput, activeSnapshot = null, calendarRange, accent,
  isMobile = false, calendarDeadlines = undefined, calendarDeadlinesLoading = false,
  calendarDeadlinesError = false,
  domainRefreshing = false,
  onOpenEmail, onOpenInbox, onOpenDeadline, onOpenBillsCalendar, onOpenEventsCalendar,
}: DashboardBodyProps) {
  const liveData = liveDataInput as unknown as CurrentDashboardLiveData;
  const { handleCompleteTask } = useDashboard();
  const seededEvents = useMemo(() => liveData.liveCalendar || [], [liveData.liveCalendar]);
  const [events, setEvents] = useState<DashboardCalendarEvent[]>([]);
  const [liveEventsReady, setLiveEventsReady] = useState(false);
  const [today, setToday] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }));
  useEffect(() => {
    const refreshDay = () => setToday(new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }));
    refreshDay();
    const timer = window.setInterval(refreshDay, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const ensureCalendarRange = calendarRange.ensureRange;
  const calendarRevision = calendarRange.revision ?? 0;

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
          const normalizedResult = result as DashboardCalendarEvent[];
          // Only swap the events reference when the resolved range content
          // actually differs, so an unchanged refetch doesn't reconcile the
          // (memoized) timeline/hero with a new-but-equal array.
          setEvents((prev) => (
            calendarContentSignature(prev) === calendarContentSignature(normalizedResult) ? prev : normalizedResult
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
  // Content-stabilize the live fallback like liveCalendar/stableCalendarRef in
  // useCurrentDashboard.ts: getCurrentDashboard() hands back a freshly-parsed
  // `deadlines.upcoming` array on every poll even when nothing changed, which
  // otherwise busts every downstream consumer of `deadlines` (band model,
  // ComingUp, DashboardProvider) each poll.
  const liveUpcomingRef = useRef<DashboardDeadline[]>([]);
  /* eslint-disable react-hooks/refs -- ref-cache-by-signature pattern, identical
     in shape to stableCalendarRef in useCurrentDashboard.ts (which lints clean
     under this same rule); the rule's static analysis doesn't recognize the two
     call sites as equivalent. */
  const liveUpcoming = useMemo(() => {
    const currentUpcoming = (currentDeadlines.upcoming || []) as DashboardDeadline[];
    const next = stabilizeDeadlines(liveUpcomingRef.current, currentUpcoming) || [];
    liveUpcomingRef.current = next;
    return next;
  }, [currentDeadlines.upcoming]);
  /* eslint-enable react-hooks/refs */
  const deadlines = useMemo(
    () => {
      if (calendarDeadlinesReady) return calendarDeadlines?.upcoming || [];
      return allowCurrentDeadlineFallback ? liveUpcoming : [];
    },
    [allowCurrentDeadlineFallback, calendarDeadlines?.upcoming, calendarDeadlinesReady, liveUpcoming],
  );
  const bills = liveData.liveBills || [];
  const bandLanes = useMemo(() => activeSnapshot ? Object.fromEntries(
    Object.entries({ ...activeSnapshot.lanes, carryover: activeSnapshot.carryover }).map(([lane, items]) => [
      lane, items.map((item) => ({ ...item, snapshot_item_id: item.id })),
    ]),
  ) : undefined, [activeSnapshot]);
  const excludedEmailIds = useMemo(() => buildNeedsYouModel({ snapshotLanes: bandLanes, maxCards: Infinity, backfillLimit: 0 }).urgentCards.flatMap((card) => card.uid == null ? [] : [String(card.uid)]), [bandLanes]);
  // NeedsYouBand reads liveDeadlines.upcoming (object form); `deadlines` is the
  // flattened array, so wrap it (memoized to keep the band's model cache stable).
  const bandDeadlines = useMemo(() => ({ upcoming: deadlines }), [deadlines]);
  const todayDeadlines = useMemo(() => deadlines.filter((deadline) => deadline.due_date && deadline.due_date.slice(0, 10) <= today), [deadlines, today]);
  const [promotedDeadlineIds, setPromotedDeadlineIds] = useState<readonly string[]>([]);
  const handlePromotedDeadlineIdsChange = useCallback((nextIds: readonly string[]) => {
    setPromotedDeadlineIds((previousIds) => (
      previousIds.length === nextIds.length
      && previousIds.every((id, index) => id === nextIds[index])
        ? previousIds
        : [...nextIds]
    ));
  }, []);
  const displayEvents = liveEventsReady ? events : seededEvents;
  const eventLoadingState = liveEventsReady
    ? "ready"
    : seededEvents.length > 0
      ? "refreshing"
      : "empty_loading";

  const handleRailJump = useCallback((payload: DashboardJumpPayload, anchor?: HTMLElement) => {
    if (!payload) return;
    const data = payload.data && typeof payload.data === "object"
      ? payload.data as Record<string, unknown>
      : undefined;
    const email = payload.email && typeof payload.email === "object"
      ? payload.email as { id?: string | number }
      : undefined;
    if (payload.kind === "email" && email?.id) {
      onOpenEmail(email.id);
    } else if (payload.kind === "deadline") {
      onOpenDeadline((data || payload) as DashboardDeadline, anchor);
    } else if (payload.kind === "bill") {
      const nextDate = typeof data?.next_date === "string" ? data.next_date : payload.date || null;
      const dataId = typeof data?.id === "string" || typeof data?.id === "number" ? data.id : null;
      onOpenBillsCalendar(nextDate, payload.id || dataId, data, anchor);
    } else if (payload.kind === "event" && typeof data?.startMs === "number") {
      const ymd = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
      }).format(new Date(data.startMs));
      onOpenEventsCalendar(ymd, payload.id || getEventSelectionId(data), data, anchor);
    }
  }, [onOpenEmail, onOpenDeadline, onOpenBillsCalendar, onOpenEventsCalendar]);

  // Stable inbox-open handler shared by the band and the context column, so a
  // pure poll/refresh re-render does not hand them a fresh arrow identity.
  const handleOpenInbox = useCallback((lane?: "needs_attention" | "carryover" | "fyi" | "queued") => {
    if (onOpenInbox) onOpenInbox(lane);
    else onOpenEmail(null);
  }, [onOpenEmail, onOpenInbox]);

  // Wire the band's "handled" action straight to the snapshot endpoint; it emits
  // the SSE the dashboard refetches on, so no extra dispatch hook is needed here.
  // The promise is returned (not swallowed) so the band can revert its
  // optimistic hide and surface an error when the request fails.
  const handleMarkHandled = useCallback((snapshotItemId: number) => {
    if (snapshotItemId != null) return Promise.resolve(markSnapshotItemHandled(snapshotItemId));
  }, []);

  // Deadline "Mark done" in the band routes through the same canonical completer
  // the deadline popover uses (optimistic flag → completeDeadlineOccurrence →
  // revert on failure), so the Todoist task is actually marked complete. The
  // promise (and its resolved true/false) is returned so the band can revert
  // its own optimistic hide and surface an error on failure.
  const handleCompleteDeadline = useCallback((id: string | number, data: unknown) => {
    return handleCompleteTask(String(id), data as DashboardDeadline);
  }, [handleCompleteTask]);

  const band = (
    <NeedsYouBand
      snapshotLanes={bandLanes}
      liveDeadlines={bandDeadlines}
      liveBills={bills}
      railThreshold={5}
      isMobile={isMobile}
      onOpenEmail={onOpenEmail}
      onMarkHandled={handleMarkHandled}
      onCompleteDeadline={handleCompleteDeadline}
      onOpen={handleRailJump}
      onPromotedDeadlineIdsChange={handlePromotedDeadlineIdsChange}
    />
  );

  const timeline = (
    <TodayTimeline accent={accent} isMobile={isMobile} events={displayEvents} deadlines={todayDeadlines}
      promotedDeadlineIds={promotedDeadlineIds}
      onJump={handleRailJump} eventLoadingState={eventLoadingState}
      domainRefreshing={domainRefreshing} deadlinesLoading={calendarDeadlinesLoading}
      scrollContained={false} />
  );

  const timelinePanel = (
    <div className="dashboard-main-stack">
      <DashboardSurface isMobile={isMobile}>
        <DashboardScheduleNotices events={displayEvents} refreshKey={String(domainRefreshing)}
          onOpenEvent={(event, anchor) => handleRailJump({ kind: "event", id: event.id, data: event }, anchor)} />
        {timeline}
      </DashboardSurface>
      <DashboardFinance bills={bills} billsLoading={liveData.billsLoading} configured={liveData.actualConfigured}
        health={liveData.billsSyncHealth} refreshing={domainRefreshing}
        onOpenBill={(bill, anchor) => handleRailJump({ kind: "bill", id: bill.id, date: bill.next_date, data: bill }, anchor)}
        onOpenTransactions={(date) => onOpenBillsCalendar(date, null)} />
    </div>
  );

  const contextColumn = (
    <ContextColumn accent={accent} isMobile={isMobile} liveWeather={liveData.liveWeather}
      liveDeadlines={deadlines} activeSnapshot={activeSnapshot} excludedEmailIds={excludedEmailIds}
      onJump={handleRailJump} onOpenInbox={handleOpenInbox} onCompleteDeadline={handleCompleteDeadline} />
  );

  return <ThreeTierLayout isMobile={isMobile} band={band} timelinePanel={timelinePanel} contextColumn={contextColumn} />;
}

// Memoized so the dashboard poll loop / SSE refetch / 5-min refresh skip
// re-rendering the whole hero+timeline+rails subtree when DashboardBody's props
// are referentially unchanged (the bulk liveData slice is now stable across the
// isPolling/refreshing toggles — see useCurrentDashboard).
export const DashboardBody = memo(DashboardBodyInner);
