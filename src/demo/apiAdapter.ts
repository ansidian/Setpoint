import { createDemoApiError } from "./config.ts";
import {
  NO_DEMO_API_RESPONSE,
  demoNotFound as notFound,
  demoPathSegment as pathSegment,
  type DemoApiRequest,
  type DemoRequestBody,
} from "./apiHandler.ts";
import { demoDateRange } from "./dateRange.ts";
import { buildDemoCalendarBillsRange } from "./financeData.ts";
import { handleDemoNewsRequest } from "./newsAdapter.ts";
import { handleDemoNotesRequest } from "./notesAdapter.ts";
import { getDemoReferenceResponse, NO_DEMO_REFERENCE_RESPONSE } from "./referenceAdapter.ts";
import { handleDemoSnapshotRequest } from "./snapshotAdapter.ts";
import { forkDemoSeedForMutation, getDemoSeed, pacificYMD, readDemoSeed } from "./store.ts";
import { getDemoCapabilityStatus, getDemoInstanceCredentialMetadata } from "./capabilities.ts";
import { handleDemoTransactionImportRequest, NO_DEMO_TRANSACTION_IMPORT_RESPONSE } from "./transactionImports.ts";
import type { DemoSeed } from "./store.ts";
type DemoTask = DemoSeed["deadlines"]["upcoming"][number];
type DemoCalendarEvent = DemoSeed["calendarEvents"][number];
const clone = <T>(value: T): T => value == null ? value : structuredClone(value);

function route(path: string): URL {
  return new URL(path, "http://setpoint-demo.local");
}

function unsupported(path: string): never {
  throw createDemoApiError(path);
}

function parseBody(options: RequestInit = {}): DemoRequestBody {
  if (!options.body) return {};
  if (typeof options.body === "string") {
    try {
      return JSON.parse(options.body) as DemoRequestBody;
    } catch {
      return {};
    }
  }
  return options.body as unknown as DemoRequestBody;
}

function mutateTask(seed: DemoSeed, taskId: string, updater: (task: DemoTask) => void): void {
  for (const task of seed.deadlines.upcoming || []) {
    if (String(task.id || task.todoist_id) === String(taskId)) updater(task);
  }
}

const DEMO_CALENDARS: Record<string, { name: string; color: string }> = {
  "demo-work": { name: "Demo Work", color: "#89b4fa" },
  "demo-personal": { name: "Demo Personal", color: "#cba6f7" },
  "demo-career": { name: "Demo Career", color: "#f5c2e7" },
};

