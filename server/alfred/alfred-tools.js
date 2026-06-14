import { htmlToPlainText } from "../email/html-to-text.js";
import { cacheAlfredItems, readAlfredItems } from "./alfred-conversations.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 92;
const MAX_SEARCH_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 12;
const BODY_CHAR_LIMIT = 6000;
const SHOW_KINDS = new Set(["email", "event", "deadline", "bill"]);

export const ALFRED_TOOL_DEFINITIONS = [
  {
    name: "search_email",
    description: "Search the owner's indexed inbox mail (hybrid keyword + semantic). Returns compact matches with snippets; use get_email_body to read a full message. Reformulate and retry with different queries or date windows if results look weak.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language description of what to find" },
        lexical_queries: { type: "array", items: { type: "string" }, description: "Optional exact keyword phrases likely to appear in matching emails" },
        after: { type: "string", description: "Only emails on/after this ISO date (YYYY-MM-DD)" },
        before: { type: "string", description: "Only emails on/before this ISO date (YYYY-MM-DD)" },
        read_filter: { type: "string", enum: ["read", "unread"], description: "Restrict by read state" },
        limit: { type: "integer", description: "Max results (default 12, max 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_email_body",
    description: "Read the full plain-text body of one email by uid (from search_email results).",
    input_schema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "Email uid from a search_email result" },
      },
      required: ["uid"],
    },
  },
  {
    name: "get_calendar_events",
    description: "List the owner's Google Calendar events between two dates (inclusive, Pacific time).",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "Range start (YYYY-MM-DD)" },
        end: { type: "string", description: "Range end (YYYY-MM-DD)" },
        query: { type: "string", description: "Optional text filter applied by the calendar provider" },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "get_deadlines",
    description: "List the owner's deadlines (tasks with due dates) between two dates (inclusive).",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "Range start (YYYY-MM-DD)" },
        end: { type: "string", description: "Range end (YYYY-MM-DD)" },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "get_upcoming_bills",
    description: "List the owner's bill and card-payment occurrences between two dates (inclusive), with amounts and paid status.",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "Range start (YYYY-MM-DD)" },
        end: { type: "string", description: "Range end (YYYY-MM-DD)" },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "show_items",
    description: "Display retrieved items to the owner as native data rows. Pass ids of items returned by earlier tool calls in this conversation. Always use this instead of restating item details in prose.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["email", "event", "deadline", "bill"] },
        ids: { type: "array", items: { type: "string" }, description: "Item ids (email uid, event id, deadline id, or bill id)" },
      },
      required: ["kind", "ids"],
    },
  },
];

function wrapEmailContent(uid, text) {
  return `<email_content uid="${uid}">${String(text || "")}</email_content>`;
}

