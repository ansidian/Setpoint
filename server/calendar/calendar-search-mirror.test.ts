import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");

async function applyMirrorMigration(db: Client) {
  await db.executeMultiple(readFileSync(join(migrationsDir, "011_calendar_search_mirror.sql"), "utf8"));
}

const account = {
  id: "gmail-main",
  label: "Google Main",
  email: "me@example.com",
  type: "gmail",
  calendar_enabled: 1,
};

const primaryCalendar = {
  id: "primary",
  summary: "Personal",
  backgroundColor: "#4285f4",
};

const workCalendar = {
  id: "work",
  summary: "Work",
  backgroundColor: "#16a34a",
};

const occurrence = {
  id: "event-1",
  title: "Final presentation",
  location: "Room 201",
  description: "Slides and Q&A",
  startMs: Date.parse("2026-05-20T17:00:00.000Z"),
  endMs: Date.parse("2026-05-20T18:00:00.000Z"),
  time: "10:00 AM",
  duration: "1h",
  source: "Personal",
  sourceColor: "#4285f4",
  color: "#d50000",
  colorId: "11",
  accountId: "gmail-main",
  accountLabel: "Google Main",
  accountEmail: "me@example.com",
  calendarId: "primary",
  calendarName: "Personal",
  allDay: false,
  originalStartTime: "2026-05-20T17:00:00.000Z",
  openUrl: "https://calendar.google.com/event",
};

