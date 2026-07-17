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
      source_label: "Personal",
      event_color: "#d50000",
      searchable_text: "final presentation room 201 slides and q&a",
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
        nextSyncToken: "sync-2",
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

  it("skips rewriting an occurrence when a sync re-delivers identical event data", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const { syncCalendarSearchMirror } = await import("./calendar-search-mirror.ts");

    const listCalendars = vi.fn(async () => [primaryCalendar]);
    const syncClient = vi.fn()
      .mockResolvedValueOnce({ events: [occurrence], nextSyncToken: "sync-1" })
      .mockResolvedValueOnce({ events: [{ ...occurrence }], nextSyncToken: "sync-2" });

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T19:00:00.000Z"),
      forceFull: true,
    });
    // Incremental sync re-delivers the same event byte-for-byte.
    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T20:00:00.000Z"),
    });

    const rows = await db.execute(
      "SELECT title, updated_at, synced_at FROM ea_calendar_search_occurrences WHERE event_id = 'event-1'",
    );
    expect(rows.rows[0]).toMatchObject({
      title: "Final presentation",
      updated_at: "2026-05-12T19:00:00.000Z",
      synced_at: "2026-05-12T19:00:00.000Z",
    });
    // The sync itself still completed and advanced the token.
    const state = await db.execute("SELECT sync_token FROM ea_calendar_search_mirror_state");
    expect(state.rows[0]!.sync_token).toBe("sync-2");
  });

  it("full sync leaves already-cancelled tombstones untouched", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const { syncCalendarSearchMirror } = await import("./calendar-search-mirror.ts");

    const listCalendars = vi.fn(async () => [primaryCalendar]);
    const syncClient = vi.fn()
      .mockResolvedValueOnce({ events: [occurrence], nextSyncToken: "sync-1" })
      .mockResolvedValueOnce({ events: [], nextSyncToken: "sync-2" })
      .mockResolvedValueOnce({ events: [], nextSyncToken: "sync-3" });

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T19:00:00.000Z"),
      forceFull: true,
    });
    // Second full sync drops the event -> tombstoned at 20:00.
    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T20:00:00.000Z"),
      forceFull: true,
    });
    // Third full sync must not touch the existing tombstone again.
    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T21:00:00.000Z"),
      forceFull: true,
    });

    const rows = await db.execute(
      "SELECT status, deleted_at, updated_at FROM ea_calendar_search_occurrences WHERE event_id = 'event-1'",
    );
    expect(rows.rows[0]).toMatchObject({
      status: "cancelled",
      deleted_at: "2026-05-12T20:00:00.000Z",
      updated_at: "2026-05-12T20:00:00.000Z",
    });
  });

  it("purges cancelled tombstones older than the retention window during sync", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const { syncCalendarSearchMirror } = await import("./calendar-search-mirror.ts");

    const secondOccurrence = { ...occurrence, id: "event-2", originalStartTime: "2026-05-21T17:00:00.000Z" };
    const listCalendars = vi.fn(async () => [primaryCalendar]);
    const syncClient = vi.fn()
      .mockResolvedValueOnce({ events: [occurrence, secondOccurrence], nextSyncToken: "sync-1" })
      .mockResolvedValueOnce({ events: [], nextSyncToken: "sync-2" })
      .mockResolvedValueOnce({ events: [], nextSyncToken: "sync-3" });

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
      forceFull: true,
    });
    // Backdate event-1's tombstone past the retention window; event-2 stays fresh.
    await db.execute({
      sql: "UPDATE ea_calendar_search_occurrences SET deleted_at = ? WHERE event_id = 'event-1'",
      args: ["2026-03-01T00:00:00.000Z"],
    });

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T21:00:00.000Z"),
      forceFull: true,
    });

    const rows = await db.execute(
      "SELECT event_id, status FROM ea_calendar_search_occurrences ORDER BY event_id",
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({ event_id: "event-2", status: "cancelled" }),
    ]);
  });

  it("tombstones mirror rows for calendars that are no longer selected", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      listCalendarSearchMirrorOccurrences,
      syncCalendarSearchMirror,
    } = await import("./calendar-search-mirror.ts");

    const workOccurrence = {
      ...occurrence,
      id: "work-1",
      title: "Work",
      calendarId: "work",
      calendarName: "Work",
      source: "Work",
      sourceColor: "#16a34a",
      originalStartTime: "2026-05-21T17:00:00.000Z",
    };
    const listCalendars = vi.fn()
      .mockResolvedValueOnce([primaryCalendar, workCalendar])
      .mockResolvedValueOnce([primaryCalendar]);
    const syncClient = vi.fn(async ({ calendar }) => ({
      events: calendar.id === "work" ? [workOccurrence] : [],
      nextSyncToken: `sync-${calendar.id}`,
    }));

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T19:00:00.000Z"),
      forceFull: true,
    });
    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
      query: "work",
    })).resolves.toEqual([
      expect.objectContaining({ id: "work-1", calendarId: "work" }),
    ]);

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-12T20:00:00.000Z"),
      forceFull: true,
    });

    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
      query: "work",
    })).resolves.toEqual([]);
    const state = await db.execute("SELECT calendar_id FROM ea_calendar_search_mirror_state ORDER BY calendar_id");
    expect(state.rows.map((row) => row.calendar_id)).toEqual(["primary"]);
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

  it("tombstones expanded recurring family rows when an incremental delete returns the series master", async () => {
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
    const deletedSeriesMaster = {
      ...occurrence,
      id: "series-work",
      title: "Work",
      startMs: 0,
      endMs: 0,
      originalStartTime: null,
      recurringEventId: null,
      recurringKind: null,
      status: "cancelled",
    };
    const syncClient = vi.fn()
      .mockResolvedValueOnce({
        events: [staleFutureOccurrence],
        nextSyncToken: "sync-1",
      })
      .mockResolvedValueOnce({
        events: [deletedSeriesMaster],
        nextSyncToken: "sync-2",
      });

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars: vi.fn(async () => [primaryCalendar]),
      syncClient,
      now: new Date("2026-05-12T19:00:00.000Z"),
      forceFull: true,
    });
    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars: vi.fn(async () => [primaryCalendar]),
      syncClient,
      now: new Date("2026-05-12T20:00:00.000Z"),
    });

    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
      query: "work",
    })).resolves.toEqual([]);
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

  it("centers mirrored occurrence reads around today so old rows cannot consume the limit", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      listCalendarSearchMirrorOccurrences,
      upsertCalendarSearchMirrorOccurrence,
    } = await import("./calendar-search-mirror.ts");

    const rows: Array<[string, string]> = [
      ["work-old-1", "2025-07-25T17:00:00.000Z"],
      ["work-old-2", "2025-07-26T17:00:00.000Z"],
      ["work-old-3", "2025-07-27T17:00:00.000Z"],
      ["work-yesterday", "2026-05-11T17:00:00.000Z"],
      ["work-today", "2026-05-12T17:00:00.000Z"],
      ["work-tomorrow", "2026-05-13T17:00:00.000Z"],
    ];
    for (const [id, start] of rows) {
      await upsertCalendarSearchMirrorOccurrence("test-user", {
        ...occurrence,
        id,
        title: "Work",
        startMs: Date.parse(start),
        endMs: Date.parse(start) + 60 * 60 * 1000,
        originalStartTime: start,
      }, {
        dbClient: db,
        recordPendingSync: false,
      });
    }

    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
      query: "work",
      limit: 3,
      centerDate: "2026-05-12",
    })).resolves.toEqual([
      expect.objectContaining({ id: "work-today" }),
      expect.objectContaining({ id: "work-yesterday" }),
      expect.objectContaining({ id: "work-tomorrow" }),
    ]);
  });

  it("matches LIKE metacharacters (_ and %) literally instead of as wildcards", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      listCalendarSearchMirrorOccurrences,
      upsertCalendarSearchMirrorOccurrence,
    } = await import("./calendar-search-mirror.ts");

    const rows = [
      ["lit-underscore", "design a_b review"],
      ["axb-decoy", "design axb review"],
      ["lit-percent", "budget 50% done"],
      ["plain-decoy", "budget anything done"],
    ];
    for (const [id, title] of rows) {
      await upsertCalendarSearchMirrorOccurrence("test-user", {
        ...occurrence,
        id,
        title,
        location: "",
        description: "",
        originalStartTime: `2026-05-20T17:00:00.000Z#${id}`,
      }, {
        dbClient: db,
        recordPendingSync: false,
      });
    }

    // `a_b` must match only the literal underscore row, not `axb`.
    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
      query: "a_b",
    })).resolves.toEqual([
      expect.objectContaining({ id: "lit-underscore" }),
    ]);

    // `50%` must match only the literal percent row, not act as a match-anything wildcard.
    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
      query: "50%",
    })).resolves.toEqual([
      expect.objectContaining({ id: "lit-percent" }),
    ]);
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

