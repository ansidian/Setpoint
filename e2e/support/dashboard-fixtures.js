function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function todayParts() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
    ymd: [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-"),
  };
}

function formatYmd(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function buildBriefing({ events = [], emailAccounts = [], briefing = {} } = {}) {
  const nowIso = new Date().toISOString();
  const unreadCount = emailAccounts.reduce(
    (count, account) => count + (account.unread || 0),
    0,
  );
  const baseBriefing = {
    generatedAt: "9:00 AM · Wednesday, April 22, 2026",
    dataUpdatedAt: nowIso,
    aiGeneratedAt: nowIso,
    skippedAI: false,
    nonAiGenerationCount: 0,
    weather: {
      temp: 68,
      high: 72,
      low: 56,
      summary: "Clear and mild.",
      hourly: [],
      location: "Los Angeles, CA",
    },
    aiInsights: [
      { icon: "Calendar", text: "Calendar fixtures are active for Playwright evaluation." },
    ],
    calendar: events,
    ctm: {
      upcoming: [],
      stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    },
    todoist: {
      upcoming: [],
      stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    },
    emails: {
      summary: unreadCount ? `${unreadCount} emails.` : "0 emails.",
      accounts: emailAccounts,
    },
  };

  return {
    ...baseBriefing,
    ...briefing,
    weather: {
      ...baseBriefing.weather,
      ...(briefing.weather || {}),
    },
    ctm: {
      ...baseBriefing.ctm,
      ...(briefing.ctm || {}),
    },
    todoist: {
      ...baseBriefing.todoist,
      ...(briefing.todoist || {}),
    },
    emails: {
      ...baseBriefing.emails,
      ...(briefing.emails || {}),
      accounts: briefing.emails?.accounts || emailAccounts,
    },
  };
}

function defaultSettings() {
  return {
    claude_model: "claude-haiku-4-5-20251001",
    schedules: [],
    render_configured: false,
  };
}

function defaultLiveData(overrides = {}) {
  return {
    emails: [],
    calendar: null,
    nextWeekCalendar: null,
    tomorrowCalendar: null,
    weather: null,
    bills: [],
    recentTransactions: [],
    allSchedules: [],
    payeeMap: {},
    importantSenders: [],
    briefingGeneratedAt: null,
    briefingReadStatus: {},
    fetchedAt: new Date().toISOString(),
    actualConfigured: false,
    actualBudgetUrl: null,
    pinnedIds: [],
    pinnedSnapshots: [],
    snoozedEntries: [],
    resurfacedEntries: [],
    ...overrides,
  };
}

function buildCalendarSourcesFixture() {
  return {
    accounts: [
      {
        accountId: "gmail-main",
        accountLabel: "Google",
        accountEmail: "me@example.com",
        calendars: [
          {
            id: "primary",
            summary: "Personal",
            accessRole: "owner",
            primary: true,
            writable: true,
            backgroundColor: "#4285f4",
          },
        ],
      },
    ],
  };
}

function buildEventMs(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`).getTime();
}

function buildEventFromPayload({
  id,
  etag,
  payload,
  existingEvent = null,
}) {
  const event = existingEvent || {};
  const allDay = payload.allDay ?? event.allDay ?? false;
  const startDate = payload.startDate || event.startDate;
  const endDate = payload.endDate || payload.startDate || event.endDate || startDate;
  let startMs = event.startMs;
  let endMs = event.endMs;

  if (startDate) {
    if (allDay) {
      const endExclusive = new Date(`${endDate}T00:00:00`);
      endExclusive.setDate(endExclusive.getDate() + 1);
      startMs = new Date(`${startDate}T00:00:00`).getTime();
      endMs = endExclusive.getTime();
    } else {
      startMs = buildEventMs(startDate, payload.startTime || "09:00");
      endMs = buildEventMs(endDate, payload.endTime || "09:30");
    }
  }

  return {
    ...event,
    id,
    etag,
    title: payload.title ?? event.title ?? "",
    accountId: payload.accountId || event.accountId || "gmail-main",
    calendarId: payload.calendarId || event.calendarId || "primary",
    startMs,
    endMs,
    writable: payload.writable ?? event.writable ?? true,
    isRecurring: payload.isRecurring ?? event.isRecurring ?? !!(payload.recurrence || event.recurrence),
    allDay,
    htmlLink: event.htmlLink || "https://calendar.google.com/calendar/u/0/r",
    location: payload.location ?? event.location ?? "",
    description: payload.description ?? event.description ?? "",
    recurringEventId: payload.recurringEventId ?? event.recurringEventId,
    originalStartTime: payload.originalStartTime ?? event.originalStartTime,
    recurrence: payload.recurrence ?? event.recurrence,
    color: event.color || "#4285f4",
  };
}

function buildInboxFixtureAccounts() {
  return [
    {
      id: "acc-work",
      name: "Work",
      email: "work@example.com",
      color: "#89dceb",
      unread: 2,
      important: [
        {
          id: "email-action",
          uid: "email-action",
          subject: "Project budget sign-off",
          from: "Dana",
          fromEmail: "dana@example.com",
          date: "2026-04-19T15:30:00.000Z",
          preview: "Need your approval on the revised budget today.",
          fullBody: "Please approve the revised budget.",
          read: false,
          urgency: "high",
          claude: {
            summary: "Requires a fast approval decision.",
            draftReply: "Approved. Please proceed.",
          },
          hasBill: true,
          extractedBill: {
            payee: "Vendor",
            amount: 125,
            due_date: "2026-04-20",
            type: "expense",
          },
        },
      ],
      noise: [],
    },
    {
      id: "acc-personal",
      name: "Personal",
      email: "personal@example.com",
      color: "#cba6da",
      unread: 1,
      important: [
        {
          id: "email-fyi",
          uid: "email-fyi",
          subject: "Budget dinner plans",
          from: "Chris",
          fromEmail: "chris@example.com",
          date: "2026-04-19T14:00:00.000Z",
          preview: "Checking whether Sunday still works.",
          fullBody: "Sunday dinner still works for me.",
          read: false,
        },
      ],
      noise: [
        {
          id: "email-noise",
          uid: "email-noise",
          subject: "Weekly sale roundup",
          from: "Store",
          fromEmail: "store@example.com",
          date: "2026-04-18T13:00:00.000Z",
          preview: "Discounts you can ignore.",
          fullBody: "This is a marketing email.",
          read: true,
          noise: true,
        },
      ],
    },
  ];
}

function buildInboxFixtureLiveEmails() {
  return [
    {
      uid: "live-1",
      subject: "Fresh live ping",
      from: "Morgan",
      from_email: "morgan@example.com",
      account_label: "Work",
      account_email: "work@example.com",
      account_color: "#89dceb",
      date: "2026-04-19T16:15:00.000Z",
      preview: "Just arrived after the briefing.",
      body_preview: "Just arrived after the briefing.",
      read: false,
    },
  ];
}

async function installBaseDashboardFixtures(page, {
  initialEvents = [],
  emailAccounts = [],
  briefing = {},
  settings = {},
  liveData = {},
} = {}) {
  let events = initialEvents;

  await page.route("**/api/ea/settings", async (route) =>
    json(route, { ...defaultSettings(), ...settings }),
  );

  await page.route("**/api/briefing/in-progress", async (route) =>
    json(route, { generating: false }),
  );

  await page.route("**/api/live/all", async (route) =>
    json(route, defaultLiveData(liveData)),
  );

  await page.route("**/api/calendar/deadlines", async (route) => {
    const latest = buildBriefing({ events, emailAccounts, briefing });
    return json(route, {
      ctm: latest.ctm,
      todoist: latest.todoist,
    });
  });

  await page.route("**/api/briefing/latest**", async (route) =>
    json(route, { id: 9001, briefing: buildBriefing({ events, emailAccounts, briefing }) }),
  );

  await page.route("**/api/briefing/refresh", async (route) =>
    json(route, { id: 9002, briefingJson: buildBriefing({ events, emailAccounts, briefing }) }),
  );

  await page.route("**/api/calendar/range**", async (route) => {
    const url = new URL(route.request().url());
    const start = new Date(`${url.searchParams.get("start")}T00:00:00`).getTime();
    const end = new Date(`${url.searchParams.get("end")}T23:59:59.999`).getTime();
    const inRange = events.filter((event) => event.startMs >= start && event.startMs <= end);
    return json(route, { events: inRange });
  });

  return {
    setEvents(nextEvents) {
      events = nextEvents;
    },
  };
}

async function installCalendarCrudFixtures(page, base, initialEvents) {
  let events = initialEvents;
  let nextCreatedEventId = 1;

  await page.route("**/api/calendar/calendars", async (route) =>
    json(route, buildCalendarSourcesFixture()),
  );

  await page.route("**/api/calendar/events", async (route) => {
    if (route.request().method() !== "POST") {
      return route.fallback();
    }

    const payload = route.request().postDataJSON();
    const createdEvent = buildEventFromPayload({
      id: `fixture-created-${nextCreatedEventId}`,
      etag: `"fixture-created-etag-${nextCreatedEventId}"`,
      payload,
    });
    nextCreatedEventId += 1;
    events = [...events, createdEvent];
    base.setEvents(events);
    return json(route, { event: createdEvent });
  });

  await page.route("**/api/calendar/events/*", async (route) => {
    const url = new URL(route.request().url());
    const eventId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const eventIndex = events.findIndex((event) => event.id === eventId);

    if (route.request().method() === "PATCH") {
      if (eventIndex < 0) {
        return json(route, { message: "Not found" }, 404);
      }

      const payload = route.request().postDataJSON();
      const updatedEvent = buildEventFromPayload({
        id: events[eventIndex].id,
        etag: `"${eventId}-etag-${Date.now()}"`,
        payload,
        existingEvent: events[eventIndex],
      });
      events = events.map((event, index) => (index === eventIndex ? updatedEvent : event));
      base.setEvents(events);
      return json(route, { event: updatedEvent });
    }

    if (route.request().method() === "DELETE") {
      if (eventIndex < 0) {
        return json(route, { ok: true });
      }

      events = events.filter((event) => event.id !== eventId);
      base.setEvents(events);
      return json(route, { ok: true });
    }

    return route.fallback();
  });
}

export async function installDashboardShellFixtures(page, options = {}) {
  await installBaseDashboardFixtures(page, options);
}

export async function installDashboardCalendarLayoutFixtures(page) {
  const today = todayParts();
  const eventDate = new Date(today.year, today.month, today.day + 1);
  const deadlineDate = new Date(today.year, today.month, today.day + 2);
  const eventStart = new Date(
    eventDate.getFullYear(),
    eventDate.getMonth(),
    eventDate.getDate(),
    11,
    0,
    0,
    0,
  ).getTime();
  const eventEnd = new Date(
    eventDate.getFullYear(),
    eventDate.getMonth(),
    eventDate.getDate(),
    12,
    0,
    0,
    0,
  ).getTime();
  const eventDay = eventDate.getDate();
  const eventTitle = "Design review";
  const deadlineTitle = "Ship planning memo";

  await installBaseDashboardFixtures(page, {
    initialEvents: [
      {
        id: "layout-event-1",
        etag: '"layout-etag-1"',
        title: eventTitle,
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: eventStart,
        endMs: eventEnd,
        writable: true,
        isRecurring: false,
        allDay: false,
        htmlLink: "https://calendar.google.com/calendar/u/0/r",
        color: "#4285f4",
      },
    ],
    briefing: {
      todoist: {
        upcoming: [
          {
            id: "layout-deadline-1",
            title: deadlineTitle,
            due_date: formatYmd(deadlineDate),
            due_time: "5:00 PM",
            source: "todoist",
            class_name: "Inbox",
            status: "open",
            url: "https://todoist.com/showTask?id=layout-deadline-1",
          },
        ],
        stats: { incomplete: 1, dueToday: 0, dueThisWeek: 1, totalPoints: 0 },
      },
    },
  });

  return {
    todayDay: today.day,
    eventDay,
    eventTitle,
    deadlineDay: deadlineDate.getDate(),
    deadlineTitle,
  };
}

export async function installDashboardCalendarFixtures(page) {
  const today = todayParts();
  const initialTitle = "Design review";
  const updatedTitle = "Design review follow-up";
  const eventStart = new Date(today.year, today.month, today.day, 14, 0, 0, 0).getTime();
  const eventEnd = new Date(today.year, today.month, today.day, 14, 30, 0, 0).getTime();

  let events = [
    {
      id: "fixture-event-1",
      etag: '"fixture-etag-1"',
      title: initialTitle,
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: eventStart,
      endMs: eventEnd,
      writable: true,
      isRecurring: false,
      allDay: false,
      htmlLink: "https://calendar.google.com/calendar/u/0/r",
      location: "Studio",
      color: "#4285f4",
    },
  ];

  const base = await installBaseDashboardFixtures(page, { initialEvents: events });
  await installCalendarCrudFixtures(page, base, events);

  return {
    initialTitle,
    updatedTitle,
    day: today.day,
  };
}

export async function installDashboardCalendarCreateFixtures(page) {
  const today = todayParts();
  const base = await installBaseDashboardFixtures(page, { initialEvents: [] });
  await installCalendarCrudFixtures(page, base, []);

  return {
    createdTitle: "Planning block",
    day: today.day,
    ymd: today.ymd,
  };
}

export async function installDashboardRecurringCalendarFixtures(page) {
  const today = todayParts();
  const recurringTitle = "Weekly sync";
  const updatedTitle = "Team sync updated";
  const startMs = new Date(today.year, today.month, today.day, 16, 0, 0, 0).getTime();
  const endMs = new Date(today.year, today.month, today.day, 16, 30, 0, 0).getTime();
  const originalStartTime = `${today.ymd}T16:00:00-07:00`;
  const initialEvents = [
    {
      id: "recurring-1",
      etag: '"recurring-etag-1"',
      title: recurringTitle,
      accountId: "gmail-main",
      calendarId: "primary",
      recurringEventId: "series-1",
      originalStartTime,
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["WE"],
        ends: { type: "never" },
      },
      startMs,
      endMs,
      writable: true,
      isRecurring: true,
      allDay: false,
      htmlLink: "https://calendar.google.com/calendar/u/0/r",
      color: "#4285f4",
    },
  ];

  const base = await installBaseDashboardFixtures(page, { initialEvents });
  await installCalendarCrudFixtures(page, base, initialEvents);

  return {
    recurringTitle,
    updatedTitle,
    day: today.day,
    originalStartTime,
  };
}

export async function installDashboardInboxFixtures(page) {
  const emailAccounts = buildInboxFixtureAccounts();
  const liveEmails = buildInboxFixtureLiveEmails();

  await installBaseDashboardFixtures(page, {
    emailAccounts,
    liveData: { emails: liveEmails },
  });

  await page.route("**/api/briefing/email/mark-all-read", async (route) =>
    json(route, { ok: true }),
  );

  await page.route("**/api/briefing/email/*/mark-read", async (route) =>
    json(route, { ok: true }),
  );

  await page.route("**/api/briefing/email/*/mark-unread", async (route) =>
    json(route, { ok: true }),
  );

  await page.route("**/api/briefing/email/*/trash", async (route) =>
    json(route, { ok: true }),
  );

  await page.route("**/api/briefing/email/*/snooze", async (route) =>
    json(route, { ok: true }),
  );

  await page.route("**/api/briefing/dismiss/*", async (route) =>
    json(route, { ok: true }),
  );

  await page.route("**/api/briefing/pin/*", async (route) =>
    json(route, { ok: true }),
  );

  await page.route("**/api/briefing/actual/metadata", async (route) =>
    json(route, {
      accounts: [
        { id: "acct-checking", name: "Checking" },
        { id: "acct-credit", name: "Credit Card" },
      ],
      payees: [{ id: "payee-vendor", name: "Vendor" }],
      categories: [
        {
          group_name: "Bills",
          categories: [{ id: "cat-bills", name: "Bills" }],
        },
      ],
    }),
  );

  await page.route("**/api/briefing/email/*", async (route) => {
    if (route.request().method() !== "GET") {
      return route.fallback();
    }

    const url = new URL(route.request().url());
    const uid = decodeURIComponent(url.pathname.split("/").pop() || "");
    const liveEmail = liveEmails.find((email) => email.uid === uid);
    return json(route, {
      body: liveEmail?.body_preview || "Loaded email body",
    });
  });

  return {
    actionSubject: "Project budget sign-off",
    personalSubject: "Budget dinner plans",
    liveSubject: "Fresh live ping",
  };
}
