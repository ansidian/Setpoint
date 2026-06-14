import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardHero from "./DashboardHero";
import TodayTimeline from "./TodayTimeline";
import { DeadlinesRail, BillsRail, InboxPeek } from "./rails/Rails";
import NotesRail from "../notes/NotesRail";
import { focusPressureTarget } from "../../lib/focus-windows";
import { getEventSelectionId } from "../../lib/shell-helpers";
import {
  DashboardBodyLayout,
  DashboardSurface,
} from "./layout/DashboardScenePrimitives";
import { resolveDashboardBodyLayout } from "./dashboardBodyLayoutModel";

const EMPTY_EMAIL_ACCOUNTS = [];

export function DashboardBody({
  briefing, liveData, activeSnapshot, calendarRange, customize, accent,
  isMobile = false, calendarDeadlines = undefined, calendarDeadlinesLoading = false, calendarDeadlinesError = false,
  onOpenEmail, onOpenDeadline, onOpenBillsCalendar, onOpenEventsCalendar, onOpenDeadlinesCalendar, onOpenDeadlineCreate, onJumpSection, setAddTaskOpen,
}) {
  const { dashboardLayout, density, showInboxPeek, showNotes } = customize;
  const layoutPlan = resolveDashboardBodyLayout({
    isMobile,
    dashboardLayout,
    showInboxPeek,
    showNotes,
  });
  const effectiveLayout = layoutPlan.layoutMode;

  const seededEvents = useMemo(() => liveData.liveCalendar || [], [liveData.liveCalendar]);
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
  const deadlinesLoadingState = !calendarDeadlinesReady && !allowCurrentDeadlineFallback && (calendarDeadlinesLoading || calendarDeadlines === null)
    ? "empty_loading"
    : "ready";
  const pressureFocusTarget = useMemo(
    () => focusPressureTarget(deadlines, pressureNow),
    [deadlines, pressureNow],
  );

  const handleRailJump = useCallback((payload, anchor) => {
    if (!payload) return;
    if (payload.kind === "email" && payload.email?.id) {
      onOpenEmail(payload.email.id);
    } else if (payload.kind === "deadline") {
      onOpenDeadline(payload.data || payload, anchor);
    } else if (payload.kind === "bill") {
      onOpenBillsCalendar(payload.data?.next_date || payload.date || null, payload.id || payload.data?.id || null);
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
      liveDeadlines={deadlines}
      liveBills={bills}
      onOpenPressure={() => onOpenDeadlinesCalendar?.(pressureFocusTarget?.date || null, pressureFocusTarget?.id || null)}
      eventLoadingState={eventLoadingState}
      onQuickAction={(action) => {
        if (action === "deadline") {
          if (onOpenDeadlineCreate) onOpenDeadlineCreate();
          else setAddTaskOpen?.(true);
        } else if (action === "event") {
          onOpenEventsCalendar(today, "new");
        }
      }}
      onJump={(payload, anchor) => {
        if (payload?.kind === "deadline") {
          if (payload.data) {
            onOpenDeadline(payload.data, anchor);
          } else if (payload.id && payload.date) {
            onOpenDeadlinesCalendar?.(payload.date, payload.id);
          } else {
            onOpenDeadlinesCalendar?.(payload.date || null);
          }
        } else if (payload?.kind === "event") {
          if (payload.id && payload.date) onOpenEventsCalendar(payload.date, payload.id);
          else onJumpSection("timeline");
        } else if (payload?.kind === "bill") {
          if (payload.id && payload.date) onOpenBillsCalendar(payload.date, payload.id);
          else onOpenBillsCalendar(payload.date || null);
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
      scrollContained={!isMobile}
    />
  );

  const timelinePanel = (
    <DashboardSurface
      isMobile={isMobile}
      style={{
        minHeight: isMobile ? 520 : 0,
        height: !isMobile && effectiveLayout !== "paper" ? "100%" : undefined,
        flex: !isMobile && effectiveLayout === "paper" ? "1 1 0" : undefined,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {timeline}
    </DashboardSurface>
  );

  const deadlinesSection = <DeadlinesRail accent={accent} deadlines={deadlines} onJump={handleRailJump} isMobile={isMobile} loadingState={deadlinesLoadingState} />;

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

  const notesSection = showNotes ? <NotesRail accent={accent} isMobile={isMobile} /> : null;
  const sectionByKey = {
    deadlines: deadlinesSection,
    bills: billsSection,
    "inbox-peek": inboxSection,
    notes: notesSection,
  };
  const sectionsFor = (sectionKeys) => sectionKeys.map((key) => sectionByKey[key]).filter(Boolean);

  return (
    <DashboardBodyLayout
      layoutMode={effectiveLayout}
      isMobile={isMobile}
      hero={hero}
      timelinePanel={timelinePanel}
      mobileSections={sectionsFor(layoutPlan.mobileSectionOrder)}
      primaryRailSections={sectionsFor(layoutPlan.primaryRailSectionOrder)}
      commandPrimaryRailSections={sectionsFor(layoutPlan.commandPrimaryRailSectionOrder)}
      commandSecondaryRailSections={sectionsFor(layoutPlan.commandSecondaryRailSectionOrder)}
    />
  );
}
