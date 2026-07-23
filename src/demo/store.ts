import { buildDemoNews } from "./newsData.ts";
import { buildDemoTransactions } from "./financeData.ts";
import { buildDemoWeather } from "./weatherData.ts";
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
type DemoSnapshotEmail = ReturnType<typeof snapshotEmail>;
type DemoLaneKey = "queued" | "needs_attention" | "catch_up" | "fyi" | "handled" | "untriaged_read" | "noise";
type DemoLanes = Record<DemoLaneKey, DemoSnapshotEmail[]>;

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

interface DemoSnapshotEmailInput {
  itemId: number;
  uid: string;
  accountId: string;
  lane: DemoLaneKey;
  subject: string;
  fromName: string;
  fromAddress: string;
  summary: string;
  day: Date;
  read?: boolean;
  category?: string;
  source?: string | null;
  sourceAt?: string | null;
  laneAtSnapshot?: DemoLaneKey | null;
  handledAt?: string | null;
  escalationBadge?: string | null;
  receivedHour?: number | null;
  receivedMinute?: number | null;
}

function snapshotEmail({
  itemId,
  uid,
  accountId,
  lane,
  subject,
  fromName,
  fromAddress,
  summary,
  day,
  read = false,
  category = "work",
  source = null,
  sourceAt = null,
  laneAtSnapshot = null,
  handledAt = null,
  escalationBadge = null,
  receivedHour = null,
  receivedMinute = null,
}: DemoSnapshotEmailInput) {
  const numericItemId = Number(itemId) || 0;
  const hour = receivedHour ?? (8 + (numericItemId % 10));
  const minute = receivedMinute ?? ((numericItemId * 7) % 60);
  return {
    id: itemId,
    snapshot_item_id: itemId,
    uid,
    email_id: uid,
    account_id: accountId,
    lane,
    category,
    subject,
    from_name: fromName,
    from_address: fromAddress,
    summary,
    action: lane === "needs_attention" ? "Review" : lane === "queued" ? "Classify" : "Read later",
    date: atLocalIso(day, hour, minute),
    read,
    urgency: lane === "needs_attention" ? "high" : "normal",
    source,
    source_at: sourceAt,
    lane_at_snapshot: laneAtSnapshot,
    handled_at: handledAt,
    escalation_badge: escalationBadge,
    _activeSnapshot: true,
  };
}

function makeLaneCounts(lanes: DemoLanes, carryover: DemoSnapshotEmail[]) {
  return {
    queued: lanes.queued.length,
    needs_attention: lanes.needs_attention.length,
    catch_up: lanes.catch_up.length,
    fyi: lanes.fyi.length,
    handled: lanes.handled.length,
    untriaged_read: lanes.untriaged_read.length,
    noise: lanes.noise.length,
    carryover: carryover.length,
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

function flattenSnapshotRows(lanes: DemoLanes, carryover: DemoSnapshotEmail[]): DemoSnapshotEmail[] {
  return [
    ...(carryover || []),
    ...Object.values(lanes || {}).flat(),
  ];
}

const DEMO_ACCOUNTS = {
  "demo-gmail": { account_id: "demo-gmail", label: "Demo Gmail", email: "alex@demo.example", color: WORK_COLOR, icon: "Mail" },
  "demo-icloud": { account_id: "demo-icloud", label: "Demo iCloud", email: "alex.personal@example", color: PERSONAL_COLOR, icon: "Mail" },
};

function makeSnapshotFilters(lanes: DemoLanes, carryover: DemoSnapshotEmail[]) {
  const rows = flattenSnapshotRows(lanes, carryover);
  const accountCounts = new Map();
  const categoryCounts = new Map();

  for (const row of rows) {
    accountCounts.set(row.account_id, (accountCounts.get(row.account_id) || 0) + 1);
    categoryCounts.set(row.category, (categoryCounts.get(row.category) || 0) + 1);
  }

  return {
    accounts: Object.values(DEMO_ACCOUNTS).map((account) => ({
      ...account,
      count: accountCounts.get(account.account_id) || 0,
    })),
    categories: [...categoryCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, count]) => ({ category, count })),
  };
}

