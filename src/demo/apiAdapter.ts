import { createDemoApiError } from "./config.ts";
import { demoDateRange } from "./dateRange.ts";
import { buildDemoCalendarBillsRange } from "./financeData.ts";
import { getDemoReferenceResponse, NO_DEMO_REFERENCE_RESPONSE } from "./referenceAdapter.ts";
import { allSnapshotRows, findSnapshotRow, mutateSnapshotRows } from "./snapshotRows.ts";
import { forkDemoSeedForMutation, getDemoSeed, pacificYMD, readDemoSeed } from "./store.ts";
import { getDemoCapabilityStatus, getDemoInstanceCredentialMetadata } from "./capabilities.ts";
import { handleDemoTransactionImportRequest, NO_DEMO_TRANSACTION_IMPORT_RESPONSE } from "./transactionImports.ts";
import type { DemoSeed } from "./store.ts";
import type { NewsSource } from "../../shared/types/news.ts";
type DemoSnapshot = DemoSeed["activeSnapshot"];
type DemoSnapshotRow = DemoSnapshot["carryover"][number];
type DemoLane = keyof DemoSnapshot["lanes"];
type DemoTask = DemoSeed["deadlines"]["upcoming"][number];
type DemoCalendarEvent = DemoSeed["calendarEvents"][number];
interface DemoRequestBody extends Record<string, unknown> {
  archived?: boolean;
  allDay?: boolean;
  at?: string;
  calendarId?: string;
  content?: string;
  description?: string;
  due_date?: string;
  dueDate?: string;
  due_time?: string;
  dueTime?: string;
  end?: string;
  endIso?: string;
  endDate?: string;
  endDateTime?: string;
  endTime?: string;
  feedUrl?: string;
  hnQuery?: string;
  ids?: Array<string | number>;
  items?: DemoRequestBody[];
  kind?: "rss" | "hn";
  lane?: DemoLane;
  location?: string;
  minPoints?: number;
  name?: string;
  noteIds?: Array<string | number>;
  q?: string;
  senders?: DemoSeed["importantSenders"];
  siteUrl?: string | null;
  start?: string;
  startIso?: string;
  startDate?: string;
  startDateTime?: string;
  startTime?: string;
  status?: string;
  title?: string;
  topicId?: number;
  uids?: string[];
}

interface DemoNotFoundError extends Error {
  code: "DEMO_NOT_FOUND";
  status: 404;
}
const clone = <T>(value: T): T => value == null ? value : structuredClone(value);

function route(path: string): URL {
  return new URL(path, "http://setpoint-demo.local");
}

function unsupported(path: string): never {
  throw createDemoApiError(path);
}