function ymdTimeToIso(date: string | undefined, time: string | undefined, fallbackTime: string): string | null {
  if (!date) return null;
  const clock = (time || fallbackTime || "00:00").slice(0, 5);
  // Build a local-zone ISO so batch drafts (which carry startDate/startTime
  // rather than a full ISO) land on a real timestamp, consistent with how the
  // seed builds events via atLocalIso.
  const parsed = new Date(`${date}T${clock}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function makeCalendarEvent(data: DemoRequestBody | DemoCalendarEvent, id = `demo-event-${Date.now()}`): DemoCalendarEvent {
  const input = data as DemoRequestBody & Partial<DemoCalendarEvent>;
  const start = input.start || input.startIso || input.startDateTime
    || ymdTimeToIso(input.startDate, input.startTime, "00:00")
    || new Date().toISOString();
  const end = input.end || input.endIso || input.endDateTime
    || ymdTimeToIso(input.endDate || input.startDate, input.endTime, input.startTime || "00:30")
    || new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString();
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  // Resolve the calendar's name/color FROM its id so the calendarId/calendarName/
  // color triple stays mutually consistent — editing a Personal/Career event no
  // longer silently recolors it to Demo Work blue.
  const calendarId = input.calendarId || "demo-work";
  const calendar = (DEMO_CALENDARS[calendarId] || DEMO_CALENDARS["demo-work"])!;
  return {
    id,
    title: input.title || "Untitled demo event",
    calendarId,
    calendarName: calendar.name,
    accountId: "demo-gmail",
    accountLabel: "Demo Gmail",
    source: calendar.name,
    sourceLabel: calendar.name,
    sourceColor: calendar.color,
    color: calendar.color,
    start,
    end,
    startMs,
    endMs,
    allDay: !!input.allDay,
    location: input.location || "",
    description: input.description || "Fictional demo calendar event.",
  };
}

function filterDeadlines(deadlines: DemoSeed["deadlines"], start: string, end: string) {
  return {
    ...clone(deadlines),
    upcoming: demoDateRange(deadlines.upcoming, start, end, (item) => item.due_date),
  };
}

function calendarCoverage(scope: string, start: string, end: string) {
  return {
    sources: [
      {
        key: scope === "bills" ? "bills" : "google_calendar",
        label: scope === "bills" ? "Demo Bills" : "Demo Calendar",
        searched: true,
        start,
        end,
        strategy: "demo_seed",
        syncHealth: { state: "current", message: "Generated locally for demo mode." },
      },
      ...(scope === "events" ? [{
        key: "deadlines",
        label: "Deadline overlays",
        searched: true,
        start,
        end,
        strategy: "demo_seed",
      }] : []),
    ],
  };
}

function searchCalendar({ scope, q, limit }: { scope: string; q: string; limit: string | number | null }) {
  const seed = getDemoSeed();
  const query = String(q || "").trim().toLowerCase();
  const cappedLimit = Number(limit || 50);
  const start = seed.dateKey;
  const end = seed.dateKey;

  const eventResults = seed.calendarEvents
    .filter((event) => !query || event.title.toLowerCase().includes(query))
    .map((event) => ({
      id: `event:${event.id}`,
      type: "event",
      itemId: event.id,
      itemDate: event.start.slice(0, 10),
      title: event.title,
      sourceLabel: event.sourceLabel,
      sourceColor: event.sourceColor,
      matchReason: "title",
      rankBucket: 1,
      activation: {
        view: "events",
        detailView: "events",
        dateKey: event.start.slice(0, 10),
        itemId: event.id,
        accountId: event.accountId,
        calendarId: event.calendarId,
      },
      payload: clone(event),
    }));

  const deadlineResults = (seed.deadlines.upcoming || [])
    .filter((item) => !query || item.title.toLowerCase().includes(query))
    .map((item) => ({
      id: `deadline:${item.id}:${item.due_date || "undated"}`,
      type: "deadline",
      itemId: `deadline:${item.id}:${item.due_date || "undated"}`,
      itemDate: item.due_date,
      title: item.title,
      sourceLabel: "Deadline",
      matchReason: "title",
      rankBucket: 2,
      activation: {
        view: "events",
        detailKind: "deadline",
        dateKey: item.due_date,
        itemId: `deadline:${item.id}:${item.due_date || "undated"}`,
        deadlineId: item.id,
      },
      payload: clone(item),
    }));

  const billResults = seed.bills
    .filter((bill) => !query || bill.payee.toLowerCase().includes(query) || bill.name.toLowerCase().includes(query))
    .map((bill) => ({
      id: `bill:${bill.id}`,
      type: "bill",
      itemId: bill.id,
      itemDate: bill.next_date,
      title: bill.payee,
      sourceLabel: "Bills",
      matchReason: "title",
      rankBucket: 1,
      payload: clone(bill),
    }));

  const all = scope === "bills" ? billResults : [...eventResults, ...deadlineResults];
  const results = all.slice(0, cappedLimit);
  return {
    query: q || "",
    scope,
    results,
    coverage: calendarCoverage(scope, start, end),
    // Truncation must reflect whether results were actually dropped, so compare
    // the pre-slice count against the cap. Comparing the post-slice length with
    // `>=` falsely flagged truncation when results landed exactly on the limit.
    truncated: all.length > cappedLimit,
  };
}

export async function handleDemoApiRequest(path: string, options: RequestInit = {}): Promise<unknown> {
  const url = route(path);
  const pathname = url.pathname;
  const method = String(options.method || "GET").toUpperCase();
  const readOnlyPost = pathname === "/api/dashboard/current/refresh" || pathname === "/api/dashboard/current/sync";
  const seed = method === "GET" || readOnlyPost ? getDemoSeed() : forkDemoSeedForMutation();
  const body = parseBody(options);

  const referenceResponse = getDemoReferenceResponse({ pathname, method, seed });
  if (referenceResponse !== NO_DEMO_REFERENCE_RESPONSE) return referenceResponse;
  const transactionImportResponse = handleDemoTransactionImportRequest({ pathname, method, url, body });
  if (transactionImportResponse !== NO_DEMO_TRANSACTION_IMPORT_RESPONSE) return transactionImportResponse;
  const request: DemoApiRequest = { path, url, pathname, method, seed, body };
  const snapshotResponse = handleDemoSnapshotRequest(request);
  if (snapshotResponse !== NO_DEMO_API_RESPONSE) return snapshotResponse;
  const notesResponse = handleDemoNotesRequest(request);
  if (notesResponse !== NO_DEMO_API_RESPONSE) return notesResponse;
  const newsResponse = handleDemoNewsRequest(request);
  if (newsResponse !== NO_DEMO_API_RESPONSE) return newsResponse;

  if (pathname.startsWith("/api/briefing/complete-task/") && method === "POST") {
    mutateTask(seed, decodeURIComponent(pathSegment(pathname, 1)), (task) => { task.status = "complete"; });
    return { ok: true };
  }

  if (pathname === "/api/briefing/todoist/tasks" && method === "POST") {
    const id = `demo-task-${Date.now()}`;
    const dueDate = body.due_date || body.dueDate || seed.dateKey;
    const template = seed.deadlines.upcoming[0]!;
    const task = {
      ...clone(template), id,
      todoist_id: id,
      title: body.title || body.content || "Demo task",
      due_date: dueDate,
      status: "open",
      source: "todoist",
    };
    seed.deadlines.upcoming.unshift(task);
    return clone(task);
  }

  if (pathname.match(/^\/api\/briefing\/todoist\/tasks\/[^/]+$/) && method === "POST") {
    const taskId = decodeURIComponent(pathSegment(pathname, 1));
    mutateTask(seed, taskId, (task) => {
      Object.assign(task, body, { id: task.id, todoist_id: task.todoist_id });
    });
    return clone(seed.deadlines.upcoming.find((task) => String(task.id) === String(taskId)) || { ok: true });
  }

  if (pathname.match(/^\/api\/briefing\/todoist\/tasks\/[^/]+$/) && method === "DELETE") {
    const taskId = decodeURIComponent(pathSegment(pathname, 1));
    seed.deadlines.upcoming = seed.deadlines.upcoming.filter((task) => String(task.id) !== String(taskId));
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/actual\/bills\/[^/]+\/mark-paid$/) && method === "POST") {
    const billId = decodeURIComponent(pathSegment(pathname, 2));
    for (const bill of seed.bills) {
      if (String(bill.id) === String(billId) || String(bill.scheduleId) === String(billId)) bill.paid = true;
    }
    return { ok: true };
  }

  if (pathname === "/api/calendar/events" && method === "POST") {
    const created = makeCalendarEvent(body);
    seed.calendarEvents.push(created);
    return { event: clone(created) };
  }

  if (pathname === "/api/calendar/events/batch" && method === "POST") {
    // Multi-event clipboard paste / clone posts items[] here. Without a demo
    // handler the request fell through to DEMO_API_UNHANDLED and every pasted
    // event was silently dropped. Mirror the server contract: { created, failed }
    // where each created entry carries its source index and the new event. See P3-17.
    const items = Array.isArray(body.items) ? body.items : [];
    const created = items.map((item, index) => {
      const event = makeCalendarEvent(item || {}, `demo-event-${Date.now()}-${index}`);
      seed.calendarEvents.push(event);
      return { index, event: clone(event) };
    });
    return { created, failed: [] };
  }

  if (pathname.match(/^\/api\/calendar\/events\/[^/]+$/) && method === "PATCH") {
    const eventId = decodeURIComponent(pathSegment(pathname, 1));
    const index = seed.calendarEvents.findIndex((event) => String(event.id) === String(eventId));
    if (index < 0) return notFound(path);
    seed.calendarEvents[index] = { ...seed.calendarEvents[index], ...makeCalendarEvent({ ...seed.calendarEvents[index], ...body }, eventId), id: eventId };
    return { event: clone(seed.calendarEvents[index]!) };
  }

  if (pathname.match(/^\/api\/calendar\/events\/[^/]+$/) && method === "DELETE") {
    const eventId = decodeURIComponent(pathSegment(pathname, 1));
    seed.calendarEvents = seed.calendarEvents.filter((event) => String(event.id) !== String(eventId));
    seed.currentDashboard.calendar = seed.calendarEvents;
    return { ok: true };
  }

  // Reminders are not modeled in the demo seed; the calendar editor still calls
  // these routes when opening/saving an event. Return inert demo-safe shapes so
  // the editor never surfaces DEMO_API_UNHANDLED. See P3-16.
  if (pathname === "/api/ea/reminders" && method === "POST") {
    const id = `demo-reminder-${Date.now()}`;
    return clone({ id, ...body, demo: true });
  }

  if (pathname.match(/^\/api\/ea\/reminders\/[^/]+$/) && method === "DELETE") {
    return { ok: true };
  }

  if (pathname === "/api/ea/settings" && method === "PUT") {
    Object.assign(seed.settings, body);
    return clone(seed.settings);
  }

  if (pathname === "/api/ea/important-senders" && method === "PUT") {
    seed.importantSenders = Array.isArray(body.senders) ? body.senders : [];
    return { success: true };
  }

  if (pathname === "/api/dashboard/current"
    || pathname === "/api/dashboard/current/refresh"
    || pathname === "/api/dashboard/current/sync"
    || pathname === "/api/dashboard/health") {
    return pathname === "/api/dashboard/health" ? clone(seed.currentDashboard.providerHealth) : clone(seed.currentDashboard);
  }

  if (pathname === "/api/calendar/range") {
    const start = url.searchParams.get("start") ?? "";
    const end = url.searchParams.get("end") ?? "";
    return {
      // Filter by the event's Pacific calendar day (derived from startMs) rather
      // than event.start.slice(0,10) (the UTC day). The seed builds events in the
      // viewer's local zone, so a UTC-day filter drops boundary events for any
      // non-UTC viewer. See P3-19.
      events: demoDateRange(seed.calendarEvents, start, end, (event) => pacificYMD(event.startMs)),
    };
  }

  if (pathname === "/api/calendar/search") {
    return searchCalendar({
      scope: url.searchParams.get("scope") || "events",
      q: url.searchParams.get("q") || "",
      limit: url.searchParams.get("limit"),
    });
  }

  if (pathname === "/api/calendar/calendars") {
    return {
      accounts: [{
        accountId: "demo-gmail",
        label: "Demo Gmail",
        email: "alex@demo.example",
        calendars: [
          { id: "demo-work", summary: "Demo Work", backgroundColor: "#89b4fa", primary: true },
          { id: "demo-personal", summary: "Demo Personal", backgroundColor: "#cba6f7" },
          { id: "demo-career", summary: "Demo Career", backgroundColor: "#f5c2e7" },
        ],
      }],
    };
  }

  if (pathname === "/api/calendar/deadlines") {
    if (method === "POST") {
      const id = `demo-deadline-${Date.now()}`;
      const template = seed.deadlines.upcoming[0]!;
      const deadline = {
        ...clone(template), id,
        todoist_id: id,
        title: body.title || body.content || "Demo deadline",
        due_date: body.due_date || body.dueDate || seed.dateKey,
        due_time: body.due_time || body.dueTime || null,
        status: body.status || "open",
        source: "todoist",
        class_name: String(body.class_name || body.project_name || "Inbox"),
        project_name: String(body.class_name || body.project_name || "Inbox"),
      };
      seed.deadlines.upcoming.unshift(deadline);
      return clone(deadline);
    }
    return clone(seed.deadlines);
  }

  if (pathname.match(/^\/api\/calendar\/deadlines\/[^/]+$/) && method === "PATCH") {
    const taskId = decodeURIComponent(pathSegment(pathname, 1));
    mutateTask(seed, taskId, (task) => {
      Object.assign(task, body, { id: task.id, todoist_id: task.todoist_id || task.id });
    });
    return clone(seed.deadlines.upcoming.find((task) => String(task.id) === String(taskId)) || { ok: true });
  }

  if (pathname.match(/^\/api\/calendar\/deadlines\/[^/]+$/) && method === "DELETE") {
    const taskId = decodeURIComponent(pathSegment(pathname, 1));
    seed.deadlines.upcoming = seed.deadlines.upcoming.filter((task) => String(task.id) !== String(taskId));
    return { ok: true };
  }

  if (pathname.match(/^\/api\/calendar\/deadlines\/[^/]+\/completed-occurrences\/[^/]+$/) && method === "POST") {
    const taskId = decodeURIComponent(pathSegment(pathname, 3));
    mutateTask(seed, taskId, (task) => { task.status = "complete"; });
    return { ok: true };
  }

  if (pathname === "/api/calendar/deadlines/range") {
    return filterDeadlines(seed.deadlines, url.searchParams.get("start") ?? "", url.searchParams.get("end") ?? "");
  }
  if (pathname === "/api/calendar/bills/range") {
    return buildDemoCalendarBillsRange(seed, url);
  }
  if (pathname === "/api/ea/accounts") return clone(seed.accounts);
  if (pathname === "/api/ea/settings") return clone({ email_triage_classify_read_arrivals: false, ...seed.settings });
  if (pathname === "/api/capabilities") return getDemoCapabilityStatus();
  if (pathname === "/api/instance-credentials") return getDemoInstanceCredentialMetadata();
  if (pathname === "/api/briefing/actual/metadata") return clone(seed.actualMetadata);
  if (pathname === "/api/briefing/actual/cache/status") {
    return {
      success: true,
      configured: true,
      hydrated: true,
      budgetId: "Demo Budget",
      dbSizeBytes: 0,
      backupCount: 0,
      demo: true,
    };
  }
  if (pathname === "/api/ea/models" || pathname === "/api/ea/bill-extract-models") {
    return [{
      provider: "demo",
      label: "Demo",
      available: true,
      defaultModel: pathname === "/api/ea/models" ? "demo-triage-model" : "demo-bill-extract-model",
      models: [{
        id: pathname === "/api/ea/models" ? "demo-triage-model" : "demo-bill-extract-model",
        label: pathname === "/api/ea/models" ? "Demo triage model" : "Demo bill model",
      }],
    }];
  }
  if (pathname === "/api/ea/important-senders") return clone(seed.importantSenders);
  if (pathname === "/api/ea/triage/cache-stats") return { enabled: false, demo: true };
  if (pathname === "/api/alfred/usage") return { enabled: false, demo: true };
  if (pathname === "/api/ea/email-search/usage") return { enabled: false, demo: true };
  // GET reminders: the editor reads `result.reminders || []`. No demo reminders
  // exist, so return an empty list rather than DEMO_API_UNHANDLED. See P3-16.
  if (pathname === "/api/ea/reminders") return { reminders: [] };
  // Location autocomplete (Google Places) has no demo backend. Return empty,
  // demo-safe shapes so typing in the location field never surfaces the raw
  // DEMO_API_UNHANDLED string. The consumer reads `data.places` / `data.place`.
  // See P3-18.
  if (pathname === "/api/calendar/places/suggest") return { places: [] };
  if (pathname.match(/^\/api\/calendar\/places\/[^/]+$/)) return { place: null };
  return unsupported(path);
}

export function getDemoReadSnapshotForTests() {
  return readDemoSeed();
}
