import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/connection.js", () => ({ default: { execute: vi.fn() } }));
vi.mock("../platform/encryption.js", () => ({
  decrypt: () => JSON.stringify({
    access_token: "token-1",
    refresh_token: "refresh-1",
    expires_at: Date.now() + 3600_000,
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  }),
  encrypt: (value) => value,
}));

vi.stubGlobal("fetch", vi.fn());

const {
  createCalendarEvent,
  deleteCalendarEvent,
  extractStructuredRecurrence,
  fetchCalendarMirrorEvents,
  invalidateCalendarListCache,
  listCalendarsForAccount,
  updateCalendarEvent,
} = await import("./calendar.js");

const account = {
  id: "acct-1",
  email: "me@example.com",
  color: "#4285f4",
  credentials_encrypted: "stub",
};

const calendarList = {
  items: [
    {
      id: "primary",
      summary: "Primary",
      accessRole: "owner",
      primary: true,
    },
    {
      id: "school",
      summary: "School",
      accessRole: "owner",
    },
  ],
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function selectedInstance(overrides = {}) {
  return {
    id: "instance-1",
    recurringEventId: "series-1",
    etag: '"instance-current"',
    summary: "Weekly sync",
    start: { dateTime: "2026-04-27T09:00:00-07:00" },
    end: { dateTime: "2026-04-27T09:30:00-07:00" },
    originalStartTime: { dateTime: "2026-04-27T16:00:00.000Z" },
    ...overrides,
  };
}

function parentSeries(overrides = {}) {
  return {
    id: "series-1",
    etag: '"parent-current"',
    summary: "Weekly sync",
    start: { dateTime: "2026-04-06T09:00:00-07:00" },
    end: { dateTime: "2026-04-06T09:30:00-07:00" },
    recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO"],
    ...overrides,
  };
}

function installCalendarFetch({ selected = selectedInstance(), parent = parentSeries() } = {}) {
  fetch.mockImplementation(async (url, init = {}) => {
    const parsed = new URL(String(url));
    const method = init.method || "GET";
    const path = parsed.pathname.replace("/calendar/v3/", "");

    if (method === "GET" && path === "users/me/calendarList") {
      return jsonResponse(calendarList);
    }
    if (method === "GET" && path === "calendars/primary/events/instance-1") {
      return jsonResponse(selected);
    }
    if (method === "GET" && path === "calendars/primary/events/series-1") {
      return jsonResponse(parent);
    }
    if (method === "PATCH" && path === "calendars/primary/events/series-1") {
      return jsonResponse({ ...parent, ...JSON.parse(init.body || "{}") });
    }
    if (method === "DELETE" && path === "calendars/primary/events/series-1") {
      return jsonResponse({});
    }
    return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
  });
}

function findFetchCall(method, eventId) {
  return fetch.mock.calls.find(([url, init = {}]) => {
    return (init.method || "GET") === method && String(url).includes(`/events/${eventId}`);
  });
}

describe("calendar recurring mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The calendar-list memo is module-scoped and keyed by account.id; reset it
    // between tests so each starts cold and re-fetches via its own fetch mock.
    // vi.clearAllMocks() does not touch this source-module cache, so a sibling
    // test that listed `school` as read-only would otherwise leak forward.
    invalidateCalendarListCache();
  });

  it("omits CalendarList entries that are not selected in Google Calendar", async () => {
    fetch.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");
      if (method === "GET" && path === "users/me/calendarList") {
        return jsonResponse({
          items: [
            { id: "primary", summary: "Primary", accessRole: "owner", primary: true, selected: true },
            { id: "work", summary: "Work", accessRole: "reader", selected: false },
            { id: "school", summary: "School", accessRole: "reader" },
          ],
        });
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    await expect(listCalendarsForAccount(account)).resolves.toEqual([
      expect.objectContaining({ id: "primary", summary: "Primary" }),
      expect.objectContaining({ id: "school", summary: "School" }),
    ]);
  });

  it("preserves cancelled status for expanded recurring mirror occurrences with start times", async () => {
    fetch.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");
      if (method === "GET" && path === "calendars/work/events") {
        return jsonResponse({
          items: [
            {
              id: "series-work_20260512T111500Z",
              status: "cancelled",
              recurringEventId: "series-work",
              originalStartTime: { dateTime: "2026-05-12T04:15:00-07:00" },
              start: { dateTime: "2026-05-12T04:15:00-07:00" },
              end: { dateTime: "2026-05-12T08:00:00-07:00" },
              summary: "Work",
            },
          ],
          nextSyncToken: "sync-1",
        });
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    await expect(fetchCalendarMirrorEvents(account, {
      id: "work",
      summary: "Work",
      backgroundColor: "#cd74e6",
      writable: true,
    }, {
      window: { start: "2026-05-01", end: "2026-06-01" },
    })).resolves.toMatchObject({
      events: [
        {
          id: "series-work_20260512T111500Z",
          status: "cancelled",
          recurringEventId: "series-work",
          originalStartTime: "2026-05-12T04:15:00-07:00",
        },
      ],
      nextSyncToken: "sync-1",
    });
  });

  it("windowed mirror fetch omits orderBy so Google returns a nextSyncToken", async () => {
    fetch.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");
      if (method === "GET" && path === "calendars/work/events") {
        return jsonResponse({ items: [], nextSyncToken: "sync-1" });
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    await expect(fetchCalendarMirrorEvents(account, { id: "work", summary: "Work" }, {
      window: { start: "2026-05-01", end: "2026-06-01" },
    })).resolves.toMatchObject({ nextSyncToken: "sync-1" });

    const [url] = fetch.mock.calls.find(([callUrl]) => String(callUrl).includes("calendars/work/events"));
    const params = new URL(String(url)).searchParams;
    expect(params.get("orderBy")).toBeNull();
    expect(params.get("singleEvents")).toBe("true");
    expect(params.get("timeMin")).toBe("2026-05-01T00:00:00.000Z");
  });

  it("uses the fetched parent etag when editing an instance with all scope", async () => {
    installCalendarFetch();

    await updateCalendarEvent(account, "instance-1", {
      calendarId: "primary",
      etag: '"stale-instance"',
      scope: "all",
      recurringEventId: "series-1",
      originalStartTime: "2026-04-27T16:00:00.000Z",
      title: "Weekly sync updated",
      allDay: false,
      startDate: "2026-04-27",
      endDate: "2026-04-27",
      startTime: "09:00",
      endTime: "09:30",
    });

    const [, init] = findFetchCall("PATCH", "series-1");
    expect(init.headers["If-Match"]).toBe('"parent-current"');
  });

  it("moves a single event from its source calendar before patching the target calendar", async () => {
    fetch.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");

      if (method === "GET" && path === "users/me/calendarList") {
        return jsonResponse(calendarList);
      }
      if (method === "GET" && path === "calendars/primary/events/event-1") {
        return jsonResponse({
          id: "event-1",
          etag: '"source-current"',
          summary: "Planning",
          start: { dateTime: "2026-04-27T09:00:00-07:00" },
          end: { dateTime: "2026-04-27T09:30:00-07:00" },
        });
      }
      if (method === "POST" && path === "calendars/primary/events/event-1/move") {
        expect(parsed.searchParams.get("destination")).toBe("school");
        return jsonResponse({
          id: "event-1",
          etag: '"moved-current"',
          summary: "Planning",
          start: { dateTime: "2026-04-27T09:00:00-07:00" },
          end: { dateTime: "2026-04-27T09:30:00-07:00" },
        });
      }
      if (method === "PATCH" && path === "calendars/school/events/event-1") {
        return jsonResponse({
          id: "event-1",
          etag: '"patched-current"',
          ...JSON.parse(init.body || "{}"),
        });
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    const updated = await updateCalendarEvent(account, "event-1", {
      sourceCalendarId: "primary",
      calendarId: "school",
      etag: '"stale-source"',
      title: "Planning moved",
      allDay: false,
      startDate: "2026-04-27",
      endDate: "2026-04-27",
      startTime: "10:00",
      endTime: "10:30",
    });

    expect(updated.calendarId).toBe("school");
    expect(updated.calendarName).toBe("School");
    const moveCall = fetch.mock.calls.find(([url, init = {}]) => {
      return (init.method || "GET") === "POST" && String(url).includes("/events/event-1/move");
    });
    expect(moveCall[1].headers["If-Match"]).toBe('"source-current"');
    const patchCall = fetch.mock.calls.find(([url, init = {}]) => {
      return (init.method || "GET") === "PATCH" && String(url).includes("/calendars/school/events/event-1");
    });
    expect(patchCall[1].headers["If-Match"]).toBe('"moved-current"');
  });

  it("recovers cross-calendar update retries after Google already moved the event", async () => {
    fetch.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");

      if (method === "GET" && path === "users/me/calendarList") {
        return jsonResponse(calendarList);
      }
      if (method === "GET" && path === "calendars/primary/events/event-1") {
        return jsonResponse({
          error: {
            code: 404,
            message: "Not Found",
            errors: [{ reason: "notFound" }],
          },
        }, 404);
      }
      if (method === "GET" && path === "calendars/school/events/event-1") {
        return jsonResponse({
          id: "event-1",
          etag: '"target-current"',
          summary: "Planning",
          start: { dateTime: "2026-04-27T09:00:00-07:00" },
          end: { dateTime: "2026-04-27T09:30:00-07:00" },
        });
      }
      if (method === "PATCH" && path === "calendars/school/events/event-1") {
        return jsonResponse({
          id: "event-1",
          etag: '"patched-current"',
          ...JSON.parse(init.body || "{}"),
        });
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    const updated = await updateCalendarEvent(account, "event-1", {
      sourceCalendarId: "primary",
      calendarId: "school",
      etag: '"stale-source"',
      title: "Planning moved",
      allDay: false,
      startDate: "2026-04-27",
      endDate: "2026-04-27",
      startTime: "10:00",
      endTime: "10:30",
    });

    expect(updated.calendarId).toBe("school");
    expect(updated.title).toBe("Planning moved");
    expect(fetch.mock.calls.some(([url, init = {}]) => {
      return (init.method || "GET") === "POST" && String(url).includes("/events/event-1/move");
    })).toBe(false);
    const patchCall = fetch.mock.calls.find(([url, init = {}]) => {
      return (init.method || "GET") === "PATCH" && String(url).includes("/calendars/school/events/event-1");
    });
    expect(patchCall[1].headers["If-Match"]).toBe('"target-current"');
  });

  it("recovers when Google reports the moved event already exists in the target calendar", async () => {
    fetch.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");

      if (method === "GET" && path === "users/me/calendarList") {
        return jsonResponse(calendarList);
      }
      if (method === "GET" && path === "calendars/primary/events/event-1") {
        return jsonResponse({
          id: "event-1",
          etag: '"source-current"',
          summary: "Planning",
          start: { dateTime: "2026-04-27T09:00:00-07:00" },
          end: { dateTime: "2026-04-27T09:30:00-07:00" },
        });
      }
      if (method === "POST" && path === "calendars/primary/events/event-1/move") {
        return jsonResponse({
          error: {
            code: 409,
            message: "The requested identifier already exists.",
            errors: [{ reason: "duplicate" }],
          },
        }, 409);
      }
      if (method === "GET" && path === "calendars/school/events/event-1") {
        return jsonResponse({
          id: "event-1",
          etag: '"target-current"',
          summary: "Planning",
          start: { dateTime: "2026-04-27T09:00:00-07:00" },
          end: { dateTime: "2026-04-27T09:30:00-07:00" },
        });
      }
      if (method === "PATCH" && path === "calendars/school/events/event-1") {
        return jsonResponse({
          id: "event-1",
          etag: '"patched-current"',
          ...JSON.parse(init.body || "{}"),
        });
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    const updated = await updateCalendarEvent(account, "event-1", {
      sourceCalendarId: "primary",
      calendarId: "school",
      etag: '"stale-source"',
      title: "Planning moved",
      allDay: false,
      startDate: "2026-04-27",
      endDate: "2026-04-27",
      startTime: "10:00",
      endTime: "10:30",
    });

    expect(updated.calendarId).toBe("school");
    const patchCall = fetch.mock.calls.find(([url, init = {}]) => {
      return (init.method || "GET") === "PATCH" && String(url).includes("/calendars/school/events/event-1");
    });
    expect(patchCall[1].headers["If-Match"]).toBe('"target-current"');
  });

  it("normalizes raw Google save errors without exposing the provider body", async () => {
    fetch.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");

      if (method === "GET" && path === "users/me/calendarList") {
        return jsonResponse(calendarList);
      }
      if (method === "POST" && path === "calendars/primary/events") {
        return jsonResponse({
          error: {
            code: 500,
            message: "Huge provider stack with request internals",
            errors: [{ reason: "backendError" }],
          },
        }, 500);
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    let error;
    try {
      await createCalendarEvent(account, {
        calendarId: "primary",
        title: "Planning",
        allDay: false,
        startDate: "2026-04-27",
        endDate: "2026-04-27",
        startTime: "10:00",
        endTime: "10:30",
      });
    } catch (err) {
      error = err;
    }

    expect(error).toMatchObject({
      status: 502,
      code: "calendar_google_error",
      message: "Google Calendar could not save this event. Refresh the calendar and try again.",
      googleMessage: "Huge provider stack with request internals",
    });
    expect(error.message).not.toContain("Huge provider stack");
    expect(error.rawGoogleError).toContain("Huge provider stack");
  });

  it("rejects birthday event mutations before patching or deleting Google Calendar", async () => {
    fetch.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");

      if (method === "GET" && path === "users/me/calendarList") {
        return jsonResponse(calendarList);
      }
      if (method === "GET" && path === "calendars/primary/events/birthday-1") {
        return jsonResponse({
          id: "birthday-1",
          etag: '"birthday-current"',
          summary: "Maya's Birthday",
          eventType: "birthday",
          birthdayProperties: { type: "birthday", contact: "people/c12345" },
          start: { date: "2026-05-22" },
          end: { date: "2026-05-23" },
        });
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    await expect(updateCalendarEvent(account, "birthday-1", {
      calendarId: "primary",
      title: "Maya's Birthday",
      allDay: true,
      startDate: "2026-05-22",
      endDate: "2026-05-22",
    })).rejects.toMatchObject({
      status: 403,
      code: "calendar_event_read_only",
    });

    await expect(deleteCalendarEvent(account, "birthday-1", {
      calendarId: "primary",
    })).rejects.toMatchObject({
      status: 403,
      code: "calendar_event_read_only",
    });

    expect(fetch.mock.calls.some(([url, init = {}]) => {
      const method = init.method || "GET";
      return ["PATCH", "DELETE"].includes(method) && String(url).includes("/events/birthday-1");
    })).toBe(false);
  });

  it("sends a valid event color when creating an event", async () => {
    fetch.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");

      if (method === "GET" && path === "users/me/calendarList") {
        return jsonResponse(calendarList);
      }
      if (method === "POST" && path === "calendars/primary/events") {
        return jsonResponse({
          id: "event-colored",
          etag: '"created"',
          ...JSON.parse(init.body || "{}"),
        });
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    const created = await createCalendarEvent(account, {
      calendarId: "primary",
      title: "Planning",
      allDay: false,
      startDate: "2026-04-27",
      endDate: "2026-04-27",
      startTime: "10:00",
      endTime: "10:30",
      colorId: "9",
    });

    const createCall = fetch.mock.calls.find(([url, init = {}]) => {
      return (init.method || "GET") === "POST" && String(url).includes("/calendars/primary/events");
    });
    expect(JSON.parse(createCall[1].body).colorId).toBe("9");
    expect(created.colorId).toBe("9");
    expect(created.color).toBe("#5484ed");
  });

  it("rejects unsupported event colors", async () => {
    fetch.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");

      if (method === "GET" && path === "users/me/calendarList") {
        return jsonResponse(calendarList);
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    await expect(createCalendarEvent(account, {
      calendarId: "primary",
      title: "Planning",
      allDay: false,
      startDate: "2026-04-27",
      endDate: "2026-04-27",
      startTime: "10:00",
      endTime: "10:30",
      colorId: "12",
    })).rejects.toMatchObject({
      status: 400,
      code: "calendar_validation_error",
    });
  });

  it("trims a recurring series with exception dates when deleting following events", async () => {
    installCalendarFetch({
      parent: parentSeries({
        recurrence: [
          "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
          "EXDATE;TZID=America/Los_Angeles:20260413T090000",
        ],
      }),
    });

    await deleteCalendarEvent(account, "instance-1", {
      calendarId: "primary",
      etag: '"stale-instance"',
      scope: "following",
      recurringEventId: "series-1",
      originalStartTime: "2026-04-27T16:00:00.000Z",
    });

    const [, init] = findFetchCall("PATCH", "series-1");
    expect(init.headers["If-Match"]).toBe('"parent-current"');
    expect(JSON.parse(init.body).recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20260427T155959Z",
    ]);
  });

  it("patches the parent directly when following edit starts at the first occurrence", async () => {
    installCalendarFetch({
      selected: selectedInstance({
        start: { dateTime: "2026-04-06T09:00:00-07:00" },
        end: { dateTime: "2026-04-06T09:30:00-07:00" },
        originalStartTime: { dateTime: "2026-04-06T16:00:00.000Z" },
      }),
    });

    await updateCalendarEvent(account, "instance-1", {
      calendarId: "primary",
      etag: '"stale-instance"',
      scope: "following",
      recurringEventId: "series-1",
      originalStartTime: "2026-04-06T16:00:00.000Z",
      title: "Weekly sync updated",
      allDay: false,
      startDate: "2026-04-06",
      endDate: "2026-04-06",
      startTime: "09:00",
      endTime: "09:30",
    });

    const [, init] = findFetchCall("PATCH", "series-1");
    expect(init.headers["If-Match"]).toBe('"parent-current"');
    expect(fetch.mock.calls.some(([url, callInit = {}]) => {
      return (callInit.method || "GET") === "POST" && String(url).endsWith("/events");
    })).toBe(false);
  });

  it("deletes the parent directly when following delete starts at the first occurrence", async () => {
    installCalendarFetch({
      selected: selectedInstance({
        start: { dateTime: "2026-04-06T09:00:00-07:00" },
        end: { dateTime: "2026-04-06T09:30:00-07:00" },
        originalStartTime: { dateTime: "2026-04-06T16:00:00.000Z" },
      }),
    });

    await deleteCalendarEvent(account, "instance-1", {
      calendarId: "primary",
      etag: '"stale-instance"',
      scope: "following",
      recurringEventId: "series-1",
      originalStartTime: "2026-04-06T16:00:00.000Z",
    });

    const [, init] = findFetchCall("DELETE", "series-1");
    expect(init.headers["If-Match"]).toBe('"parent-current"');
    expect(findFetchCall("PATCH", "series-1")).toBeUndefined();
  });

  it("extracts structured recurrence from a series that also has exception dates", () => {
    expect(extractStructuredRecurrence([
      "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
      "EXDATE;TZID=America/Los_Angeles:20260413T090000",
    ])).toMatchObject({
      frequency: "weekly",
      interval: 1,
      weekdays: ["MO"],
    });
  });
});