function notFound(path: string): never {
  const error = new Error(`Demo data not found for ${path}.`) as DemoNotFoundError;
  error.code = "DEMO_NOT_FOUND";
  error.status = 404;
  throw error;
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

function pathSegment(pathname: string, fromEnd: number): string {
  const segments = pathname.split("/");
  return segments[segments.length - fromEnd] ?? "";
}

function refreshLaneCounts(snapshot: DemoSnapshot): void {
  snapshot.laneCounts = {
    queued: snapshot.lanes.queued?.length || 0,
    needs_attention: snapshot.lanes.needs_attention?.length || 0,
    catch_up: snapshot.lanes.catch_up?.length || 0,
    fyi: snapshot.lanes.fyi?.length || 0,
    handled: snapshot.lanes.handled?.length || 0,
    untriaged_read: snapshot.lanes.untriaged_read?.length || 0,
    noise: snapshot.lanes.noise?.length || 0,
    carryover: snapshot.carryover?.length || 0,
  };
}

function findSnapshotRowLane(snapshot: DemoSnapshot, uid: string): DemoLane | "carryover" | null {
  for (const [lane, rows] of Object.entries(snapshot.lanes) as Array<[DemoLane, DemoSnapshotRow[]]>) {
    if (rows.some((row) => String(row.uid || row.email_id) === String(uid))) return lane;
  }
  if ((snapshot.carryover || []).some((row) => String(row.uid || row.email_id) === String(uid))) return "carryover";
  return null;
}

function removeSnapshotRow(snapshot: DemoSnapshot, uid: string): void {
  for (const [lane, rows] of Object.entries(snapshot.lanes) as Array<[DemoLane, DemoSnapshotRow[]]>) {
    snapshot.lanes[lane] = rows.filter((row) => String(row.uid || row.email_id) !== String(uid));
  }
  snapshot.carryover = (snapshot.carryover || []).filter((row) => String(row.uid || row.email_id) !== String(uid));
  refreshLaneCounts(snapshot);
}

function moveSnapshotRow(snapshot: DemoSnapshot, itemId: string, lane: DemoLane): DemoSnapshotRow | null {
  let found: DemoSnapshotRow | null = null;
  removeSnapshotRow(snapshot, `__no_match_${itemId}`);
  for (const [currentLane, rows] of Object.entries(snapshot.lanes) as Array<[DemoLane, DemoSnapshotRow[]]>) {
    const index = rows.findIndex((row) => String(row.snapshot_item_id || row.id) === String(itemId));
    if (index >= 0) {
      found = rows.splice(index, 1)[0] ?? null;
      if (!found) break;
      found.lane = lane;
      (found as DemoSnapshotRow & { _lane?: DemoLane })._lane = lane;
      break;
    }
    if (currentLane) continue;
  }
  if (!found) {
    const index = (snapshot.carryover || []).findIndex((row) => String(row.snapshot_item_id || row.id) === String(itemId));
    if (index >= 0) {
      found = snapshot.carryover.splice(index, 1)[0] ?? null;
      if (found) {
        found.lane = lane;
        (found as DemoSnapshotRow & { _lane?: DemoLane })._lane = lane;
      }
    }
  }
  if (found) {
    if (!snapshot.lanes[lane]) snapshot.lanes[lane] = [];
    snapshot.lanes[lane].unshift(found);
  }
  refreshLaneCounts(snapshot);
  return found;
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
  if (pathname === "/api/briefing/email/mark-all-read" && method === "POST") {
    for (const uid of Array.isArray(body.uids) ? body.uids : []) {
      mutateSnapshotRows(seed.activeSnapshot, uid, (row) => { row.read = true; });
    }
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/mark-read$/) && method === "POST") {
    const uid = decodeURIComponent(pathSegment(pathname, 2));
    mutateSnapshotRows(seed.activeSnapshot, uid, (row) => { row.read = true; });
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/mark-unread$/) && method === "POST") {
    const uid = decodeURIComponent(pathSegment(pathname, 2));
    mutateSnapshotRows(seed.activeSnapshot, uid, (row) => { row.read = false; });
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/pin$/) && (method === "POST" || method === "DELETE")) {
    const uid = decodeURIComponent(pathSegment(pathname, 2));
    mutateSnapshotRows(seed.activeSnapshot, uid, (row) => {
      (row as DemoSnapshotRow & { pinned?: boolean }).pinned = method === "POST";
    });
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/trash$/) && method === "POST") {
    const uid = decodeURIComponent(pathSegment(pathname, 2));
    removeSnapshotRow(seed.activeSnapshot, uid);
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/snooze$/) && method === "POST") {
    const uid = decodeURIComponent(pathSegment(pathname, 2));
    const row = findSnapshotRow(seed.activeSnapshot, uid);
    if (row) {
      // Stash the row + its lane so unsnooze (undo) can restore it truthfully.
      seed.snoozedEmails = seed.snoozedEmails || {};
      seed.snoozedEmails[uid] = { row: clone(row), lane: findSnapshotRowLane(seed.activeSnapshot, uid) };
      removeSnapshotRow(seed.activeSnapshot, uid);
    }
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/snooze$/) && method === "DELETE") {
    const uid = decodeURIComponent(pathSegment(pathname, 2));
    const stashed = seed.snoozedEmails?.[uid];
    if (stashed) {
      if (stashed.lane === "carryover") {
        seed.activeSnapshot.carryover = [...(seed.activeSnapshot.carryover || []), stashed.row];
      } else {
        const lane = stashed.lane && seed.activeSnapshot.lanes[stashed.lane] ? stashed.lane : "needs_attention";
        seed.activeSnapshot.lanes[lane] = [...(seed.activeSnapshot.lanes[lane] || []), stashed.row];
      }
      refreshLaneCounts(seed.activeSnapshot);
      delete seed.snoozedEmails[uid];
    }
    return { ok: true };
  }

  if (pathname.startsWith("/api/briefing/dismiss/") && method === "POST") {
    removeSnapshotRow(seed.activeSnapshot, decodeURIComponent(pathSegment(pathname, 1)));
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/lane$/) && method === "PATCH") {
    const itemId = decodeURIComponent(pathSegment(pathname, 2));
    return clone(moveSnapshotRow(seed.activeSnapshot, itemId, body.lane || "fyi") || { ok: true });
  }

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/(dismiss|handled)$/) && method === "POST") {
    const itemId = decodeURIComponent(pathSegment(pathname, 2));
    const row = moveSnapshotRow(seed.activeSnapshot, itemId, "handled");
    return clone(row || { ok: true });
  }

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/restore$/) && method === "POST") {
    const itemId = decodeURIComponent(pathSegment(pathname, 2));
    const row = moveSnapshotRow(seed.activeSnapshot, itemId, "needs_attention");
    return clone(row || { ok: true });
  }

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/reopen$/) && method === "POST") {
    const itemId = decodeURIComponent(pathSegment(pathname, 2));
    const row = moveSnapshotRow(seed.activeSnapshot, itemId, "needs_attention");
    return clone(row || { ok: true });
  }

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

  if (pathname === "/api/notes" && method === "POST") {
    const note = {
      id: `demo-note-${Date.now()}`,
      user_id: "demo-user",
      content: body.content || "",
      sort_order: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      archived_at: null,
    };
    seed.notes.unshift(note);
    seed.notes.forEach((entry, index) => { entry.sort_order = index + 1; });
    return clone(note);
  }

  if (pathname === "/api/notes/reorder" && method === "PATCH") {
    const order = Array.isArray(body.noteIds) ? body.noteIds.map(String) : [];
    const byId = new Map(seed.notes.map((note) => [String(note.id), note]));
    const ordered = order.map((id) => byId.get(id)).filter((note): note is DemoSeed["notes"][number] => Boolean(note));
    const remaining = seed.notes.filter((note) => !order.includes(String(note.id)));
    seed.notes = [...ordered, ...remaining];
    seed.notes.forEach((entry, index) => { entry.sort_order = index + 1; });
    return clone(seed.notes);
  }

  if (pathname.match(/^\/api\/notes\/[^/]+\/archive$/) && method === "PATCH") {
    const noteId = decodeURIComponent(pathSegment(pathname, 2));
    const note = seed.notes.find((entry) => String(entry.id) === String(noteId));
    if (!note) return notFound(path);
    note.archived_at = body.archived ? new Date().toISOString() : null;
    note.updated_at = new Date().toISOString();
    return { success: true };
  }

  if (pathname.match(/^\/api\/notes\/[^/]+$/) && method === "PATCH") {
    const noteId = decodeURIComponent(pathSegment(pathname, 1));
    const note = seed.notes.find((entry) => String(entry.id) === String(noteId));
    if (!note) return notFound(path);
    note.content = body.content ?? note.content;
    note.updated_at = new Date().toISOString();
    return clone(note);
  }

  if (pathname.match(/^\/api\/notes\/[^/]+$/) && method === "DELETE") {
    const noteId = decodeURIComponent(pathSegment(pathname, 1));
    seed.notes = seed.notes.filter((entry) => String(entry.id) !== String(noteId));
    return { ok: true };
  }

  if (pathname === "/api/news/seen" && method === "POST") {
    seed.news.lastSeenAt = body.at || new Date().toISOString();
    return { ok: true, at: seed.news.lastSeenAt };
  }

  if (pathname === "/api/news/refresh" && method === "POST") {
    return { swept: 0, throttled: false };
  }

  if (pathname === "/api/news/topics" && method === "POST") {
    const name = body.name || "Demo topic";
    const id = Math.max(0, ...seed.news.topics.map((t) => t.id)) + 1;
    seed.news.topics.push({ id, name, position: seed.news.topics.length, sources: [], items: [], mutedTerms: [] });
    return { id, name };
  }

  if (pathname === "/api/news/topics/reorder" && method === "POST") {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    seed.news.topics.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    seed.news.topics.forEach((topic, index) => { topic.position = index; });
    return { ok: true };
  }

  if (pathname === "/api/news/topics/import-starter" && method === "POST") {
    return { imported: body.names || [] };
  }

  if (pathname.match(/^\/api\/news\/topics\/[^/]+$/) && method === "PATCH") {
    const id = Number(pathSegment(pathname, 1));
    const topic = seed.news.topics.find((t) => t.id === id);
    if (topic) topic.name = body.name || topic.name;
    if (topic && Array.isArray(body.mutedTerms)) topic.mutedTerms = body.mutedTerms;
    return { ok: true };
  }

  if (pathname.match(/^\/api\/news\/topics\/[^/]+$/) && method === "DELETE") {
    const id = Number(pathSegment(pathname, 1));
    seed.news.topics = seed.news.topics.filter((t) => t.id !== id);
    return { ok: true };
  }

  if (pathname === "/api/news/sources/preview" && method === "POST") {
    return { feedUrl: "https://demo.example/feed", title: "Demo Feed", sampleTitles: ["Sample headline"] };
  }

  if (pathname === "/api/news/sources" && method === "POST") {
    const topic = seed.news.topics.find((t) => t.id === Number(body.topicId));
    const id = Date.now() % 100000;
    const source: NewsSource = {
      id, topicId: body.topicId ?? 0, kind: body.kind || "rss", title: body.title || "Demo source",
      feedUrl: body.feedUrl || "https://demo.example/feed", siteUrl: body.siteUrl || null,
      enabled: true, hnQuery: body.hnQuery ?? null, minPoints: body.minPoints ?? null,
      lastStatus: null, lastFetchAt: null, consecutiveFailures: 0,
    };
    if (topic) topic.sources.push(source);
    return { source };
  }

  if (pathname.match(/^\/api\/news\/sources\/[^/]+$/) && (method === "PATCH" || method === "DELETE")) {
    const id = Number(pathSegment(pathname, 1));
    for (const topic of seed.news.topics) {
      if (method === "DELETE") {
        topic.sources = topic.sources.filter((s) => s.id !== id);
        topic.items = topic.items.filter((i) => i.sourceId !== id);
      } else {
        const source = topic.sources.find((s) => s.id === id);
        if (source) Object.assign(source, body);
      }
    }
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

  if (pathname === "/api/briefing/snapshot/active" || pathname === "/api/briefing/snapshot/sync") {
    return clone(seed.activeSnapshot);
  }

  if (pathname === "/api/briefing/snapshot/history") {
    return {
      snapshots: [{
        ...clone(seed.activeSnapshot.snapshot),
        laneCounts: clone(seed.activeSnapshot.laneCounts),
        item_count: Object.values(seed.activeSnapshot.laneCounts).reduce((sum, count) => sum + Number(count || 0), 0),
      }],
    };
  }

  if (pathname.startsWith("/api/briefing/snapshot/")) {
    return clone(seed.activeSnapshot);
  }

  const briefingEmailParts = pathname.split("/").filter(Boolean);
  if (briefingEmailParts.length === 4
    && briefingEmailParts[0] === "api"
    && briefingEmailParts[1] === "briefing"
    && briefingEmailParts[2] === "email") {
    const uid = decodeURIComponent(briefingEmailParts[3]!);
    return clone(seed.emailBodies[uid] || notFound(path));
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
  if (pathname === "/api/notes") return clone(seed.notes);
  if (pathname === "/api/news") return clone(seed.news);
  if (pathname === "/api/news/catalog") {
    return { topics: [{ name: "3D Printing", sources: [] }, { name: "AI", sources: [] }] };
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
  if (pathname === "/api/briefing/email-search") {
    const rows = allSnapshotRows(seed.activeSnapshot);
    return { emails: rows, accountsById: {} };
  }
  return unsupported(path);
}

export function getDemoReadSnapshotForTests() {
  return readDemoSeed();
}
