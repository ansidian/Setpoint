import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardHero from "./DashboardHero";
import TodayTimeline from "./TodayTimeline";
import { InsightsRail, DeadlinesRail, BillsRail, InboxPeek } from "./rails/Rails";
import NotesRail from "../notes/NotesRail";
import { useDashboard } from "../../context/DashboardContext";
import { focusPressureDate } from "../../lib/focus-windows";
import { getEventSelectionId } from "../../lib/redesign-helpers";
import {
  DashboardBodyLayout,
  DashboardSurface,
} from "./layout/DashboardScenePrimitives";

export function DashboardBody({
  briefing, liveData, calendarRange, customize, accent,
  isMobile = false,
  onOpenEmail, onOpenDeadline, onOpenBillsCalendar, onOpenEventsCalendar, onOpenDeadlinesCalendar, onOpenTodoistCreate, onJumpSection, setAddTaskOpen,
}) {
  const { dashboardLayout, density, showInsights, showInboxPeek, showNotes } = customize;
  const effectiveLayout = isMobile ? "paper" : dashboardLayout;
  const ctx = useDashboard();

  const seededEvents = useMemo(() => briefing?.calendar || [], [briefing?.calendar]);
  const [events, setEvents] = useState([]);
  const [liveEventsReady, setLiveEventsReady] = useState(false);
  const today = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()),
    [],
  );
  const ensureCalendarRange = calendarRange.ensureRange;
  const calendarRevision = calendarRange.revision;

  useEffect(() => {
    const endDate = new Date(`${today}T12:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 14);
    const end = endDate.toISOString().slice(0, 10);
    let cancelled = false;
    ensureCalendarRange(today, end)
      .then((result) => {
        if (!cancelled) {
          setEvents(result);
          setLiveEventsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents((prev) => (prev.length > 0 ? prev : seededEvents));
          setLiveEventsReady(true);
        }
      });
    return () => { cancelled = true; };
  }, [ensureCalendarRange, today, seededEvents, calendarRevision]);
  const ctm = useMemo(() => briefing?.ctm?.upcoming || [], [briefing?.ctm?.upcoming]);
  const todoist = useMemo(() => briefing?.todoist?.upcoming || [], [briefing?.todoist?.upcoming]);
  const deadlines = useMemo(() => [...ctm, ...todoist], [ctm, todoist]);
  const bills = liveData.liveBills || [];
  const insights = briefing?.aiInsights || [];
  const emailAccounts = ctx.emailAccounts;
  const pressureNow = useMemo(() => new Date(`${today}T12:00:00Z`).getTime(), [today]);
  const displayEvents = liveEventsReady ? events : seededEvents;
  const eventLoadingState = liveEventsReady
    ? "ready"
    : seededEvents.length > 0
      ? "refreshing"
      : "empty_loading";
  const billsLoadingState = liveData.actualConfigured && liveData.billsLoading && !bills.length
    ? "empty_loading"
    : "ready";
  const pressureFocusDate = useMemo(
    () => focusPressureDate(deadlines, pressureNow),
    [deadlines, pressureNow],
  );

  const handleRailJump = useCallback((payload, anchor) => {
    if (!payload) return;
    if (payload.kind === "email" && payload.email?.id) {
      onOpenEmail(payload.email.id);
    } else if (payload.kind === "deadline") {
      onOpenDeadline(payload.data || payload, anchor);
    } else if (payload.kind === "bill") {
      onOpenBillsCalendar(payload.data?.next_date || payload.date || null);
    } else if (payload.kind === "event" && payload.data?.startMs) {
      const ymd = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
      }).format(new Date(payload.data.startMs));
      onOpenEventsCalendar(ymd, payload.id || getEventSelectionId(payload.data));
    }
  }, [onOpenEmail, onOpenDeadline, onOpenBillsCalendar, onOpenEventsCalendar]);

  const hero = (
    <DashboardHero
      accent={accent}
      density={density}
      isMobile={isMobile}
      stack={isMobile}
      briefing={briefing}
      liveWeather={liveData.liveWeather}
      liveCalendar={displayEvents}
      liveBills={bills}
      onOpenPressure={() => onOpenDeadlinesCalendar?.(pressureFocusDate)}
      eventLoadingState={eventLoadingState}
      onQuickAction={(action) => {
        if (action === "task") {
          if (onOpenTodoistCreate) onOpenTodoistCreate();
          else setAddTaskOpen?.(true);
        } else if (action === "event") {
          onOpenEventsCalendar(today, "new");
        }
      }}
      onJump={(payload, anchor) => {
        if (payload?.kind === "deadline") {
          // Callout carries { title, sub, ... } but not the full task — find it.
          const task = deadlines.find((d) => d.title === payload.title);
          if (task) onOpenDeadline(task, anchor);
        } else if (payload?.kind === "bill") {
          const match = bills.find((b) => b.name === payload.title);
          onOpenBillsCalendar(match?.next_date || payload.date || null);
        } else {
          onJumpSection("timeline");
        }
      }}
    />
  );

  const timeline = (
    <TodayTimeline
      accent={accent}
      density={density}
      isMobile={isMobile}
      events={displayEvents}
      deadlines={deadlines}
      onJump={handleRailJump}
      eventLoadingState={eventLoadingState}
      scrollContained={effectiveLayout === "focus"}
    />
  );

  const timelinePanel = (
    <DashboardSurface
      isMobile={isMobile}
      style={{
        minHeight: isMobile ? 520 : 0,
        height: !isMobile && effectiveLayout === "focus" ? "100%" : undefined,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {timeline}
    </DashboardSurface>
  );

  const insightsSection = showInsights ? (
    <InsightsRail
      accent={accent}
      insights={insights}
      onJump={handleRailJump}
      isMobile={isMobile}
      maxItems={isMobile ? 2 : 5}
    />
  ) : null;

  const deadlinesSection = <DeadlinesRail accent={accent} deadlines={deadlines} onJump={handleRailJump} isMobile={isMobile} />;

  const billsSection = (
    <BillsRail
      accent={accent}
      bills={bills}
      onJump={handleRailJump}
      isMobile={isMobile}
      loadingState={billsLoadingState}
    />
  );

  const inboxSection = showInboxPeek ? (
    <InboxPeek
      accent={accent}
      isMobile={isMobile}
      emailAccounts={emailAccounts}
      onJump={handleRailJump}
      onOpenInbox={() => onOpenEmail(null)}
    />
  ) : null;

  const notesSection = showNotes ? <NotesRail accent={accent} /> : null;

  return (
    <DashboardBodyLayout
      layoutMode={effectiveLayout}
      isMobile={isMobile}
      hero={hero}
      timelinePanel={timelinePanel}
      mobileSections={[deadlinesSection, billsSection, inboxSection, insightsSection]}
      primaryRailSections={[insightsSection, deadlinesSection, billsSection, inboxSection]}
      commandPrimaryRailSections={[insightsSection, deadlinesSection, notesSection]}
      commandSecondaryRailSections={[billsSection, inboxSection]}
    />
  );
}
