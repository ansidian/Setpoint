import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ credentials: null }));

vi.mock("../db/connection.js", () => ({ default: { execute: vi.fn() } }));
vi.mock("../platform/encryption.js", () => ({
  decrypt: () => JSON.stringify(mocks.credentials),
  encrypt: (value) => value,
}));

vi.stubGlobal("fetch", vi.fn());

const db = (await import("../db/connection.js")).default;
const {
  createCalendarEvent,
  fetchCalendarMirrorEvents,
  listCalendarsForAccount,
} = await import("./calendar.js");

const account = {
  id: "acct-1",
  email: "me@example.com",
  label: "Google",
  color: "#4285f4",
  credentials_encrypted: "stub",
};

function freshCredentials(overrides = {}) {
  return {
    access_token: "token-1",
    refresh_token: "refresh-1",
    expires_at: Date.now() + 3600_000,
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.credentials = freshCredentials();
});

describe("OAuth token refresh", () => {
  it("refreshes an expiring access token, persists it, and uses it for the API call", async () => {
    mocks.credentials = freshCredentials({ expires_at: Date.now() - 1000 });
    fetch
      .mockResolvedValueOnce(jsonResponse({
        access_token: "token-2",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar.events",
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
      }));

    const calendars = await listCalendarsForAccount(account);

    const [refreshUrl, refreshInit] = fetch.mock.calls[0];
    expect(String(refreshUrl)).toBe("https://oauth2.googleapis.com/token");
    expect(String(refreshInit.body)).toContain("grant_type=refresh_token");
    expect(String(refreshInit.body)).toContain("refresh_token=refresh-1");

    const [, listInit] = fetch.mock.calls[1];
    expect(listInit.headers.Authorization).toBe("Bearer token-2");

    expect(db.execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining("UPDATE ea_accounts"),
      args: [expect.stringContaining("token-2"), "acct-1"],
    }));
    expect(calendars).toHaveLength(1);
  });

  it("maps a rejected refresh to calendar_token_refresh_failed", async () => {
    mocks.credentials = freshCredentials({ expires_at: Date.now() - 1000 });
    fetch.mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400));

    await expect(listCalendarsForAccount(account)).rejects.toMatchObject({
      status: 401,
      code: "calendar_token_refresh_failed",
    });
  });

  it("skips the refresh entirely when the token is still valid", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
    }));

    await listCalendarsForAccount(account);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("users/me/calendarList");
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe("listCalendarsForAccount", () => {
  it("filters hidden/unselected entries and sorts primary, writable, then alphabetical", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      items: [
        { id: "zeta", summary: "Zeta", accessRole: "writer" },
        { id: "read", summary: "Read Only", accessRole: "reader" },
        { id: "hidden", summary: "Hidden", accessRole: "owner", hidden: true },
        { id: "unselected", summary: "Unselected", accessRole: "owner", selected: false },
        { id: "alpha", summary: "Alpha", accessRole: "writer" },
        { id: "primary", summary: "Primary", accessRole: "owner", primary: true },
      ],
    }));

    const calendars = await listCalendarsForAccount(account);

    expect(calendars.map((c) => c.id)).toEqual(["primary", "alpha", "zeta", "read"]);
    expect(calendars[0].writable).toBe(true);
    expect(calendars[3].writable).toBe(false);
  });

  it("marks every calendar read-only when stored scopes lack calendar write access", async () => {
    mocks.credentials = freshCredentials({ scopes: ["https://www.googleapis.com/auth/gmail.readonly"] });
    fetch.mockResolvedValueOnce(jsonResponse({
      items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
    }));

    const calendars = await listCalendarsForAccount(account);

    expect(calendars).toHaveLength(1);
    expect(calendars[0].writable).toBe(false);
  });

  it("falls back to a synthetic primary calendar when Google rejects the calendar list", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ error: { code: 403, message: "forbidden" } }, 403));

    const calendars = await listCalendarsForAccount(account);

    expect(calendars).toEqual([expect.objectContaining({
      id: "primary",
      summary: "Primary",
      writable: true,
      syntheticCalendarListFallback: true,
    })]);
  });
});

describe("Google error mapping", () => {
  it("maps a 412 precondition failure to a 409 calendar_event_conflict", async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
      }))
      .mockResolvedValueOnce(jsonResponse({}, 412));

    await expect(createCalendarEvent(account, {
      calendarId: "primary",
      title: "Dentist",
      allDay: true,
      startDate: "2026-06-11",
    })).rejects.toMatchObject({
      status: 409,
      code: "calendar_event_conflict",
    });
  });

  it("maps a 410 to calendar_sync_token_invalid for incremental mirror syncs", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ error: { code: 410, message: "gone" } }, 410));

    await expect(fetchCalendarMirrorEvents(account, { id: "primary", summary: "Primary" }, {
      syncToken: "stale-token",
    })).rejects.toMatchObject({
      status: 410,
      code: "calendar_sync_token_invalid",
    });
  });
});
