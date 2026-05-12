const DAY_MS = 24 * 60 * 60 * 1000;

let cachedSeed = null;
let cachedDateKey = null;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function atLocalIso(baseDate, hour, minute = 0) {
  const value = new Date(baseDate);
  value.setHours(hour, minute, 0, 0);
  return value.toISOString();
}

function event({
  id,
  title,
  day,
  startHour,
  endHour,
  calendarId = "demo-work",
  calendarName = "Demo Work",
  sourceColor = "#89b4fa",
}) {
  const start = atLocalIso(day, startHour);
  const end = atLocalIso(day, endHour);
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
    location: "",
    description: "Fictional demo calendar event.",
  };
}

function task({ id, title, day, source = "todoist", status = "open", points = null }) {
  return {
    id,
    todoist_id: source === "todoist" ? id : null,
    title,
    due_date: dateKey(day),
    status,
    source,
    points_possible: points,
    course_name: source === "ctm" ? "Portfolio Systems" : null,
  };
}

function bill({ id, payee, day, amount, paid = false }) {
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
}) {
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
    action: lane === "needs_attention" ? "Review" : "Read later",
    date: atLocalIso(day, 9 + itemId, 15),
    read,
    urgency: lane === "needs_attention" ? "high" : "normal",
    _activeSnapshot: true,
  };
}

function makeLaneCounts(lanes, carryover) {
  return {
    queued: lanes.queued.length,
    needs_attention: lanes.needs_attention.length,
    fyi: lanes.fyi.length,
    handled: lanes.handled.length,
    untriaged_read: lanes.untriaged_read.length,
    noise: lanes.noise.length,
    carryover: carryover.length,
  };
}

function filterDateRange(items, start, end, getDate) {
  return items.filter((item) => {
    const key = getDate(item);
    return key >= start && key <= end;
  });
}

function makeDemoSeed(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const soon = addDays(today, 3);
  const later = addDays(today, 8);
  const fetchedAt = now.toISOString();

  const calendarEvents = [
    event({ id: "demo-event-review", title: "Portfolio review prep", day: today, startHour: 10, endHour: 11 }),
    event({ id: "demo-event-sync", title: "Product sync with Morgan", day: today, startHour: 13, endHour: 14 }),
    event({ id: "demo-event-bills", title: "Budget review block", day: tomorrow, startHour: 16, endHour: 17, sourceColor: "#a6e3a1" }),
  ];

  const deadlines = {
    ctm: {
      upcoming: [
        task({ id: "demo-ctm-brief", title: "Finalize dashboard walkthrough notes", day: tomorrow, source: "ctm", points: 20 }),
        task({ id: "demo-ctm-recording", title: "Record two-minute product tour", day: later, source: "ctm", points: 10 }),
      ],
      stats: { incomplete: 2, dueToday: 0, dueThisWeek: 1, totalPoints: 30 },
    },
    todoist: {
      upcoming: [
        task({ id: "demo-task-link", title: "Send portfolio demo link", day: today }),
        task({ id: "demo-task-budget", title: "Review mock bill-pay copy", day: soon }),
      ],
      stats: { incomplete: 2, dueToday: 1, dueThisWeek: 2, totalPoints: 0 },
    },
  };

  const bills = [
    bill({ id: "demo-electric", payee: "Demo Electric", day: soon, amount: 146.32 }),
    bill({ id: "demo-water", payee: "Northstar Water", day: later, amount: 58.11 }),
    bill({ id: "demo-internet", payee: "Fiber Co-op", day: yesterday, amount: 79.99, paid: true }),
  ];

  const lanes = {
    queued: [],
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
    ],
    catch_up: [],
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
    ],
    handled: [],
    untriaged_read: [],
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
    ],
  };
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
  ];

  const activeSnapshot = {
    snapshot: {
      id: `demo-snapshot-${dateKey(today)}`,
      date: dateKey(today),
      generated_at: fetchedAt,
    },
    filters: {
      accounts: [
        { account_id: "demo-gmail", label: "Demo Gmail", email: "alex@demo.example", color: "#89b4fa", icon: "Mail", count: 3 },
        { account_id: "demo-icloud", label: "Demo iCloud", email: "alex.personal@example", color: "#cba6f7", icon: "Mail", count: 1 },
      ],
      categories: [
        { category: "finance", count: 1 },
        { category: "legal", count: 1 },
        { category: "newsletter", count: 1 },
        { category: "product", count: 1 },
      ],
    },
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
      weather: { temp: 72, icon: "Sun", description: "Clear demo skies" },
      calendar: calendarEvents,
      deadlines,
      bills,
      allSchedules: bills,
      payeeMap: {
        "demo-electric": "Demo Electric",
        "demo-water": "Northstar Water",
        "demo-internet": "Fiber Co-op",
      },
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
    activeSnapshot,
    settings,
    accounts: {
      accounts: [
        { id: "demo-gmail", type: "gmail", email: "alex@demo.example", label: "Demo Gmail", color: "#89b4fa", icon: "Mail" },
        { id: "demo-icloud", type: "icloud", email: "alex.personal@example", label: "Demo iCloud", color: "#cba6f7", icon: "Mail" },
      ],
    },
    actualMetadata: {
      accounts: [{ id: "demo-checking", name: "Demo Checking", offbudget: false, closed: false }],
      payees: [{ id: "demo-electric", name: "Demo Electric" }],
      categories: [{ group_name: "Demo Bills", categories: [{ id: "demo-utilities", name: "Utilities" }] }],
    },
    notes: [
      { id: "demo-note-1", content: "Demo walkthrough: dashboard, inbox, calendar, bills, then settings.", sort_order: 1, created_at: fetchedAt, updated_at: fetchedAt },
      { id: "demo-note-2", content: "All names, accounts, and providers are fictional.", sort_order: 2, created_at: fetchedAt, updated_at: fetchedAt },
    ],
    importantSenders: [
      { address: "morgan@northstar.example", name: "Morgan Lee", source: "auto" },
    ],
    emailBodies: {
      "demo-email-budget": {
        uid: "demo-email-budget",
        body: "This is a fictional demo email body for the static portfolio demo. Please approve the mock budget so the walkthrough can continue.",
      },
      "demo-email-design": {
        uid: "demo-email-design",
        body: "Fictional demo design notes: tighten the hero card, review hover states, and keep the dashboard data believable.",
      },
      "demo-email-newsletter": {
        uid: "demo-email-newsletter",
        body: "Fictional demo newsletter content.",
      },
      "demo-email-carryover": {
        uid: "demo-email-carryover",
        body: "Fictional carryover message for contract review.",
      },
    },
  };
}

export function getDemoSeed() {
  const now = new Date();
  const key = dateKey(now);
  if (!cachedSeed || cachedDateKey !== key) {
    cachedSeed = makeDemoSeed(now);
    cachedDateKey = key;
  }
  return cachedSeed;
}

export function readDemoSeed() {
  return clone(getDemoSeed());
}

export function demoDateRange(items, start, end, getDate) {
  return clone(filterDateRange(items, start, end, getDate));
}