describe("Calendar Search Mirror service", () => {
  let db: Client | null = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
    const mirror = await import("./calendar-search-mirror.ts");
    mirror.stopCalendarSearchMirrorSyncWorker();
    vi.useRealTimers();
  });

  it("preserves a dirty_since that lands during the sync fetch (P2-20 lost-update guard)", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-05-12T19:00:00.000Z");
    vi.setSystemTime(now);
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const { syncCalendarSearchMirror } = await import("./calendar-search-mirror.ts");

    const laterDirty = "2026-05-12T19:00:05.000Z"; // a write landing 5s into the fetch
    const listCalendars = vi.fn(async () => [primaryCalendar]);
    // Simulate a recurring-event edit marking the row dirty (newer than the sync
    // start) WHILE the Google round-trip is still in flight.
    const syncClient = vi.fn(async ({ calendar, window }) => {
      await db!.execute({
        sql: `UPDATE ea_calendar_search_mirror_state
              SET dirty_since = ?, dirty_reason = 'recurring-edit'
              WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
        args: [laterDirty, "test-user", account.id, calendar.id],
      });
      return { events: [occurrence], nextSyncToken: `sync-${calendar.id}`, window };
    });

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now,
    });

    const state = await db.execute({
      sql: `SELECT dirty_since FROM ea_calendar_search_mirror_state
            WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
      args: ["test-user", account.id, "primary"],
    });
    // The write landed after sync start, so the success update must not clear it,
    // otherwise the mirror would serve stale occurrences with no follow-up sync.
    expect(state.rows[0]!.dirty_since).toBe(laterDirty);
  });

  it("full-syncs enabled Google calendars into searchable occurrence rows and current health", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T19:00:00.000Z"));
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      getCalendarSearchMirrorHealth,
      listCalendarSearchMirrorOccurrences,
      syncCalendarSearchMirror,
    } = await import("./calendar-search-mirror.ts");

    const listCalendars = vi.fn(async () => [primaryCalendar, workCalendar]);
    const syncClient = vi.fn(async ({ calendar, window }) => ({
      events: calendar.id === "primary" ? [occurrence] : [],
      nextSyncToken: `sync-${calendar.id}`,
      window,
    }));

    const result = await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T19:00:00.000Z"),
      forceFull: true,
    });

    expect(result).toMatchObject({
      status: "current",
      fullSync: true,
      calendars: 2,
      occurrences: 1,
    });
    expect(syncClient).toHaveBeenCalledWith(expect.objectContaining({
      account,
      calendar: primaryCalendar,
      syncToken: null,
      mode: "full",
      window: { start: "2025-05-12", end: "2027-11-12" },
    }));

    const rows = await db.execute("SELECT * FROM ea_calendar_search_occurrences");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      user_id: "test-user",
      account_id: "gmail-main",
      calendar_id: "primary",
      event_id: "event-1",
      original_start_key: "2026-05-20T17:00:00.000Z",
      title: "Final presentation",
      location: "Room 201",
      all_day: 0,
      source_label: "Personal",
      event_color: "#d50000",
      is_recurring: 1,
      status: "confirmed",
      searchable_text: "final presentation room 201 slides and q&a",
      deleted_at: null,
    });

    const occurrences = await listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
    });
    expect(occurrences).toEqual([
      expect.objectContaining({
        id: "event-1",
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Final presentation",
        source: "Personal",
        color: "#d50000",
        originalStartTime: "2026-05-20T17:00:00.000Z",
      }),
    ]);

    const health = await getCalendarSearchMirrorHealth("test-user", {
      dbClient: db,
      now: new Date("2026-05-12T19:00:00.000Z"),
    });
    expect(health).toMatchObject({
      state: "current",
      configured: true,
      severity: "none",
      sources: [
        expect.objectContaining({
          accountId: "gmail-main",
          calendarId: "primary",
          accountLabel: "Google Main",
          accountEmail: "me@example.com",
          calendarLabel: "Personal",
          sourceColor: "#4285f4",
          state: "current",
          windowStart: "2025-05-12",
          windowEnd: "2027-11-12",
        }),
        expect.objectContaining({
          accountId: "gmail-main",
          calendarId: "work",
          state: "current",
        }),
      ],
    });
  });

  it("uses stored sync tokens for incremental sync and hides cancelled occurrences", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      listCalendarSearchMirrorOccurrences,
      syncCalendarSearchMirror,
    } = await import("./calendar-search-mirror.ts");

    const listCalendars = vi.fn(async () => [primaryCalendar]);
    const syncClient = vi.fn()
      .mockResolvedValueOnce({
        events: [occurrence],
        nextSyncToken: "sync-1",
      })
      .mockResolvedValueOnce({
        events: [{ ...occurrence, status: "cancelled" }],
        syncToken: "sync-2",
      });

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T19:00:00.000Z"),
      forceFull: true,
    });
    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T20:00:00.000Z"),
    });

    expect(syncClient).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: "incremental",
      syncToken: "sync-1",
    }));
    const rows = await db.execute(
      "SELECT status, deleted_at FROM ea_calendar_search_occurrences WHERE event_id = 'event-1'",
    );
    expect(rows.rows[0]).toMatchObject({
      status: "cancelled",
      deleted_at: "2026-05-12T20:00:00.000Z",
    });
    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
    })).resolves.toEqual([]);

    const state = await db.execute("SELECT sync_token, last_incremental_sync_at FROM ea_calendar_search_mirror_state");
    expect(state.rows[0]).toMatchObject({
      sync_token: "sync-2",
      last_incremental_sync_at: "2026-05-12T20:00:00.000Z",
    });
  });

  it("repairs expired incremental tokens with a safe full sync", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const { syncCalendarSearchMirror } = await import("./calendar-search-mirror.ts");

    const replacement = { ...occurrence, id: "event-2", title: "Replacement event" };
    const listCalendars = vi.fn(async () => [primaryCalendar]);
    const syncClient = vi.fn()
      .mockResolvedValueOnce({
        events: [occurrence],
        nextSyncToken: "sync-1",
      })
      .mockRejectedValueOnce(Object.assign(new Error("Sync token expired"), {
        status: 410,
        code: "calendar_sync_token_invalid",
      }))
      .mockResolvedValueOnce({
        events: [replacement],
        nextSyncToken: "sync-repaired",
      });

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T19:00:00.000Z"),
      forceFull: true,
    });
    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T20:00:00.000Z"),
    });

    expect(syncClient.mock.calls[1]![0]).toMatchObject({
      mode: "incremental",
      syncToken: "sync-1",
    });
    expect(syncClient.mock.calls[2]![0]).toMatchObject({
      mode: "full",
      syncToken: null,
    });
    const rows = await db.execute(
      "SELECT event_id, status FROM ea_calendar_search_occurrences ORDER BY event_id",
    );
    expect(rows.rows.map((row) => ({ event_id: row.event_id, status: row.status }))).toEqual([
      { event_id: "event-1", status: "cancelled" },
      { event_id: "event-2", status: "confirmed" },
    ]);
    const state = await db.execute("SELECT sync_token, last_full_sync_at, last_error FROM ea_calendar_search_mirror_state");
    expect(state.rows[0]).toMatchObject({
      sync_token: "sync-repaired",
      last_full_sync_at: "2026-05-12T20:00:00.000Z",
      last_error: null,
    });
  });

  it("repairs recurring series changes with a full sync so stale future occurrences do not survive", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      listCalendarSearchMirrorOccurrences,
      syncCalendarSearchMirror,
    } = await import("./calendar-search-mirror.ts");

    const staleFutureOccurrence = {
      ...occurrence,
      id: "series-work-20260701",
      title: "Work",
      startMs: Date.parse("2026-07-01T17:00:00.000Z"),
      endMs: Date.parse("2026-07-01T18:00:00.000Z"),
      originalStartTime: "2026-07-01T17:00:00.000Z",
      recurringEventId: "series-work",
      recurringKind: "instance",
    };
    const changedSeriesMaster = {
      ...occurrence,
      id: "series-work",
      title: "Work",
      startMs: Date.parse("2026-05-01T17:00:00.000Z"),
      endMs: Date.parse("2026-05-01T18:00:00.000Z"),
      originalStartTime: null,
      recurringEventId: "series-work",
      recurringKind: "series",
      recurrence: { frequency: "weekly", interval: 1, ends: { type: "never" } },
    };
    const listCalendars = vi.fn(async () => [primaryCalendar]);
    const syncClient = vi.fn()
      .mockResolvedValueOnce({
        events: [staleFutureOccurrence],
        nextSyncToken: "sync-1",
      })
      .mockResolvedValueOnce({
        events: [changedSeriesMaster],
        nextSyncToken: "sync-2",
      })
      .mockResolvedValueOnce({
        events: [],
        nextSyncToken: "sync-repaired",
      });

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T19:00:00.000Z"),
      forceFull: true,
    });
    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T20:00:00.000Z"),
    });

    expect(syncClient.mock.calls[1]![0]).toMatchObject({
      mode: "incremental",
      syncToken: "sync-1",
    });
    expect(syncClient.mock.calls[2]![0]).toMatchObject({
      mode: "full",
      syncToken: null,
    });
    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
      query: "work",
    })).resolves.toEqual([]);
    const state = await db.execute("SELECT sync_token, last_full_sync_at FROM ea_calendar_search_mirror_state");
    expect(state.rows[0]).toMatchObject({
      sync_token: "sync-repaired",
      last_full_sync_at: "2026-05-12T20:00:00.000Z",
    });
  });

  it("records transient failures without wiping last successful mirror rows", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      getCalendarSearchMirrorHealth,
      listCalendarSearchMirrorOccurrences,
      syncCalendarSearchMirror,
    } = await import("./calendar-search-mirror.ts");

    const listCalendars = vi.fn(async () => [primaryCalendar]);
    const syncClient = vi.fn()
      .mockResolvedValueOnce({
        events: [occurrence],
        nextSyncToken: "sync-1",
      })
      .mockRejectedValueOnce(new Error("Google temporarily unavailable"));

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T19:00:00.000Z"),
      forceFull: true,
    });
    await expect(syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-13T20:00:00.000Z"),
    })).rejects.toThrow("Google temporarily unavailable");

    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
    })).resolves.toEqual([
      expect.objectContaining({ id: "event-1", title: "Final presentation" }),
    ]);
    const health = await getCalendarSearchMirrorHealth("test-user", {
      dbClient: db,
      now: new Date("2026-05-13T20:00:00.000Z"),
    });
    expect(health).toMatchObject({
      state: "stale",
      severity: "warning",
      sources: [
        expect.objectContaining({
          state: "stale",
          lastError: "Google temporarily unavailable",
          failedCheckCount: 1,
        }),
      ],
    });
  });

  it("reflects simple local writes immediately and marks the mirror dirty", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      deleteCalendarSearchMirrorOccurrence,
      getCalendarSearchMirrorHealth,
      listCalendarSearchMirrorOccurrences,
      syncCalendarSearchMirror,
      upsertCalendarSearchMirrorOccurrence,
    } = await import("./calendar-search-mirror.ts");

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars: vi.fn(async () => [primaryCalendar]),
      syncClient: vi.fn(async () => ({ events: [], nextSyncToken: "sync-1" })),
      now: new Date("2026-05-12T19:00:00.000Z"),
      forceFull: true,
    });

    await upsertCalendarSearchMirrorOccurrence("test-user", occurrence, {
      dbClient: db,
      now: new Date("2026-05-12T19:10:00.000Z"),
    });
    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
    })).resolves.toEqual([
      expect.objectContaining({ id: "event-1", title: "Final presentation" }),
    ]);
    await upsertCalendarSearchMirrorOccurrence("test-user", {
      ...occurrence,
      title: "Updated final presentation",
      description: "Updated slides and Q&A",
    }, {
      dbClient: db,
      now: new Date("2026-05-12T19:15:00.000Z"),
    });
    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
      query: "updated",
    })).resolves.toEqual([
      expect.objectContaining({ id: "event-1", title: "Updated final presentation" }),
    ]);
    await expect(getCalendarSearchMirrorHealth("test-user", {
      dbClient: db,
      now: new Date("2026-05-12T19:10:00.000Z"),
    })).resolves.toMatchObject({
      state: "dirty",
      sources: [expect.objectContaining({ dirtyReason: "calendar-write" })],
    });

    await deleteCalendarSearchMirrorOccurrence("test-user", {
      dbClient: db,
      accountId: "gmail-main",
      calendarId: "primary",
      eventId: "event-1",
      originalStartTime: "2026-05-20T17:00:00.000Z",
      now: new Date("2026-05-12T19:20:00.000Z"),
    });
    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
    })).resolves.toEqual([]);
  });

  it("runs a queued first-search mirror sync without blocking the caller", async () => {
    vi.useFakeTimers();
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      requestCalendarSearchMirrorSync,
    } = await import("./calendar-search-mirror.ts");

    const recordSyncRequestFn = vi.fn(async () => ({ recorded: true }));
    const loadConfigFn = vi.fn(async () => ({ accounts: [account] }));
    const syncFn = vi.fn(async () => ({ status: "current", synced: true }));

    const queued = requestCalendarSearchMirrorSync("test-user", {
      reason: "calendar-search-initializing",
      debounceMs: 25,
      forceFull: true,
      recordSyncRequestFn,
      loadConfigFn,
      syncFn,
    });

    expect(queued).toEqual({ queued: true, coalesced: false });
    expect(syncFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);

    expect(recordSyncRequestFn).toHaveBeenCalledWith("test-user", {
      reason: "calendar-search-initializing",
    });
    expect(loadConfigFn).toHaveBeenCalledWith("test-user");
    expect(syncFn).toHaveBeenCalledWith("test-user", [account], {
      forceFull: true,
    });
  });

  it("starts a backstop worker that requests startup and interval syncs", async () => {
    vi.useFakeTimers();
    const {
      CALENDAR_SEARCH_MIRROR_SYNC_BACKSTOP_MS,
      startCalendarSearchMirrorSyncWorker,
    } = await import("./calendar-search-mirror.ts");

    const getHealthFn = vi.fn(async () => ({
      state: "initializing",
      configured: true,
      sources: [],
    }));
    const requestSyncFn = vi.fn(() => ({ queued: true }));

    expect(startCalendarSearchMirrorSyncWorker({
      userId: "test-user",
      intervalMs: CALENDAR_SEARCH_MIRROR_SYNC_BACKSTOP_MS,
      getHealthFn,
      requestSyncFn,
    })).toEqual({ started: true });

    await vi.waitFor(() => {
      expect(requestSyncFn).toHaveBeenCalledWith("test-user", {
        reason: "calendar-search-startup",
        debounceMs: 0,
        forceFull: true,
      });
    });

    await vi.advanceTimersByTimeAsync(CALENDAR_SEARCH_MIRROR_SYNC_BACKSTOP_MS);
    expect(requestSyncFn).toHaveBeenCalledWith("test-user", {
      reason: "calendar-search-backstop",
    });
  });
});
