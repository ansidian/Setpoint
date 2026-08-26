import { beforeEach, describe, expect, it, vi } from "vitest";

// test-architecture: allow-boundary-mock -- Identity and cache behavior run through the real Calendar mutation facade against a controlled Google HTTP boundary.
vi.mock("../db/connection.ts", () => ({ default: { execute: vi.fn() } }));
// test-architecture: allow-boundary-mock -- Credential decryption is the cryptographic storage boundary; identity tests use one controlled authorized Google credential.
vi.mock("../platform/encryption.ts", () => ({
  decrypt: () => JSON.stringify({
    access_token: "token-1",
    refresh_token: "refresh-1",
    expires_at: Date.now() + 3600_000,
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  }),
  encrypt: (value: string) => value,
}));

const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal("fetch", fetchMock);

const { createCalendarEvent, invalidateCalendarListCache } = await import("./calendar.ts");
const account = {
  id: "acct-identity",
  email: "me@example.com",
  color: "#4285f4",
  credentials_encrypted: "stub",
};
const calendarList = {
  items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
};
const draft = {
  calendarId: "primary",
  title: "Planning",
  allDay: false,
  startDate: "2026-04-27",
  endDate: "2026-04-27",
  startTime: "10:00",
  endTime: "10:30",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateCalendarListCache();
});

describe("calendar mutation identity and calendar-list cache", () => {
  it("recovers an idempotent caller-id create after Google reports it already exists", async () => {
    const clientEventId = "0123456789abcdef0123456789abcdef";
    fetchMock.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");
      if (method === "GET" && path === "users/me/calendarList") return jsonResponse(calendarList);
      if (method === "POST" && path === "calendars/primary/events") {
        expect(JSON.parse(String(init.body || "{}")).id).toBe(clientEventId);
        return jsonResponse({ error: { code: 409, message: "The requested identifier already exists." } }, 409);
      }
      if (method === "GET" && path === `calendars/primary/events/${clientEventId}`) {
        return jsonResponse({
          id: clientEventId,
          etag: '"created"',
          summary: "Planning",
          start: { dateTime: "2026-04-27T10:00:00-07:00" },
          end: { dateTime: "2026-04-27T10:30:00-07:00" },
        });
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    const created = await createCalendarEvent(account, { ...draft, clientEventId });

    expect(created.id).toBe(clientEventId);
  });

  it("reuses the calendar-list cache across consecutive event creates", async () => {
    let createdCount = 0;
    fetchMock.mockImplementation(async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = init.method || "GET";
      const path = parsed.pathname.replace("/calendar/v3/", "");
      if (method === "GET" && path === "users/me/calendarList") return jsonResponse(calendarList);
      if (method === "POST" && path === "calendars/primary/events") {
        createdCount += 1;
        return jsonResponse({
          id: `event-${createdCount}`,
          etag: `"created-${createdCount}"`,
          ...JSON.parse(String(init.body || "{}")),
        });
      }
      return jsonResponse({ error: `Unexpected ${method} ${path}` }, 500);
    });

    await createCalendarEvent(account, draft);
    await createCalendarEvent(account, { ...draft, title: "Planning two" });

    // test-architecture: allow-boundary-interaction -- Calendar-list request count is the outbound cache contract; normalized create results cannot reveal an unnecessary provider list read.
    const calendarListReads = fetchMock.mock.calls.filter(([url, init = {}]) => (
      (init.method || "GET") === "GET" && String(url).includes("users/me/calendarList")
    ));
    expect(calendarListReads).toHaveLength(1);
  });
});
