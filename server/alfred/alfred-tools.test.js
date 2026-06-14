import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALFRED_TOOL_DEFINITIONS,
  alfredToolSummary,
  executeAlfredTool,
} from "./alfred-tools.js";
import {
  _clearAlfredConversationsForTest,
  createAlfredConversation,
} from "./alfred-conversations.js";
import { htmlToPlainText } from "../email/html-to-text.js";

function ctxWith(deps, overrides = {}) {
  return {
    userId: "user-1",
    conversation: createAlfredConversation({ now: 0 }),
    deps,
    emit: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  _clearAlfredConversationsForTest();
});

describe("tool definitions", () => {
  it("exposes exactly the six read-only tools", () => {
    expect(ALFRED_TOOL_DEFINITIONS.map((tool) => tool.name).sort()).toEqual([
      "get_calendar_events",
      "get_deadlines",
      "get_email_body",
      "get_upcoming_bills",
      "search_email",
      "show_items",
    ]);
    for (const tool of ALFRED_TOOL_DEFINITIONS) {
      expect(tool.input_schema?.type).toBe("object");
      expect(tool.description).toBeTruthy();
    }
  });

  it("tells the model that a query filter unlocks year-long ranges", () => {
    const byName = new Map(ALFRED_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
    const deadlines = byName.get("get_deadlines");
    expect(deadlines.input_schema.properties.query).toBeTruthy();
    for (const name of ["get_deadlines", "get_calendar_events"]) {
      expect(byName.get(name).description).toContain("query");
      expect(byName.get(name).description).toContain("366");
    }
  });
});

describe("search_email", () => {
  it("builds a retrieval plan from structured params and caches candidates", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      mode: "hybrid",
      total: 1,
      candidates: [{
        uid: "em-1",
        subject: "Car insurance renewal",
        body_snippet: "Your policy renews soon",
        body_excerpt: "Your policy renews soon. Amount due $182.13",
        email_date: "2026-06-10T12:00:00.000Z",
        read: false,
        from: { name: "Geico", address: "no-reply@geico.com" },
        account: { id: "acc-1", label: "Personal" },
        metadata: { lane: "needs_attention", urgency: "high" },
        provenance: { lexical: true, vector: true },
        scores: { lexical: 0.4, vector: 0.5, combined: 0.46 },
      }],
    });
    const ctx = ctxWith({ retrieve });

    const result = await executeAlfredTool("search_email", {
      query: "car insurance renewal",
      after: "2026-05-01",
      read_filter: "unread",
      limit: 5,
    }, ctx);

    expect(retrieve).toHaveBeenCalledWith("user-1", expect.objectContaining({
      q: "car insurance renewal",
      limit: 5,
      plan: expect.objectContaining({
        semantic_query: "car insurance renewal",
        lexical_queries: ["car insurance renewal"],
        read_filter: "unread",
        date_window: { after: "2026-05-01", before: null },
      }),
    }));
    expect(result.total).toBe(1);
    expect(result.results[0].uid).toBe("em-1");
    expect(result.results[0].snippet).toContain("<email_content uid=\"em-1\">");
    // Full candidate cached for show_items, keyed by uid:
    expect(ctx.conversation.items.get("email:em-1").subject).toBe("Car insurance renewal");
  });

  it("requires a query", async () => {
    const ctx = ctxWith({ retrieve: vi.fn() });
    const result = await executeAlfredTool("search_email", {}, ctx);
    expect(result.error).toBeTruthy();
    expect(ctx.deps.retrieve).not.toHaveBeenCalled();
  });
});

describe("get_email_body", () => {
  it("returns the body as wrapped plain text", async () => {
    const getEmailBody = vi.fn().mockResolvedValue({
      html_body: "<p>Hello <b>world</b></p>",
      subject: "Hi",
      from: "A <a@b.com>",
      date: "2026-06-10T12:00:00.000Z",
    });
    const result = await executeAlfredTool("get_email_body", { uid: "em-1" }, ctxWith({ getEmailBody, htmlToPlainText }));
    expect(getEmailBody).toHaveBeenCalledWith("user-1", "em-1");
    expect(result.body).toContain("<email_content uid=\"em-1\">");
    expect(result.body).toContain("Hello");
    expect(result.body).not.toContain("<p>");
  });
});