function makeEmailBodies(lanes: DemoLanes, carryover: DemoSnapshotEmail[]) {
  return Object.fromEntries(flattenSnapshotRows(lanes, carryover).map((row) => [
    row.uid,
    {
      uid: row.uid,
      body: `This is a fictional demo email body for "${row.subject}". ${row.summary} The content is representative sample data only.`,
    },
  ]));
}

function makeDemoSeed(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const soon = addDays(today, 3);
  const later = addDays(today, 8);
  const fetchedAt = now.toISOString();

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

  const lanes = {
    queued: [
      snapshotEmail({
        itemId: 5,
        uid: "demo-email-queued-build",
        accountId: "demo-gmail",
        lane: "queued",
        subject: "CI build queued for demo-mode fixture branch",
        fromName: "GitHub Actions",
        fromAddress: "actions@github.example",
        summary: "A new workflow run is waiting for the demo fixture branch.",
        day: today,
        category: "engineering",
        source: "arrival_grace",
        receivedHour: 14,
        receivedMinute: 8,
      }),
      snapshotEmail({
        itemId: 6,
        uid: "demo-email-queued-security",
        accountId: "demo-gmail",
        lane: "queued",
        subject: "Security review queued: OAuth redirect copy",
        fromName: "Security Bot",
        fromAddress: "security@northstar.example",
        summary: "Security automation is classifying an OAuth redirect wording review.",
        day: today,
        category: "security",
        source: "arrival_grace",
        receivedHour: 14,
        receivedMinute: 22,
      }),
    ],
    needs_attention: [
      snapshotEmail({
        itemId: 1,
        uid: "demo-email-budget",
        accountId: "demo-gmail",
        lane: "needs_attention",
        subject: "Budget approval for the demo rollout",
        fromName: "Morgan Lee",
        fromAddress: "morgan@northstar.example",
        summary: "Morgan needs approval on the fictional demo rollout budget before noon.",
        day: today,
        category: "finance",
      }),
      snapshotEmail({
        itemId: 7,
        uid: "demo-email-prod-alert",
        accountId: "demo-gmail",
        lane: "needs_attention",
        subject: "Prod alert: Gmail watch renewal missed",
        fromName: "PagerDuty",
        fromAddress: "alerts@pagerduty.example",
        summary: "A Gmail watch renewal warning needs acknowledgement before the provider window closes.",
        day: today,
        category: "engineering",
        escalationBadge: "Prod",
        receivedHour: 8,
        receivedMinute: 42,
      }),
      snapshotEmail({
        itemId: 8,
        uid: "demo-email-pr-blocker",
        accountId: "demo-gmail",
        lane: "needs_attention",
        subject: "PR blocker: calendar source retry copy",
        fromName: "Riley Park",
        fromAddress: "riley@northstar.example",
        summary: "Riley left a blocking review on the stale calendar-source retry copy.",
        day: today,
        category: "engineering",
        receivedHour: 10,
        receivedMinute: 12,
      }),
      snapshotEmail({
        itemId: 9,
        uid: "demo-email-product-decision",
        accountId: "demo-gmail",
        lane: "needs_attention",
        subject: "Decision needed: hide provider edit on personal date markers",
        fromName: "Morgan Lee",
        fromAddress: "morgan@northstar.example",
        summary: "Morgan needs a final call on read-only personal date marker behavior.",
        day: today,
        category: "product",
        receivedHour: 11,
        receivedMinute: 4,
      }),
      snapshotEmail({
        itemId: 10,
        uid: "demo-email-recruiter",
        accountId: "demo-icloud",
        lane: "needs_attention",
        subject: "Follow-up: senior frontend/SWE screen",
        fromName: "Jamie Rivera",
        fromAddress: "jamie@talent.example",
        summary: "Jamie asked for availability and a concise dashboard architecture summary.",
        day: today,
        category: "career",
        receivedHour: 12,
        receivedMinute: 18,
      }),
    ],
    catch_up: [
      snapshotEmail({
        itemId: 11,
        uid: "demo-email-catchup-rfc",
        accountId: "demo-gmail",
        lane: "catch_up",
        subject: "Thread: snapshot lifecycle RFC notes",
        fromName: "Architecture Guild",
        fromAddress: "arch@northstar.example",
        summary: "The RFC thread has useful context but no immediate decision request.",
        day: yesterday,
        read: true,
        category: "engineering",
        source: "catch_up",
        laneAtSnapshot: "fyi",
      }),
      snapshotEmail({
        itemId: 12,
        uid: "demo-email-catchup-design",
        accountId: "demo-icloud",
        lane: "catch_up",
        subject: "Design archive: dense dashboard examples",
        fromName: "Avery Chen",
        fromAddress: "avery@studio.example",
        summary: "Avery shared reference screenshots for compact operational dashboards.",
        day: yesterday,
        read: true,
        category: "product",
        source: "catch_up",
        laneAtSnapshot: "fyi",
      }),
    ],
    fyi: [
      snapshotEmail({
        itemId: 2,
        uid: "demo-email-design",
        accountId: "demo-icloud",
        lane: "fyi",
        subject: "Design QA notes",
        fromName: "Avery Chen",
        fromAddress: "avery@studio.example",
        summary: "Avery sent polish notes for the portfolio walkthrough.",
        day: yesterday,
        read: true,
        category: "product",
      }),
      snapshotEmail({
        itemId: 13,
        uid: "demo-email-release-notes",
        accountId: "demo-gmail",
        lane: "fyi",
        subject: "Release notes: dashboard-current refresh patch",
        fromName: "Deploy Bot",
        fromAddress: "deploy@northstar.example",
        summary: "The release candidate includes the dashboard-current refresh patch and focused Vitest coverage.",
        day: today,
        read: true,
        category: "engineering",
      }),
      snapshotEmail({
        itemId: 14,
        uid: "demo-email-docs",
        accountId: "demo-gmail",
        lane: "fyi",
        subject: "Docs update: inbox workflow glossary",
        fromName: "Docs Bot",
        fromAddress: "docs@northstar.example",
        summary: "The inbox workflow glossary now reflects queued, catch-up, handled, and noise lanes.",
        day: yesterday,
        read: true,
        category: "documentation",
      }),
      snapshotEmail({
        itemId: 15,
        uid: "demo-email-calendar-coverage",
        accountId: "demo-gmail",
        lane: "fyi",
        subject: "Calendar sync coverage report",
        fromName: "Sync Monitor",
        fromAddress: "sync@northstar.example",
        summary: "Calendar range coverage is current across events, deadlines, and bill overlays.",
        day: today,
        category: "engineering",
      }),
      snapshotEmail({
        itemId: 16,
        uid: "demo-email-school-alumni",
        accountId: "demo-icloud",
        lane: "fyi",
        subject: "Alumni panel invite: SWE portfolio demos",
        fromName: "CS Alumni Office",
        fromAddress: "alumni@example.edu",
        summary: "A panel invite about turning personal systems into credible SWE portfolio stories.",
        day: yesterday,
        read: true,
        category: "career",
      }),
    ],
    handled: [
      snapshotEmail({
        itemId: 17,
        uid: "demo-email-handled-standup",
        accountId: "demo-gmail",
        lane: "handled",
        subject: "Handled: standup notes posted",
        fromName: "Casey Nguyen",
        fromAddress: "casey@northstar.example",
        summary: "Standup notes were posted and no longer need a response.",
        day: today,
        read: true,
        category: "engineering",
        handledAt: atLocalIso(today, 9, 58),
      }),
      snapshotEmail({
        itemId: 18,
        uid: "demo-email-handled-demo-link",
        accountId: "demo-icloud",
        lane: "handled",
        subject: "Handled: demo link received",
        fromName: "Portfolio Reviewer",
        fromAddress: "reviewer@portfolio.example",
        summary: "The reviewer confirmed the demo link works from a clean browser.",
        day: yesterday,
        read: true,
        category: "career",
        handledAt: atLocalIso(today, 10, 16),
      }),
    ],
    untriaged_read: [
      snapshotEmail({
        itemId: 19,
        uid: "demo-email-read-security",
        accountId: "demo-gmail",
        lane: "untriaged_read",
        subject: "Read during grace: dependency advisory",
        fromName: "Dependency Watch",
        fromAddress: "advisory@security.example",
        summary: "A dependency advisory was read before the snapshot finalized classification.",
        day: today,
        read: true,
        category: "security",
        source: "arrival_grace_read",
      }),
    ],
    noise: [
      snapshotEmail({
        itemId: 3,
        uid: "demo-email-newsletter",
        accountId: "demo-gmail",
        lane: "noise",
        subject: "Weekly SaaS digest",
        fromName: "Digest Bot",
        fromAddress: "digest@example.news",
        summary: "A low-priority newsletter routed away from the main workflow.",
        day: yesterday,
        read: true,
        category: "newsletter",
      }),
      snapshotEmail({
        itemId: 20,
        uid: "demo-email-vendor-webinar",
        accountId: "demo-gmail",
        lane: "noise",
        subject: "Webinar: ten dashboards your team needs",
        fromName: "Vendor Marketing",
        fromAddress: "events@vendor.example",
        summary: "A vendor webinar routed away from the active inbox.",
        day: yesterday,
        read: true,
        category: "marketing",
      }),
      snapshotEmail({
        itemId: 21,
        uid: "demo-email-promo",
        accountId: "demo-icloud",
        lane: "noise",
        subject: "Limited-time workspace template sale",
        fromName: "Template Store",
        fromAddress: "promo@templates.example",
        summary: "A promotional email classified as noise.",
        day: yesterday,
        read: true,
        category: "marketing",
      }),
      snapshotEmail({
        itemId: 22,
        uid: "demo-email-status-green",
        accountId: "demo-gmail",
        lane: "noise",
        subject: "Status page: all systems operational",
        fromName: "Status Bot",
        fromAddress: "status@northstar.example",
        summary: "Routine green status update with no required action.",
        day: today,
        read: true,
        category: "operations",
      }),
    ],
  };
  lanes.needs_attention[2]!.urgency = "normal";
  lanes.needs_attention[3]!.urgency = "normal";
  const carryover = [
    snapshotEmail({
      itemId: 4,
      uid: "demo-email-carryover",
      accountId: "demo-gmail",
      lane: "needs_attention",
      subject: "Carryover: contract language",
      fromName: "Jordan Patel",
      fromAddress: "jordan@counsel.example",
      summary: "A carried-over review item from yesterday.",
      day: yesterday,
      category: "legal",
    }),
    snapshotEmail({
      itemId: 23,
      uid: "demo-email-carryover-runbook",
      accountId: "demo-gmail",
      lane: "needs_attention",
      subject: "Carryover: approve retry runbook diff",
      fromName: "Nina Torres",
      fromAddress: "nina@northstar.example",
      summary: "Nina is waiting on a final approval for the retry runbook update.",
      day: yesterday,
      category: "engineering",
    }),
  ];

  const activeSnapshot = {
    snapshot: {
      id: `demo-snapshot-${dateKey(today)}`,
      date: dateKey(today),
      generated_at: fetchedAt,
    },
    filters: makeSnapshotFilters(lanes, carryover),
    lanes,
    carryover,
    laneCounts: makeLaneCounts(lanes, carryover),
    processing: {
      queued: 0,
      running: 0,
      total: 0,
      active: false,
      email_triage_mode: "auto",
      effective_email_triage_mode: "auto",
    },
    readOnly: false,
  };

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
      activeSnapshot,
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
    activeSnapshot,
    settings,
    accounts: {
      accounts: [
        { id: "demo-gmail", type: "gmail", email: "alex@demo.example", label: "Demo Gmail", color: WORK_COLOR, icon: "Mail" },
        { id: "demo-icloud", type: "icloud", email: "alex.personal@example", label: "Demo iCloud", color: PERSONAL_COLOR, icon: "Mail" },
      ],
    },
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
    importantSenders: [
      { address: "morgan@northstar.example", name: "Morgan Lee", source: "auto" },
      { address: "alerts@pagerduty.example", name: "PagerDuty", source: "auto" },
      { address: "riley@northstar.example", name: "Riley Park", source: "auto" },
      { address: "jamie@talent.example", name: "Jamie Rivera", source: "manual" },
    ],
    emailBodies: makeEmailBodies(lanes, carryover),
    snoozedEmails: {} as Record<string, { row: DemoSnapshotEmail; lane: DemoLaneKey | "carryover" | null }>,
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
