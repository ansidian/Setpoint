import { buildDemoNews } from "./newsData.ts";
import { buildDemoTransactions } from "./financeData.ts";
import { buildDemoWeather } from "./weatherData.ts";
import { buildDemoInboxSeed } from "./inboxData.ts";
const WORK_COLOR = "#89b4fa";
const PERSONAL_COLOR = "#cba6f7";
const CAREER_COLOR = "#f5c2e7";
const BILLS_COLOR = "#a6e3a1";

// Demo calendar events are built in the viewer's local zone (atLocalIso), but
// the app filters/ranges by the Pacific calendar day to match the real server.
// Deriving the day from an event's local-time ISO string via `.slice(0, 10)`
// is the UTC day, which drops boundary events for non-Pacific viewers. Resolve
// the Pacific calendar day from the epoch instead, mirroring the UI's pacificYMD.
const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const PACIFIC_YMD_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type DemoSeed = ReturnType<typeof makeDemoSeed>;
type DemoCalendarEvent = ReturnType<typeof event>;
type DemoTask = ReturnType<typeof task>;

let cachedSeed: DemoSeed | null = null;
let cachedDateKey: string | null = null;

const clone = <T>(value: T): T => value == null ? value : structuredClone(value);

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function monthDay(anchor: Date, dayNumber: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth(), Math.min(dayNumber, daysInMonth(anchor)));
}

