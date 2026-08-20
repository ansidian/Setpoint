import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");

async function applyMirrorMigration(db: Client) {
  await db.executeMultiple(readFileSync(join(migrationsDir, "011_calendar_search_mirror.sql"), "utf8"));
  await db.executeMultiple(readFileSync(join(migrationsDir, "049_calendar_mirror_snapshot_hash.sql"), "utf8"));
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

describe("Calendar Search Mirror persistence", () => {
  let db: Client | null = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
    const mirror = await import("./calendar-search-mirror.ts");
    mirror.stopCalendarSearchMirrorSyncWorker();
    vi.useRealTimers();
  });

  it("keeps a start-time occurrence identity when an event has no original start", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      listCalendarSearchMirrorOccurrences,
      upsertCalendarSearchMirrorOccurrence,
    } = await import("./calendar-search-mirror.ts");
    const eventWithoutOriginalStart = {
      ...occurrence,
      id: "event-without-original-start",
      title: "Fallback identity event",
      startMs: Date.parse("2026-05-21T17:00:00.000Z"),
      endMs: Date.parse("2026-05-21T18:00:00.000Z"),
      originalStartTime: null,
    };

    await upsertCalendarSearchMirrorOccurrence("test-user", eventWithoutOriginalStart, {
      dbClient: db,
      now: new Date("2026-05-12T19:10:00.000Z"),
      recordPendingSync: false,
    });

    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
      query: "fallback identity",
    })).resolves.toEqual([
      expect.objectContaining({
        id: "event-without-original-start",
        originalStartTime: "1779382800000",
      }),
    ]);
  });

  it("tombstones removed calendars and removes their durable source state", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      getCalendarSearchMirrorHealth,
      listCalendarSearchMirrorOccurrences,
      syncCalendarSearchMirror,
    } = await import("./calendar-search-mirror.ts");
    const workOccurrence = {
      ...occurrence,
      id: "work-event-1",
      title: "Work planning",
      source: "Work",
      calendarId: "work",
      calendarName: "Work",
      sourceColor: "#16a34a",
    };
    const listCalendars = vi.fn()
      .mockResolvedValueOnce([primaryCalendar, workCalendar])
      .mockResolvedValueOnce([primaryCalendar]);
    const syncClient = vi.fn(async ({ calendar, mode }) => ({
      events: mode === "full"
        ? [calendar.id === "primary" ? occurrence : workOccurrence]
        : [],
      nextSyncToken: `${calendar.id}-${mode}`,
    }));

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

    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-12",
      end: "2027-11-12",
      query: "work",
    })).resolves.toEqual([]);
    const occurrences = await db.execute(
      "SELECT calendar_id, status, deleted_at FROM ea_calendar_search_occurrences ORDER BY calendar_id",
    );
    expect(occurrences.rows).toEqual([
      {
        calendar_id: "primary",
        status: "confirmed",
        deleted_at: null,
      },
      {
        calendar_id: "work",
        status: "cancelled",
        deleted_at: "2026-05-12T20:00:00.000Z",
      },
    ]);
    const state = await db.execute(
      "SELECT calendar_id FROM ea_calendar_search_mirror_state ORDER BY calendar_id",
    );
    expect(state.rows).toEqual([{ calendar_id: "primary" }]);
    await expect(getCalendarSearchMirrorHealth("test-user", {
      dbClient: db,
      now: new Date("2026-05-12T20:00:00.000Z"),
    })).resolves.toMatchObject({
      sources: [expect.objectContaining({ calendarId: "primary" })],
    });
  });

  it("purges expired cancelled occurrences while retaining recent tombstones", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMirrorMigration(db);
    const {
      listCalendarSearchMirrorOccurrences,
      syncCalendarSearchMirror,
    } = await import("./calendar-search-mirror.ts");
    const listCalendars = vi.fn(async () => [primaryCalendar]);
    const syncClient = vi.fn()
      .mockResolvedValueOnce({ events: [occurrence], nextSyncToken: "sync-1" })
      .mockResolvedValueOnce({
        events: [{ ...occurrence, status: "cancelled" }],
        nextSyncToken: "sync-2",
      })
      .mockResolvedValueOnce({ events: [], nextSyncToken: "sync-3" });

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-01T19:00:00.000Z"),
      forceFull: true,
    });
    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-05-02T19:00:00.000Z"),
    });
    await expect(listCalendarSearchMirrorOccurrences("test-user", {
      dbClient: db,
      start: "2025-05-01",
      end: "2027-11-01",
    })).resolves.toEqual([]);

    const recentTombstone = await db.execute(
      "SELECT status, deleted_at FROM ea_calendar_search_occurrences WHERE event_id = 'event-1'",
    );
    expect(recentTombstone.rows).toEqual([{
      status: "cancelled",
      deleted_at: "2026-05-02T19:00:00.000Z",
    }]);

    await syncCalendarSearchMirror("test-user", [account], {
      dbClient: db,
      listCalendars,
      syncClient,
      now: new Date("2026-06-02T19:00:00.000Z"),
    });

    const expiredTombstone = await db.execute(
      "SELECT status, deleted_at FROM ea_calendar_search_occurrences WHERE event_id = 'event-1'",
    );
    expect(expiredTombstone.rows).toEqual([]);
  });
});