function parseDateRange(input = {}) {
  const startIso = String(input.start || "");
  const endIso = String(input.end || "");
  if (!DATE_RE.test(startIso) || !DATE_RE.test(endIso)) {
    return { error: "start and end must be YYYY-MM-DD dates" };
  }
  const start = new Date(`${startIso}T12:00:00.000Z`);
  const end = new Date(`${endIso}T12:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return { error: "invalid date range: end must be on or after start" };
  }
  if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    return { error: `range too large: maximum ${MAX_RANGE_DAYS} days per call` };
  }
  return { start, end, startIso, endIso };
}

async function runSearchEmail(input, { userId, conversation, deps }) {
  const query = String(input.query || "").trim();
  if (!query) return { error: "query is required" };
  const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Number(input.limit) || DEFAULT_SEARCH_LIMIT));
  const lexical = Array.isArray(input.lexical_queries)
    ? input.lexical_queries.map((value) => String(value)).filter(Boolean)
    : [];
  const plan = {
    semantic_query: query,
    lexical_queries: lexical.length ? lexical : [query],
    sender_domains: [],
    sender_addresses: [],
    read_filter: input.read_filter === "read" || input.read_filter === "unread" ? input.read_filter : null,
    date_window: {
      after: DATE_RE.test(String(input.after || "")) ? input.after : null,
      before: DATE_RE.test(String(input.before || "")) ? input.before : null,
    },
    lanes: [],
    categories: [],
    urgency: [],
    intents: [],
    exclusions: [],
    confidence: 1,
  };

  const result = await deps.retrieve(userId, { q: query, limit, plan });
  const candidates = result?.candidates || [];
  cacheAlfredItems(conversation, "email", candidates, "uid");

  return {
    total: result?.total ?? candidates.length,
    mode: result?.mode || "lexical",
    results: candidates.map((candidate) => ({
      uid: candidate.uid,
      from: candidate.from,
      subject: candidate.subject,
      date: candidate.email_date,
      read: candidate.read,
      snippet: wrapEmailContent(candidate.uid, candidate.body_snippet),
      lane: candidate.metadata?.lane ?? null,
      urgency: candidate.metadata?.urgency ?? null,
      scores: candidate.scores,
    })),
  };
}

async function runGetEmailBody(input, { userId, deps }) {
  const uid = String(input.uid || "").trim();
  if (!uid) return { error: "uid is required" };
  const body = await deps.getEmailBody(userId, uid);
  if (!body) return { error: `No email found for uid ${uid}` };
  const text = htmlToPlainText(body.html_body || "").slice(0, BODY_CHAR_LIMIT);
  return {
    uid,
    subject: body.subject || "",
    from: body.from || "",
    date: body.date || "",
    body: wrapEmailContent(uid, text),
  };
}

async function runGetCalendarEvents(input, { userId, conversation, deps }) {
  const range = parseDateRange(input);
  if (range.error) return { error: range.error };
  const { accounts } = await deps.loadUserConfig(userId);
  const calendarAccounts = (accounts || []).filter(
    (account) => account.type === "gmail" && account.calendar_enabled,
  );
  const { dayStart } = deps.pacificDayBoundaries(range.start);
  const { dayEnd } = deps.pacificDayBoundaries(range.end);
  const events = await deps.fetchCalendar(calendarAccounts, {
    startDate: dayStart,
    endDate: dayEnd,
    ...(input.query ? { query: String(input.query) } : {}),
  });
  cacheAlfredItems(conversation, "event", events, "id");
  return {
    total: events.length,
    events: events.map((event) => ({
      id: event.id,
      title: event.title,
      date: event.dayLabel || null,
      time: event.time,
      duration: event.duration,
      allDay: event.allDay,
      location: event.location || null,
      calendar: event.calendarName,
    })),
  };
}

async function runGetDeadlines(input, { userId, conversation, deps }) {
  const range = parseDateRange(input);
  if (range.error) return { error: range.error };
  const { payload, errors } = await deps.readCalendarDeadlineRange(userId, {
    start: range.startIso,
    end: range.endIso,
  });
  const upcoming = payload?.upcoming || [];
  cacheAlfredItems(conversation, "deadline", upcoming, "id");
  return {
    total: upcoming.length,
    ...(errors?.length ? { errors: errors.map((entry) => entry.message) } : {}),
    deadlines: upcoming.map((task) => ({
      id: task.id,
      title: task.content ?? task.title ?? "",
      due_date: task.due_date ?? null,
      priority: task.priority ?? null,
      completed: task.completed ?? false,
    })),
  };
}

async function runGetUpcomingBills(input, { userId, conversation, deps }) {
  const range = parseDateRange(input);
  if (range.error) return { error: range.error };
  const data = await deps.readBillsMirrorRange(userId, {
    start: range.startIso,
    end: range.endIso,
  });
  const bills = data?.schedules || [];
  cacheAlfredItems(conversation, "bill", bills, "id");
  return {
    total: bills.length,
    ...(data?.syncHealth?.state && data.syncHealth.state !== "current"
      ? { sync_state: data.syncHealth.state }
      : {}),
    bills: bills.map((bill) => ({
      id: bill.id,
      name: bill.name,
      payee: bill.payee,
      amount: bill.amount,
      due_date: bill.next_date,
      paid: bill.paid,
      type: bill.type,
    })),
  };
}

function runShowItems(input, { conversation, emit }) {
  const kind = String(input.kind || "");
  if (!SHOW_KINDS.has(kind)) {
    return { error: `Unknown kind "${kind}". Use one of: email, event, deadline, bill.` };
  }
  const ids = Array.isArray(input.ids) ? input.ids.map(String).filter(Boolean) : [];
  if (!ids.length) return { error: "ids is required" };
  const { found, missing } = readAlfredItems(conversation, kind, ids);
  if (found.length) emit({ type: "rows", kind, items: found });
  return {
    shown: found.length,
    ...(missing.length ? { unknown_ids: missing } : {}),
  };
}

export async function executeAlfredTool(name, input, ctx) {
  const args = input || {};
  switch (name) {
    case "search_email": return runSearchEmail(args, ctx);
    case "get_email_body": return runGetEmailBody(args, ctx);
    case "get_calendar_events": return runGetCalendarEvents(args, ctx);
    case "get_deadlines": return runGetDeadlines(args, ctx);
    case "get_upcoming_bills": return runGetUpcomingBills(args, ctx);
    case "show_items": return runShowItems(args, ctx);
    default: return { error: `Unknown tool "${name}"` };
  }
}

export function alfredToolSummary(name, result = {}) {
  if (result.error) {
    const source = {
      search_email: "Mail",
      get_email_body: "Mail",
      get_calendar_events: "Calendar",
      get_deadlines: "Deadlines",
      get_upcoming_bills: "Bills",
      show_items: "Display",
    }[name] || "Tool";
    return `${source} · failed`;
  }
  switch (name) {
    case "search_email": return `Mail · ${result.total ?? 0} matches`;
    case "get_email_body": return "Mail · opened message";
    case "get_calendar_events": return `Calendar · ${result.total ?? 0} events`;
    case "get_deadlines": return `Deadlines · ${result.total ?? 0} open`;
    case "get_upcoming_bills": return `Bills · ${result.total ?? 0} upcoming`;
    case "show_items": return `Showing ${result.shown ?? 0} items`;
    default: return name;
  }
}
