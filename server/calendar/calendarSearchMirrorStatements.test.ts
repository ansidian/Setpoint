import { describe, it, expect } from "vitest";
import {
  normalizeText,
  mirrorOccurrenceStatement,
  upsertStateStatement,
  stateSuccessStatement,
  purgeExpiredTombstonesStatement,
  tombstoneCalendarStatement,
  tombstoneRecurringFamilyStatement,
  tombstoneUnlistedCalendarStatements,
} from "./calendarSearchMirrorStatements.ts";

describe("normalizeText", () => {
  it("normalizeText trims, lowercases, and collapses whitespace", () => {
    expect(normalizeText("  Final   Presentation\n Room ")).toBe("final presentation room");
    expect(normalizeText(null)).toBe("");
  });
});

describe("mirrorOccurrenceStatement", () => {
  it("derives occurrence key, searchable text, status, and deletedAt for a live event", () => {
    const stmt = mirrorOccurrenceStatement("u1", {
      id: "e1",
      accountId: "a1",
      calendarId: "c1",
      title: "Final Presentation",
      location: "Room 201",
      description: "Q&A",
      startMs: 1000,
      endMs: 2000,
      allDay: false,
      originalStartTime: "2026-05-20T17:00:00.000Z",
    }, "T");
    expect(stmt.args[4]).toBe("2026-05-20T17:00:00.000Z"); // occurrenceKey: originalStartTime wins
    expect(stmt.args[13]).toBe(0); // boolInt(allDay)
    expect(stmt.args[23]).toBe(1); // boolInt(... || originalStartTime) -> recurring-ish
    expect(stmt.args[24]).toBe("confirmed"); // status default
    expect(stmt.args[25]).toBe("final presentation room 201 q&a"); // searchableText
    expect(stmt.args[28]).toBeNull(); // deletedAt null when not cancelled
    expect(stmt.sql).toContain("INSERT INTO ea_calendar_search_occurrences");
    expect(stmt.sql).toContain("ON CONFLICT(user_id, account_id, calendar_id, event_id, original_start_key)");
  });

  it("stamps deletedAt and cancelled status for a cancelled event, keying off startMs when no originalStartTime", () => {
    const stmt = mirrorOccurrenceStatement("u1", { id: "e2", status: "cancelled", startMs: 5 }, "T");
    expect(stmt.args[4]).toBe("5"); // occurrenceKey falls back to startMs
    expect(stmt.args[24]).toBe("cancelled");
    expect(stmt.args[28]).toBe("T"); // deletedAt stamped
  });
});

describe("stateSuccessStatement (P2-20 lost-update guard)", () => {
  it("records full vs incremental timestamps and guards newer dirty/requested values via CASE", () => {
    const full = stateSuccessStatement("u1", { id: "a1" }, { id: "c1" }, { nextSyncToken: "tok" }, "T", true);
    expect(full.args).toEqual(["tok", "T", "T", "T", null, "T", "T", "T", "T", "T", "u1", "a1", "c1"]);
    expect(full.sql).toContain("dirty_since = CASE WHEN dirty_since IS NOT NULL AND dirty_since > ? THEN dirty_since ELSE NULL END");

    const incremental = stateSuccessStatement("u1", { id: "a1" }, { id: "c1" }, { syncToken: "tok2" }, "T", false);
    expect(incremental.args[0]).toBe("tok2"); // falls back to syncToken
    expect(incremental.args[3]).toBeNull(); // last_full_sync_at
    expect(incremental.args[4]).toBe("T"); // last_incremental_sync_at
  });
});

describe("upsert/tombstone builders", () => {
  it("upsertStateStatement carries window bounds and labels", () => {
    const stmt = upsertStateStatement("u1", { id: "a1", label: "Main", email: "me@x.test" }, { id: "c1", summary: "Personal", backgroundColor: "#fff" }, { start: "2025-01-01", end: "2027-01-01" }, "T");
    expect(stmt.args).toEqual(["u1", "a1", "c1", "Main", "me@x.test", "Personal", "#fff", "2025-01-01", "2027-01-01", "T"]);
  });
  it("tombstoneCalendarStatement cancels only not-yet-cancelled rows for the calendar", () => {
    const stmt = tombstoneCalendarStatement("u1", { id: "a1" }, { id: "c1" }, "T");
    expect(stmt.args).toEqual(["T", "T", "u1", "a1", "c1"]);
    expect(stmt.sql).toContain("status != 'cancelled'");
  });
  it("tombstoneRecurringFamilyStatement matches the family by event_id or recurring_event_id", () => {
    const stmt = tombstoneRecurringFamilyStatement("u1", { id: "a1" }, { id: "c1" }, { id: "ev", recurringEventId: "series" }, "T");
    expect(stmt.args).toEqual(["T", "T", "u1", "a1", "c1", "series", "series"]);
  });
  it("purgeExpiredTombstonesStatement deletes only cancelled rows older than the cutoff", () => {
    const stmt = purgeExpiredTombstonesStatement("u1", "2026-04-12T00:00:00.000Z");
    expect(stmt.args).toEqual(["u1", "2026-04-12T00:00:00.000Z"]);
    expect(stmt.sql).toContain("status = 'cancelled'");
    expect(stmt.sql).toContain("deleted_at < ?");
  });
  it("tombstoneUnlistedCalendarStatements returns the cancel + state-delete pair", () => {
    const [cancel, del] = tombstoneUnlistedCalendarStatements("u1", { id: "a1" }, "c-stale", "T");
    expect(cancel.sql).toContain("status != 'cancelled'");
    expect(del.sql).toContain("DELETE FROM ea_calendar_search_mirror_state");
    expect(del.args).toEqual(["u1", "a1", "c-stale"]);
  });
});