describe("addMonthsIso (P3-40 month-end clamp)", () => {
  it("clamps day-of-month to the target month's last day instead of overflowing", async () => {
    const { addMonthsIso } = await import("./calendar-search-mirror.ts");
    // Jan 31 + 1mo would naively roll to Mar 3; clamp keeps it inside February.
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-03-31", -1)).toBe("2026-02-28");
    // Leap-year February still resolves to its real last day.
    expect(addMonthsIso("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("lands the +18mo / -12mo search window on the correct boundary from a month-end anchor", async () => {
    const { addMonthsIso } = await import("./calendar-search-mirror.ts");
    // Aug 31 anchor: +18mo lands in a leap February (29th), -12mo stays on the 31st.
    expect(addMonthsIso("2026-08-31", 18)).toBe("2028-02-29");
    expect(addMonthsIso("2026-08-31", -12)).toBe("2025-08-31");
    // May 31 + 18mo lands in 30-day November, clamped to the 30th.
    expect(addMonthsIso("2026-05-31", 18)).toBe("2027-11-30");
  });

  it("leaves non-overflowing dates unchanged", async () => {
    const { addMonthsIso } = await import("./calendar-search-mirror.ts");
    expect(addMonthsIso("2026-05-12", 18)).toBe("2027-11-12");
    expect(addMonthsIso("2026-05-12", -12)).toBe("2025-05-12");
  });
});
