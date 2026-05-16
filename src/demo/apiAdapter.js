import { createDemoApiError } from "./config.js";
import { demoDateRange, getDemoSeed, readDemoSeed } from "./store.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function route(path) {
  return new URL(path, "http://ea-dashboard-demo.local");
}

function unsupported(path) {
  throw createDemoApiError(path);
}

function notFound(path) {
  const error = new Error(`Demo data not found for ${path}.`);
  error.code = "DEMO_NOT_FOUND";
  error.status = 404;
  throw error;
}

function allSnapshotRows(snapshot) {
  return [
    ...(snapshot.carryover || []),
    ...Object.values(snapshot.lanes || {}).flat(),
  ];
}

function parseBody(options = {}) {
  if (!options.body) return {};
  if (typeof options.body === "string") {
    try {
      return JSON.parse(options.body);
    } catch {
      return {};
    }
  }
  return options.body;
}

function refreshLaneCounts(snapshot) {
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

function mutateSnapshotRows(snapshot, uid, updater) {
  for (const row of allSnapshotRows(snapshot)) {
    if (String(row.uid || row.email_id) === String(uid)) updater(row);
  }
}

function removeSnapshotRow(snapshot, uid) {
  for (const [lane, rows] of Object.entries(snapshot.lanes || {})) {
    snapshot.lanes[lane] = rows.filter((row) => String(row.uid || row.email_id) !== String(uid));
  }
  snapshot.carryover = (snapshot.carryover || []).filter((row) => String(row.uid || row.email_id) !== String(uid));
  refreshLaneCounts(snapshot);
}

function moveSnapshotRow(snapshot, itemId, lane) {
  let found = null;
  removeSnapshotRow(snapshot, `__no_match_${itemId}`);
  for (const [currentLane, rows] of Object.entries(snapshot.lanes || {})) {
    const index = rows.findIndex((row) => String(row.snapshot_item_id || row.id) === String(itemId));
    if (index >= 0) {
      [found] = rows.splice(index, 1);
      found.lane = lane;
      found._lane = lane;
      break;
    }
    if (currentLane) continue;
  }
  if (!found) {
    const index = (snapshot.carryover || []).findIndex((row) => String(row.snapshot_item_id || row.id) === String(itemId));
    if (index >= 0) {
      [found] = snapshot.carryover.splice(index, 1);
      found.lane = lane;
      found._lane = lane;
    }
  }
  if (found) {
    if (!snapshot.lanes[lane]) snapshot.lanes[lane] = [];
    snapshot.lanes[lane].unshift(found);
  }
  refreshLaneCounts(snapshot);
  return found;
}

function mutateTask(seed, taskId, updater) {
  for (const task of seed.deadlines.upcoming || []) {
    if (String(task.id || task.todoist_id) === String(taskId)) updater(task);
  }
}

function makeCalendarEvent(data, id = `demo-event-${Date.now()}`) {
  const start = data.start || data.startIso || data.startDateTime || new Date().toISOString();
  const end = data.end || data.endIso || data.endDateTime || new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString();
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return {
    id,
    title: data.title || "Untitled demo event",
    calendarId: data.calendarId || "demo-work",
    calendarName: "Demo Work",
    accountId: "demo-gmail",
    accountLabel: "Demo Gmail",
    source: "Demo Work",
    sourceLabel: "Demo Work",
    sourceColor: "#89b4fa",
    color: "#89b4fa",
    start,
    end,
    startMs,
    endMs,
    allDay: !!data.allDay,
    location: data.location || "",
    description: data.description || "Fictional demo calendar event.",
  };
}

function filterDeadlines(deadlines, start, end) {
  return {
    ...clone(deadlines),
    upcoming: demoDateRange(deadlines.upcoming, start, end, (item) => item.due_date),
  };
}

function calendarCoverage(scope, start, end) {
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

function searchCalendar({ scope, q, limit }) {
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

  const results = (scope === "bills" ? billResults : [...eventResults, ...deadlineResults]).slice(0, cappedLimit);
  return {
    query: q || "",
    scope,
    results,
    coverage: calendarCoverage(scope, start, end),
    truncated: results.length >= cappedLimit,
  };
}

export async function handleDemoApiRequest(path, options = {}) {
  const seed = getDemoSeed();
  const url = route(path);
  const pathname = url.pathname;
  const method = String(options.method || "GET").toUpperCase();
  const body = parseBody(options);

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/mark-read$/) && method === "POST") {
    const uid = decodeURIComponent(pathname.split("/").at(-2));
    mutateSnapshotRows(seed.activeSnapshot, uid, (row) => { row.read = true; });
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/mark-unread$/) && method === "POST") {
    const uid = decodeURIComponent(pathname.split("/").at(-2));
    mutateSnapshotRows(seed.activeSnapshot, uid, (row) => { row.read = false; });
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/trash$/) && method === "POST") {
    const uid = decodeURIComponent(pathname.split("/").at(-2));
    removeSnapshotRow(seed.activeSnapshot, uid);
    return { ok: true };
  }

  if (pathname.startsWith("/api/briefing/dismiss/") && method === "POST") {
    removeSnapshotRow(seed.activeSnapshot, decodeURIComponent(pathname.split("/").at(-1)));
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/lane$/) && method === "PATCH") {
    const itemId = decodeURIComponent(pathname.split("/").at(-2));
    return clone(moveSnapshotRow(seed.activeSnapshot, itemId, body.lane || "fyi") || { ok: true });
  }

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/(dismiss|handled)$/) && method === "POST") {
    const itemId = decodeURIComponent(pathname.split("/").at(-2));
    const row = moveSnapshotRow(seed.activeSnapshot, itemId, "handled");
    return clone(row || { ok: true });
  }

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/restore$/) && method === "POST") {
    const itemId = decodeURIComponent(pathname.split("/").at(-2));
    const row = moveSnapshotRow(seed.activeSnapshot, itemId, "needs_attention");
    return clone(row || { ok: true });
  }

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/reopen$/) && method === "POST") {
    const itemId = decodeURIComponent(pathname.split("/").at(-2));
    const row = moveSnapshotRow(seed.activeSnapshot, itemId, "needs_attention");
    return clone(row || { ok: true });
  }

  if (pathname.startsWith("/api/briefing/complete-task/") && method === "POST") {
    mutateTask(seed, decodeURIComponent(pathname.split("/").at(-1)), (task) => { task.status = "complete"; });
    return { ok: true };
  }

  if (pathname === "/api/briefing/todoist/tasks" && method === "POST") {
    const id = `demo-task-${Date.now()}`;
    const dueDate = body.due_date || body.dueDate || seed.dateKey;
    const task = {
      id,
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
    const taskId = decodeURIComponent(pathname.split("/").at(-1));
    mutateTask(seed, taskId, (task) => {
      Object.assign(task, body, { id: task.id, todoist_id: task.todoist_id });
    });
    return clone(seed.deadlines.upcoming.find((task) => String(task.id) === String(taskId)) || { ok: true });
  }

  if (pathname.match(/^\/api\/briefing\/todoist\/tasks\/[^/]+$/) && method === "DELETE") {
    const taskId = decodeURIComponent(pathname.split("/").at(-1));
    seed.deadlines.upcoming = seed.deadlines.upcoming.filter((task) => String(task.id) !== String(taskId));
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/actual\/bills\/[^/]+\/mark-paid$/) && method === "POST") {
    const billId = decodeURIComponent(pathname.split("/").at(-2));
    for (const bill of seed.bills) {
      if (String(bill.id) === String(billId) || String(bill.scheduleId) === String(billId)) bill.paid = true;
    }
    return { ok: true };
  }

  if (pathname === "/api/calendar/events" && method === "POST") {
    const created = makeCalendarEvent(body);
    seed.calendarEvents.push(created);
    return clone(created);
  }

  if (pathname.match(/^\/api\/calendar\/events\/[^/]+$/) && method === "PATCH") {
    const eventId = decodeURIComponent(pathname.split("/").at(-1));
    const index = seed.calendarEvents.findIndex((event) => String(event.id) === String(eventId));
    if (index < 0) return notFound(path);
    seed.calendarEvents[index] = { ...seed.calendarEvents[index], ...makeCalendarEvent({ ...seed.calendarEvents[index], ...body }, eventId), id: eventId };
    return clone(seed.calendarEvents[index]);
  }

  if (pathname.match(/^\/api\/calendar\/events\/[^/]+$/) && method === "DELETE") {
    const eventId = decodeURIComponent(pathname.split("/").at(-1));
    seed.calendarEvents = seed.calendarEvents.filter((event) => String(event.id) !== String(eventId));
    seed.currentDashboard.calendar = seed.calendarEvents;
    return { ok: true };
  }

  if (pathname === "/api/notes" && method === "POST") {
    const note = {
      id: `demo-note-${Date.now()}`,
      content: body.content || "",
      sort_order: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    seed.notes.unshift(note);
    seed.notes.forEach((entry, index) => { entry.sort_order = index + 1; });
    return clone(note);
  }

  if (pathname === "/api/notes/reorder" && method === "PATCH") {
    const order = Array.isArray(body.noteIds) ? body.noteIds.map(String) : [];
    const byId = new Map(seed.notes.map((note) => [String(note.id), note]));
    const ordered = order.map((id) => byId.get(id)).filter(Boolean);
    const remaining = seed.notes.filter((note) => !order.includes(String(note.id)));
    seed.notes = [...ordered, ...remaining];
    seed.notes.forEach((entry, index) => { entry.sort_order = index + 1; });
    return clone(seed.notes);
  }

  if (pathname.match(/^\/api\/notes\/[^/]+$/) && method === "PATCH") {
    const noteId = decodeURIComponent(pathname.split("/").at(-1));
    const note = seed.notes.find((entry) => String(entry.id) === String(noteId));
    if (!note) return notFound(path);
    note.content = body.content ?? note.content;
    note.updated_at = new Date().toISOString();
    return clone(note);
  }

  if (pathname.match(/^\/api\/notes\/[^/]+$/) && method === "DELETE") {
    const noteId = decodeURIComponent(pathname.split("/").at(-1));
    seed.notes = seed.notes.filter((entry) => String(entry.id) !== String(noteId));
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
    return clone(pathname === "/api/dashboard/health" ? seed.currentDashboard.providerHealth : seed.currentDashboard);
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
    const uid = decodeURIComponent(briefingEmailParts[3]);
    return clone(seed.emailBodies[uid] || notFound(path));
  }

  if (pathname === "/api/calendar/range") {
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    return {
      events: demoDateRange(seed.calendarEvents, start, end, (event) => event.start.slice(0, 10)),
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
      const deadline = {
        id,
        todoist_id: id,
        title: body.title || body.content || "Demo deadline",
        due_date: body.due_date || body.dueDate || seed.dateKey,
        due_time: body.due_time || body.dueTime || null,
        status: body.status || "open",
        source: "todoist",
        class_name: body.class_name || body.project_name || "Inbox",
      };
      seed.deadlines.upcoming.unshift(deadline);
      return clone(deadline);
    }
    return clone(seed.deadlines);
  }

  if (pathname.match(/^\/api\/calendar\/deadlines\/[^/]+$/) && method === "PATCH") {
    const taskId = decodeURIComponent(pathname.split("/").at(-1));
    mutateTask(seed, taskId, (task) => {
      Object.assign(task, body, { id: task.id, todoist_id: task.todoist_id || task.id });
    });
    return clone(seed.deadlines.upcoming.find((task) => String(task.id) === String(taskId)) || { ok: true });
  }

  if (pathname.match(/^\/api\/calendar\/deadlines\/[^/]+$/) && method === "DELETE") {
    const taskId = decodeURIComponent(pathname.split("/").at(-1));
    seed.deadlines.upcoming = seed.deadlines.upcoming.filter((task) => String(task.id) !== String(taskId));
    return { ok: true };
  }

  if (pathname.match(/^\/api\/calendar\/deadlines\/[^/]+\/completed-occurrences\/[^/]+$/) && method === "POST") {
    const parts = pathname.split("/");
    const taskId = decodeURIComponent(parts.at(-3));
    mutateTask(seed, taskId, (task) => { task.status = "complete"; });
    return { ok: true };
  }

  if (pathname === "/api/calendar/deadlines/range") {
    return filterDeadlines(seed.deadlines, url.searchParams.get("start"), url.searchParams.get("end"));
  }

  if (pathname === "/api/calendar/bills/range") {
    const schedules = demoDateRange(seed.bills, url.searchParams.get("start"), url.searchParams.get("end"), (item) => item.next_date);
    return {
      schedules,
      recentTransactions: [],
      payeeMap: clone(seed.currentDashboard.payeeMap),
      actualBudgetUrl: seed.currentDashboard.actualBudgetUrl,
      syncHealth: clone(seed.currentDashboard.billsSyncHealth),
    };
  }

  if (pathname === "/api/ea/accounts") return clone(seed.accounts);
  if (pathname === "/api/ea/settings") return clone(seed.settings);
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
  if (pathname === "/api/briefing/email-search") {
    const rows = allSnapshotRows(seed.activeSnapshot);
    return { emails: rows, accountsById: {} };
  }

  return unsupported(path);
}

export function getDemoReadSnapshotForTests() {
  return readDemoSeed();
}