describe("get_calendar_events", () => {
  it("filters to calendar-enabled gmail accounts and maps compact rows", async () => {
    const loadUserConfig = vi.fn().mockResolvedValue({
      accounts: [
        { id: "g1", type: "gmail", calendar_enabled: true },
        { id: "g2", type: "gmail", calendar_enabled: false },
        { id: "i1", type: "icloud" },
      ],
    });
    const pacificDayBoundaries = vi.fn((date) => ({ dayStart: date, dayEnd: date }));
    const fetchCalendar = vi.fn().mockResolvedValue([{
      id: "ev-1",
      title: "Dentist",
      time: "2:00 PM",
      duration: "45m",
      allDay: false,
      location: "",
      calendarName: "Personal",
      dayLabel: "Fri, Jun 12",
      startMs: 1,
      endMs: 2,
    }]);
    const ctx = ctxWith({ loadUserConfig, pacificDayBoundaries, fetchCalendar });

    const result = await executeAlfredTool("get_calendar_events", {
      start: "2026-06-12",
      end: "2026-06-14",
    }, ctx);

    expect(fetchCalendar).toHaveBeenCalledTimes(1);
    expect(fetchCalendar.mock.calls[0][0]).toEqual([
      { id: "g1", type: "gmail", calendar_enabled: true },
    ]);
    expect(result.events).toEqual([{
      id: "ev-1",
      title: "Dentist",
      date: "Fri, Jun 12",
      time: "2:00 PM",
      duration: "45m",
      allDay: false,
      location: null,
      calendar: "Personal",
    }]);
    expect(ctx.conversation.items.get("event:ev-1").title).toBe("Dentist");
  });

  it("rejects malformed dates", async () => {
    const ctx = ctxWith({});
    const result = await executeAlfredTool("get_calendar_events", { start: "junk", end: "2026-06-14" }, ctx);
    expect(result.error).toContain("YYYY-MM-DD");
  });

  it("allows a year-long range when a query filter is present", async () => {
    const loadUserConfig = vi.fn().mockResolvedValue({ accounts: [] });
    const pacificDayBoundaries = vi.fn((date) => ({ dayStart: date, dayEnd: date }));
    const fetchCalendar = vi.fn().mockResolvedValue([]);
    const ctx = ctxWith({ loadUserConfig, pacificDayBoundaries, fetchCalendar });

    const filtered = await executeAlfredTool("get_calendar_events", {
      start: "2026-06-12",
      end: "2027-06-11",
      query: "birthday",
    }, ctx);
    expect(filtered.error).toBeUndefined();

    const unfiltered = await executeAlfredTool("get_calendar_events", {
      start: "2026-06-12",
      end: "2027-06-11",
    }, ctx);
    expect(unfiltered.error).toContain("query");
  });
});

describe("get_deadlines", () => {
  it("maps deadline payload rows", async () => {
    const readCalendarDeadlineRange = vi.fn().mockResolvedValue({
      payload: {
        upcoming: [{ id: "td-1", content: "Renew registration", due_date: "2026-06-15", priority: 4 }],
      },
      errors: [],
    });
    const ctx = ctxWith({ readCalendarDeadlineRange });
    const result = await executeAlfredTool("get_deadlines", { start: "2026-06-12", end: "2026-06-30" }, ctx);

    expect(readCalendarDeadlineRange).toHaveBeenCalledWith("user-1", { start: "2026-06-12", end: "2026-06-30" });
    expect(result.deadlines[0]).toEqual(expect.objectContaining({
      id: "td-1",
      title: "Renew registration",
      due_date: "2026-06-15",
    }));
    expect(ctx.conversation.items.get("deadline:td-1")).toBeTruthy();
  });

  it("marks completed deadlines so the model can filter 'what is due' answers", async () => {
    const readCalendarDeadlineRange = vi.fn().mockResolvedValue({
      payload: {
        upcoming: [
          { id: "td-1", content: "File taxes", due_date: "2026-06-15", status: "complete" },
          { id: "td-2", content: "Renew registration", due_date: "2026-06-16", status: "incomplete" },
        ],
      },
      errors: [],
    });
    const ctx = ctxWith({ readCalendarDeadlineRange });
    const result = await executeAlfredTool("get_deadlines", { start: "2026-06-12", end: "2026-06-30" }, ctx);

    expect(result.deadlines).toEqual([
      expect.objectContaining({ id: "td-1", completed: true }),
      expect.objectContaining({ id: "td-2", completed: false }),
    ]);
    expect(result.total).toBe(2);
    expect(result.open).toBe(1);
  });

  it("filters by query text so name lookups stay cheap", async () => {
    const readCalendarDeadlineRange = vi.fn().mockResolvedValue({
      payload: {
        upcoming: [
          { id: "td-1", content: "Conway Lee's birthday", due_date: "2026-07-26", status: "incomplete" },
          { id: "td-2", content: "Renew registration", due_date: "2026-06-16", status: "incomplete" },
        ],
      },
      errors: [],
    });
    const ctx = ctxWith({ readCalendarDeadlineRange });
    const result = await executeAlfredTool("get_deadlines", {
      start: "2026-06-12",
      end: "2026-09-12",
      query: "conway",
    }, ctx);

    expect(result.deadlines).toEqual([
      expect.objectContaining({ id: "td-1", title: "Conway Lee's birthday" }),
    ]);
    expect(result.total).toBe(1);
  });

  it("allows up to a year in one call when a query filter is present", async () => {
    const readCalendarDeadlineRange = vi.fn().mockResolvedValue({ payload: { upcoming: [] }, errors: [] });
    const ctx = ctxWith({ readCalendarDeadlineRange });

    const filtered = await executeAlfredTool("get_deadlines", {
      start: "2026-06-12",
      end: "2027-06-11",
      query: "birthday",
    }, ctx);
    expect(filtered.error).toBeUndefined();
    expect(readCalendarDeadlineRange).toHaveBeenCalledWith("user-1", { start: "2026-06-12", end: "2027-06-11" });

    const unfiltered = await executeAlfredTool("get_deadlines", {
      start: "2026-06-12",
      end: "2027-06-11",
    }, ctx);
    expect(unfiltered.error).toContain("query");
  });
});

