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
  invalidateCalendarListCache,
  listCalendarsForAccount,
} = await import("./calendar.js");
const { getRawEvent, getAuthorizedAccount } = await import("./calendar-google-client.js");

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
  // The calendar-list memo is module-scoped and keyed by account.id; reset it
  // between tests so each starts cold and fetch-call assertions stay isolated.
  invalidateCalendarListCache();
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

  it("marks the account needs_reauth on an invalid_grant refresh failure (REL-01)", async () => {
    mocks.credentials = freshCredentials({ expires_at: Date.now() - 1000 });
    fetch.mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400));

    await expect(getAuthorizedAccount(account)).rejects.toMatchObject({
      code: "calendar_token_refresh_failed",
    });

    expect(db.execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining("needs_reauth = 1"),
      args: ["acct-1"],
    }));
  });

  it("does not mark needs_reauth on a non-invalid_grant (e.g. rate limit) refresh failure", async () => {
    mocks.credentials = freshCredentials({ expires_at: Date.now() - 1000 });
    fetch.mockResolvedValueOnce(jsonResponse({ error: "rate_limit_exceeded" }, 429));

    await expect(getAuthorizedAccount(account)).rejects.toMatchObject({
      code: "calendar_token_refresh_failed",
    });

    expect(db.execute).not.toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining("needs_reauth = 1"),
    }));
  });

  it("clears needs_reauth on a successful refresh for a previously flagged account", async () => {
    mocks.credentials = freshCredentials({ expires_at: Date.now() - 1000 });
    fetch.mockResolvedValueOnce(jsonResponse({
      access_token: "token-2",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/calendar.events",
    }));

    await getAuthorizedAccount({ ...account, needs_reauth: 1 });

    expect(db.execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining("needs_reauth = 0"),
      args: ["acct-1"],
    }));
  });

  it("does not attempt to clear needs_reauth on a successful refresh when the flag was never set", async () => {
    mocks.credentials = freshCredentials({ expires_at: Date.now() - 1000 });
    fetch.mockResolvedValueOnce(jsonResponse({
      access_token: "token-2",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/calendar.events",
    }));

    await getAuthorizedAccount({ ...account, needs_reauth: 0 });

    expect(db.execute).not.toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining("needs_reauth = 0"),
    }));
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

  it("sends the token refresh request with an AbortSignal", async () => {
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

    await listCalendarsForAccount(account);

    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the generic Google Calendar API fetch with an AbortSignal", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
    }));

    await listCalendarsForAccount(account);

    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("forces a refresh when the stored expires_at is non-finite, rather than treating it as valid", async () => {
    // A malformed credential whose expires_at is non-finite must not pass the
    // guard. With the old guard `expires_at < Date.now() + ...`, a non-numeric
    // value coerces to NaN and `NaN < anything` is false, so refresh is skipped
    // and every call 401s after the real token expires. The fix treats a
    // non-finite expires_at as already-expired and forces a refresh.
    mocks.credentials = freshCredentials({ expires_at: "not-a-number" });
    fetch
      .mockResolvedValueOnce(jsonResponse({
        access_token: "token-2",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar.events",
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
      }));

    await listCalendarsForAccount(account);

    expect(fetch).toHaveBeenCalledTimes(2);
    const [refreshUrl, refreshInit] = fetch.mock.calls[0];
    expect(String(refreshUrl)).toBe("https://oauth2.googleapis.com/token");
    expect(String(refreshInit.body)).toContain("grant_type=refresh_token");
  });

  it("persists a finite expires_at (default TTL) when the refresh response omits expires_in", async () => {
    mocks.credentials = freshCredentials({ expires_at: Date.now() - 1000 });
    fetch
      .mockResolvedValueOnce(jsonResponse({
        access_token: "token-2",
        expires_in: undefined,
        scope: "https://www.googleapis.com/auth/calendar.events",
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
      }));

    const before = Date.now();
    await listCalendarsForAccount(account);

    const persistedArgs = db.execute.mock.calls.find(([call]) =>
      call.sql.includes("UPDATE ea_accounts"))[0].args;
    const persisted = JSON.parse(persistedArgs[0]);

    expect(Number.isFinite(persisted.expires_at)).toBe(true);
    // Default TTL is 3600s; allow slack for clock drift during the test.
    expect(persisted.expires_at).toBeGreaterThanOrEqual(before + 3600_000 - 1000);
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

describe("calendar-list caching", () => {
  it("serves a second call from the per-account memo without re-hitting Google", async () => {
    fetch.mockResolvedValue(jsonResponse({
      items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
    }));

    const first = await listCalendarsForAccount(account);
    const second = await listCalendarsForAccount(account);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("re-fetches after the entry is invalidated", async () => {
    fetch.mockResolvedValue(jsonResponse({
      items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
    }));

    await listCalendarsForAccount(account);
    invalidateCalendarListCache(account.id);
    await listCalendarsForAccount(account);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache the synthetic fallback when Google rejects the list", async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ error: { code: 403, message: "forbidden" } }, 403))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
      }));

    const fallback = await listCalendarsForAccount(account);
    expect(fallback[0].syntheticCalendarListFallback).toBe(true);

    // A transient error must not poison the cache: the next call retries Google.
    const recovered = await listCalendarsForAccount(account);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(recovered[0].syntheticCalendarListFallback).toBeUndefined();
  });

  it("re-fetches when the account's credentials change so re-auth scope is not served stale", async () => {
    fetch.mockResolvedValue(jsonResponse({
      items: [{ id: "primary", summary: "Primary", accessRole: "owner", primary: true }],
    }));

    // First, a read-only-scope credential caches writable=false.
    mocks.credentials = freshCredentials({ scopes: ["https://www.googleapis.com/auth/gmail.readonly"] });
    const readOnly = await listCalendarsForAccount({ ...account, credentials_encrypted: "creds-readonly" });
    expect(readOnly[0].writable).toBe(false);

    // Re-auth adds calendar write scope -> credentials_encrypted changes. The
    // cache must NOT serve the stale writable=false entry under the same id.
    mocks.credentials = freshCredentials({ scopes: ["https://www.googleapis.com/auth/calendar.events"] });
    const writable = await listCalendarsForAccount({ ...account, credentials_encrypted: "creds-write" });
    expect(writable[0].writable).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("getRawEvent auth reuse", () => {
  it("reuses a provided auth and skips the token refresh on an expired credential", async () => {
    mocks.credentials = freshCredentials({ expires_at: Date.now() - 1000 });
    fetch.mockResolvedValueOnce(jsonResponse({ id: "evt-1", summary: "Standup" }));

    const { event } = await getRawEvent(account, "primary", "evt-1", {
      auth: { accessToken: "preauth-token" },
    });

    // Only the event GET fires — no oauth2 token round-trip — and it carries the
    // caller-provided bearer rather than a freshly refreshed one.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toContain("calendars/primary/events/evt-1");
    expect(init.headers.Authorization).toBe("Bearer preauth-token");
    expect(event).toMatchObject({ id: "evt-1" });
  });

  it("falls back to getAuthorizedAccount (refreshing) when no auth is provided", async () => {
    mocks.credentials = freshCredentials({ expires_at: Date.now() - 1000 });
    fetch
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-2", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ id: "evt-1", summary: "Standup" }));

    await getRawEvent(account, "primary", "evt-1");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toBe("https://oauth2.googleapis.com/token");
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
