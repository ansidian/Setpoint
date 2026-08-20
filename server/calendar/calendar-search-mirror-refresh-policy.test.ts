import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";
import { syncCalendarSearchMirror } from "./calendar-search-mirror.ts";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../db/migrations");

const account = {
  id: "gmail-main",
  label: "Google Main",
  email: "me@example.com",
  type: "gmail",
  calendar_enabled: 1,
};

const holidayCalendar = {
  id: "en.usa#holiday@group.v.calendar.google.com",
  summary: "Holidays in United States",
  backgroundColor: "#0b8043",
};

const holidayOccurrence = {
  id: "holiday-1",
  title: "Holiday",
  startMs: Date.parse("2026-05-25T07:00:00.000Z"),
  endMs: Date.parse("2026-05-26T07:00:00.000Z"),
  accountId: account.id,
  calendarId: holidayCalendar.id,
  allDay: true,
};

describe("calendar search mirror refresh policy", () => {
  let db: Client | null = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("stores Google holidays as a daily content-addressed snapshot without using their invalid sync tokens", async () => {
    db = createClient({ url: "file::memory:" });
    await db.executeMultiple(readFileSync(join(migrationsDir, "011_calendar_search_mirror.sql"), "utf8"));
    await db.executeMultiple(readFileSync(join(migrationsDir, "049_calendar_mirror_snapshot_hash.sql"), "utf8"));
    let providerFetch = 0;
    const syncClient = async ({ syncToken }: { syncToken: string | null }) => {
      providerFetch += 1;
      return syncToken
        ? { events: [{ ...holidayOccurrence, id: "unexpected-incremental" }], nextSyncToken: "unexpected-sync" }
        : { events: [holidayOccurrence], nextSyncToken: `invalid-holiday-sync-${providerFetch}` };
    };
    const options = {
      dbClient: db,
      listCalendars: async () => [holidayCalendar],
      syncClient,
    };

    const initial = await syncCalendarSearchMirror("test-user", [account], {
      ...options,
      now: new Date("2026-05-12T19:00:00.000Z"),
      forceFull: true,
    });
    const reused = await syncCalendarSearchMirror("test-user", [account], {
      ...options,
      now: new Date("2026-05-12T20:00:00.000Z"),
    });
    const refreshed = await syncCalendarSearchMirror("test-user", [account], {
      ...options,
      now: new Date("2026-05-13T20:00:00.000Z"),
    });

    expect(initial.occurrences).toBe(1);
    expect(reused.occurrences).toBe(0);
    expect(refreshed.occurrences).toBe(1);
    const state = await db.execute(
      "SELECT sync_token, snapshot_hash, last_full_sync_at, last_sync_at FROM ea_calendar_search_mirror_state",
    );
    expect(state.rows[0]).toMatchObject({
      sync_token: null,
      last_full_sync_at: "2026-05-13T20:00:00.000Z",
      last_sync_at: "2026-05-13T20:00:00.000Z",
    });
    expect(String(state.rows[0]!.snapshot_hash)).toHaveLength(64);
    const occurrences = await db.execute(
      "SELECT event_id, updated_at FROM ea_calendar_search_occurrences ORDER BY event_id",
    );
    expect(occurrences.rows).toEqual([{
      event_id: "holiday-1",
      updated_at: "2026-05-12T19:00:00.000Z",
    }]);
  });
});