function monthDates(anchor: Date): Date[] {
  return Array.from({ length: daysInMonth(anchor) }, (_, index) => monthDay(anchor, index + 1));
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function atLocalIso(baseDate: Date, hour: number, minute = 0): string {
  const value = new Date(baseDate);
  value.setHours(hour, minute, 0, 0);
  return value.toISOString();
}

interface DemoEventInput {
  id: string;
  title: string;
  day: Date;
  startHour: number;
  endHour: number;
  startMinute?: number;
  endMinute?: number;
  calendarId?: string;
  calendarName?: string;
  sourceColor?: string;
  location?: string;
  description?: string;
}

function event({
  id,
  title,
  day,
  startHour,
  endHour,
  startMinute = 0,
  endMinute = 0,
  calendarId = "demo-work",
  calendarName = "Demo Work",
  sourceColor = WORK_COLOR,
  location = "",
  description = "Fictional demo calendar event.",
}: DemoEventInput) {
  const start = atLocalIso(day, startHour, startMinute);
  const end = atLocalIso(day, endHour, endMinute);
  return {
    id,
    title,
    calendarId,
    calendarName,
    accountId: "demo-gmail",
    accountLabel: "Demo Gmail",
    source: calendarName,
    sourceLabel: calendarName,
    sourceColor,
    color: sourceColor,
    start,
    end,
    startMs: new Date(start).getTime(),
    endMs: new Date(end).getTime(),
    allDay: false,
    location,
    description,
  };
}

interface DemoTaskInput {
  id: string;
  title: string;
  day: Date;
  status?: string;
  points?: number | null;
  className?: string;
  dueTime?: string | null;
  description?: string;
  priority?: number;
}

function task({
  id,
  title,
  day,
  status = "open",
  points = null,
  className = "Inbox",
  dueTime = null,
  description = "",
  priority = 1,
}: DemoTaskInput) {
  return {
    id,
    todoist_id: id,
    title,
    due_date: dateKey(day),
    due_time: dueTime,
    status,
    source: "todoist",
    points_possible: points,
    class_name: className,
    project_name: className,
    description,
    priority,
  };
}

function bill({ id, payee, day, amount, paid = false }: { id: string; payee: string; day: Date; amount: number; paid?: boolean }) {
  const nextDate = dateKey(day);
  return {
    id: `${id}:${nextDate}`,
    scheduleId: id,
    name: payee,
    payee,
    amount,
    next_date: nextDate,
    paid,
    type: "bill",
    openActionDisabled: true,
  };
}

function makeWorkdayStandups(today: Date): DemoCalendarEvent[] {
  return monthDates(today)
    .filter(isWeekday)
    .map((day) => event({
      id: `demo-event-standup-${dateKey(day)}`,
      title: "Backend platform standup",
      day,
      startHour: 9,
      startMinute: 30,
      endHour: 9,
      endMinute: 45,
      location: "Engineering Zoom",
      description: "Daily platform standup for API reliability, inbox triage, calendar sync, and release blockers.",
    }));
}

function makeMonthEvent(today: Date, dayNumber: number, config: Omit<DemoEventInput, "day">): DemoCalendarEvent {
  return event({
    day: monthDay(today, dayNumber),
    ...config,
  });
}

function makeCalendarEvents(today: Date, tomorrow: Date): DemoCalendarEvent[] {
  return [
    event({ id: "demo-event-review", title: "Portfolio review prep", day: today, startHour: 10, endHour: 11, location: "Focus room", description: "Walk through recruiter-facing Setpoint demo path and tighten screenshots." }),
    event({ id: "demo-event-sync", title: "Product sync with Morgan", day: today, startHour: 13, endHour: 14, location: "Product Zoom", description: "Review inbox automation tradeoffs, demo scope, and product risk." }),
    event({ id: "demo-event-bills", title: "Budget review block", day: tomorrow, startHour: 16, endHour: 17, sourceColor: BILLS_COLOR, location: "Desk", description: "Reconcile recurring bills and verify bill-pay copy." }),
    ...makeWorkdayStandups(today),
    makeMonthEvent(today, 4, { id: "demo-event-sprint-planning", title: "Sprint planning: inbox automation", startHour: 10, endHour: 11, calendarName: "Demo Work", sourceColor: WORK_COLOR, location: "Team room", description: "Shape triage worker scope, UI guardrails, and release risks." }),
    makeMonthEvent(today, 5, { id: "demo-event-oncall-handoff", title: "On-call handoff", startHour: 15, endHour: 16, location: "Incident channel", description: "Review webhook retries, Gmail watch renewals, and alert ownership." }),
    makeMonthEvent(today, 7, { id: "demo-event-architecture-review", title: "Architecture review: snapshot lifecycle", startHour: 11, endHour: 12, location: "Architecture Zoom", description: "Finalize cache boundaries and idempotent active snapshot refresh behavior." }),
    makeMonthEvent(today, 8, { id: "demo-event-code-review", title: "Code review queue", startHour: 14, endHour: 15, location: "GitHub reviews", description: "Clear PR comments on calendar, inbox, and bill extraction changes." }),
    makeMonthEvent(today, 11, { id: "demo-event-design-handoff", title: "Design handoff: dense dashboard states", startHour: 11, endHour: 12, location: "Figma review", description: "Check focus, hover, and compact dashboard layout states before release." }),
    makeMonthEvent(today, 13, { id: "demo-event-incident-review", title: "Incident review: webhook retries", startHour: 15, endHour: 16, location: "Reliability Zoom", description: "Postmortem retry-loop alert, replay safety, and provider backoff behavior." }),
    makeMonthEvent(today, 14, { id: "demo-event-one-on-one", title: "1:1 with engineering manager", startHour: 10, startMinute: 30, endHour: 11, location: "Manager Zoom", description: "Discuss scope control, project narrative, and next SWE role targets." }),
    makeMonthEvent(today, 15, { id: "demo-event-release-check", title: "Release train check", startHour: 16, endHour: 16, endMinute: 30, location: "Release channel", description: "Confirm demo build, lint, tests, and static deploy readiness." }),
    makeMonthEvent(today, 18, { id: "demo-event-api-observability", title: "API observability deep dive", startHour: 11, endHour: 12, location: "Ops review", description: "Review dashboard-current events, provider health, and stale-cache telemetry." }),
    makeMonthEvent(today, 20, { id: "demo-event-product-qa", title: "Product QA: calendar editor", startHour: 13, endHour: 14, location: "QA workspace", description: "Run through source moves, overflow chips, and selected agenda detail flows." }),
    makeMonthEvent(today, 22, { id: "demo-event-demo-dry-run", title: "Portfolio demo dry run", startHour: 15, endHour: 16, calendarId: "demo-career", calendarName: "Demo Career", sourceColor: CAREER_COLOR, location: "Desk", description: "Practice a concise SWE walkthrough with product context and implementation depth." }),
    makeMonthEvent(today, 25, { id: "demo-event-retro", title: "Sprint retro: reliability polish", startHour: 10, endHour: 11, location: "Retro board", description: "Capture what improved in email triage, calendar sync, and demo safety." }),
    makeMonthEvent(today, 27, { id: "demo-event-interview-prep", title: "System design interview prep", startHour: 18, endHour: 19, calendarId: "demo-career", calendarName: "Demo Career", sourceColor: CAREER_COLOR, location: "Home desk", description: "Review single-user dashboard architecture, data freshness, and failure modes." }),
    makeMonthEvent(today, 29, { id: "demo-event-month-close", title: "Month-end finance and roadmap review", startHour: 14, endHour: 15, calendarId: "demo-personal", calendarName: "Demo Personal", sourceColor: PERSONAL_COLOR, location: "Desk", description: "Close budget review and plan next portfolio feature pass." }),
  ];
}

function makeDeadlineStats(items: DemoTask[], today: Date) {
  const todayKey = dateKey(today);
  const weekFromNow = dateKey(addDays(today, 7));
  let incomplete = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let totalPoints = 0;

  for (const item of items) {
    if (item.status !== "complete") incomplete += 1;
    if (item.due_date === todayKey) dueToday += 1;
    if (item.due_date >= todayKey && item.due_date <= weekFromNow) dueThisWeek += 1;
    if (item.points_possible) totalPoints += item.points_possible;
  }

  return { incomplete, dueToday, dueThisWeek, totalPoints };
}

function makeDemoSeed(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const soon = addDays(today, 3);
  const later = addDays(today, 8);
  const fetchedAt = now.toISOString();
  const inboxSeed = buildDemoInboxSeed(now);

  const calendarEvents = makeCalendarEvents(today, tomorrow);

  const upcomingDeadlines = [
    task({ id: "demo-deadline-notes", title: "Finalize dashboard walkthrough notes", day: tomorrow, points: 20, className: "Portfolio Systems", dueTime: "5pm", priority: 3 }),
    task({ id: "demo-deadline-recording", title: "Record two-minute product tour", day: later, points: 10, className: "Portfolio Systems", dueTime: "7pm", priority: 2 }),
    task({ id: "demo-task-link", title: "Send portfolio demo link", day: today, className: "Career", dueTime: "4pm", priority: 3 }),
    task({ id: "demo-task-budget", title: "Review mock bill-pay copy", day: soon, className: "Product", dueTime: "3pm", priority: 2 }),
    task({ id: "demo-task-pr-review", title: "Respond to PR review on calendar source moves", day: addDays(today, 2), className: "Engineering", dueTime: "1pm", priority: 4, description: "Reply to comments, rerun focused tests, and keep source edit behavior idempotent." }),
    task({ id: "demo-task-worker-runbook", title: "Update triage-worker retry runbook", day: addDays(today, 2), className: "Engineering", dueTime: "11am", priority: 2 }),
    task({ id: "demo-task-incident-postmortem", title: "Publish webhook retry postmortem", day: addDays(today, 4), className: "Engineering", dueTime: "5pm", points: 8, priority: 3 }),
    task({ id: "demo-task-product-metrics", title: "QA product metrics dashboard cards", day: addDays(today, 5), className: "Product", dueTime: "2pm", points: 5, priority: 2 }),
    task({ id: "demo-task-architecture-rfc", title: "Draft snapshot cache lifecycle RFC", day: addDays(today, 6), className: "Engineering", dueTime: "6pm", points: 13, priority: 3 }),
    task({ id: "demo-task-recruiter-packet", title: "Send recruiter follow-up packet", day: addDays(today, 9), className: "Career", dueTime: "10am", priority: 2 }),
    task({ id: "demo-task-release-checklist", title: "Close static demo release checklist", day: addDays(today, 7), className: "Engineering", dueTime: "4pm", points: 5, priority: 3 }),
    task({ id: "demo-task-design-audit", title: "Audit hover and focus states before demo deploy", day: today, className: "Product", dueTime: "12pm", points: 3, priority: 2 }),
    task({ id: "demo-task-interview-stories", title: "Polish SWE interview project stories", day: addDays(today, 4), className: "Career", dueTime: "8pm", priority: 2 }),
    task({ id: "demo-task-dependency-review", title: "Clear dependency security review", day: monthDay(today, 26), status: "complete", className: "Engineering", dueTime: "5pm", priority: 1 }),
    task({ id: "demo-task-monthly-retro", title: "Write monthly engineering retro notes", day: addDays(today, 10), className: "Engineering", dueTime: "6pm", points: 5, priority: 1 }),
  ];

  const deadlines = {
    upcoming: upcomingDeadlines,
    stats: makeDeadlineStats(upcomingDeadlines, today),
  };

  const bills = [
    bill({ id: "demo-electric", payee: "Demo Electric", day: tomorrow, amount: 146.32 }),
    bill({ id: "demo-water", payee: "Northstar Water", day: later, amount: 58.11 }),
    bill({ id: "demo-internet", payee: "Fiber Co-op", day: yesterday, amount: 79.99, paid: true }),
    bill({ id: "demo-rent", payee: "Northstar Lofts", day: monthDay(today, 1), amount: 2450.00, paid: true }),
    bill({ id: "demo-phone", payee: "Signal Mobile", day: monthDay(today, 12), amount: 64.20, paid: true }),
    bill({ id: "demo-cloud", payee: "Cloud Sandbox", day: addDays(today, 5), amount: 38.47 }),
    bill({ id: "demo-card", payee: "Everyday Card", day: today, amount: 512.84 }),
    bill({ id: "demo-student-loan", payee: "Student Loan Servicer", day: addDays(today, 6), amount: 220.00 }),
  ];
  const transactions = buildDemoTransactions(dateKey(today), dateKey(yesterday));
  const payeeMap = Object.fromEntries(bills.map((entry) => [entry.scheduleId, entry.payee]));

  const providerHealth = {
    currentData: {
      state: "current",
      sources: [
        { key: "demo_static", label: "Demo data", state: "current", severity: "none", message: "Static demo seed is current." },
      ],
    },
    activeSnapshot: { state: "current", reason: "demo_seed" },
  };

  const settings = {
    demo: true,
    email_triage_mode: "auto",
    effective_email_triage_mode: "auto",
    triage_sound_enabled: false,
    briefing_schedule_enabled: false,
    discord_reminder_webhook_url: "",
    actual_budget_url: "https://actual.example.invalid/demo",
    actual_configured: true,
    alfred_provider: "demo",
    alfred_model: "demo-alfred-model",
  };

  return {
    dateKey: dateKey(today),
    currentDashboard: {
      weather: buildDemoWeather(today),
      calendar: calendarEvents,
      deadlines,
      bills,
      allSchedules: bills,
      payeeMap,
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.invalid/demo",
      billsSyncHealth: { state: "current", message: "Demo bills are generated locally." },
      activeSnapshot: inboxSeed.activeSnapshot,
      providerHealth,
      systemStatus: {
        state: "current",
        sources: providerHealth.currentData.sources,
      },
      fetchedAt,
    },
    calendarEvents,
    deadlines,
    bills,
    transactions,
    activeSnapshot: inboxSeed.activeSnapshot,
    settings,
    accounts: inboxSeed.accounts,
    actualMetadata: {
      accounts: [
        { id: "demo-checking", name: "Demo Checking", offbudget: false, closed: false },
        { id: "demo-savings", name: "Emergency Fund", offbudget: false, closed: false },
        { id: "demo-credit", name: "Everyday Card", offbudget: false, closed: false },
      ],
      payees: bills.map((entry) => ({ id: entry.scheduleId, name: entry.payee })),
      categories: [
        { group_name: "Demo Housing", categories: [{ id: "demo-rent-category", name: "Rent" }] },
        { group_name: "Demo Bills", categories: [{ id: "demo-utilities", name: "Utilities" }, { id: "demo-cloud-services", name: "Cloud Services" }] },
        { group_name: "Demo Debt", categories: [{ id: "demo-loans", name: "Loan Payments" }, { id: "demo-credit-card", name: "Credit Card" }] },
      ],
    },
    notes: [
      { id: "demo-note-1", user_id: "demo-user", content: "Demo walkthrough: dashboard, inbox, calendar, bills, then settings.", sort_order: 1, created_at: fetchedAt, updated_at: fetchedAt, archived_at: null as string | null },
      { id: "demo-note-2", user_id: "demo-user", content: "All names, accounts, and providers are fictional.", sort_order: 2, created_at: fetchedAt, updated_at: fetchedAt, archived_at: null as string | null },
      { id: "demo-note-3", user_id: "demo-user", content: "Talk track: single-user system, rolling data boundary, inbox triage, calendar overlays, Actual Budget mapping.", sort_order: 3, created_at: fetchedAt, updated_at: fetchedAt, archived_at: null as string | null },
      { id: "demo-note-4", user_id: "demo-user", content: "Capture screenshots on a weekday: inbox pressure, month calendar density, selected deadline rail, bills ledger.", sort_order: 4, created_at: fetchedAt, updated_at: fetchedAt, archived_at: null as string | null },
    ],
    news: buildDemoNews(),
    importantSenders: inboxSeed.importantSenders,
    emailBodies: inboxSeed.emailBodies,
    snoozedEmails: inboxSeed.snoozedEmails,
  };
}

export function getDemoSeed(): DemoSeed {
  const now = new Date();
  const key = dateKey(now);
  if (!cachedSeed || cachedDateKey !== key) {
    cachedSeed = makeDemoSeed(now);
    cachedDateKey = key;
  }
  return cachedSeed;
}

export const forkDemoSeedForMutation = () => (cachedSeed = clone(getDemoSeed()));

export function readDemoSeed(): DemoSeed {
  return clone(getDemoSeed());
}

export function pacificYMD(ms: number): string {
  return PACIFIC_YMD_FORMATTER.format(new Date(ms));
}