describe("get_upcoming_bills", () => {
  it("maps bill mirror rows", async () => {
    const readBillsMirrorRange = vi.fn().mockResolvedValue({
      schedules: [{ id: "b-1", name: "Car insurance", payee: "Geico", amount: 182.13, next_date: "2026-06-21", paid: false, type: "bill" }],
      syncHealth: { state: "current" },
    });
    const ctx = ctxWith({ readBillsMirrorRange });
    const result = await executeAlfredTool("get_upcoming_bills", { start: "2026-06-12", end: "2026-07-12" }, ctx);

    expect(result.bills[0]).toEqual({
      id: "b-1",
      name: "Car insurance",
      payee: "Geico",
      amount: 182.13,
      due_date: "2026-06-21",
      paid: false,
      type: "bill",
    });
    expect(ctx.conversation.items.get("bill:b-1")).toBeTruthy();
  });
});

describe("show_items", () => {
  it("emits cached rows verbatim and reports unknown ids", async () => {
    const ctx = ctxWith({});
    ctx.conversation.items.set("bill:b-1", { id: "b-1", name: "Car insurance", amount: 182.13 });

    const result = await executeAlfredTool("show_items", { kind: "bill", ids: ["b-1", "ghost"] }, ctx);

    expect(ctx.emit).toHaveBeenCalledWith({
      type: "rows",
      kind: "bill",
      items: [{ id: "b-1", name: "Car insurance", amount: 182.13 }],
    });
    expect(result).toEqual({ shown: 1, unknown_ids: ["ghost"] });
  });

  it("rejects unknown kinds and emits nothing", async () => {
    const ctx = ctxWith({});
    const result = await executeAlfredTool("show_items", { kind: "transaction", ids: ["x"] }, ctx);
    expect(result.error).toBeTruthy();
    expect(ctx.emit).not.toHaveBeenCalled();
  });
});

describe("alfredToolSummary", () => {
  it("produces quiet one-line labels", () => {
    expect(alfredToolSummary("search_email", { total: 4 })).toBe("Mail · 4 matches");
    expect(alfredToolSummary("get_calendar_events", { total: 2 })).toBe("Calendar · 2 events");
    expect(alfredToolSummary("get_deadlines", { total: 5, open: 3 })).toBe("Deadlines · 3 open");
    expect(alfredToolSummary("get_upcoming_bills", { total: 3 })).toBe("Bills · 3 upcoming");
    expect(alfredToolSummary("get_email_body", { subject: "Hi" })).toBe("Mail · opened message");
    expect(alfredToolSummary("show_items", { shown: 2 })).toBe("Showing 2 items");
    expect(alfredToolSummary("search_email", { error: "boom" })).toBe("Mail · failed");
  });
});

describe("unknown tool", () => {
  it("returns an error result", async () => {
    const result = await executeAlfredTool("write_email", {}, ctxWith({}));
    expect(result.error).toContain("Unknown tool");
  });
});
