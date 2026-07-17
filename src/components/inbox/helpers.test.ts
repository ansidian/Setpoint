import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectActiveSnapshotEmails,
  buildSnoozePresets,
  defaultSnoozeTs,
  pendingSecurityGraceLabel,
} from "./helpers";
import { makeActiveSnapshot } from "./test-utils/inboxFixtures";

// Renders an epoch-ms value as "YYYY-MM-DD HH:mm" wall-clock in a given TZ so
// the snooze assertions read in human terms instead of raw epoch math.
function wallClock(epochMs: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(epochMs)).replace(",", "");
}

describe("inbox helpers", () => {
  it("builds the fixed-duration snooze presets in increasing order", () => {
    expect(buildSnoozePresets(0)).toEqual([
      { key: "1h", label: "1 hour", at: 3_600_000 },
      { key: "6h", label: "6 hours", at: 21_600_000 },
      { key: "24h", label: "24 hours", at: 86_400_000 },
      { key: "3d", label: "3 days", at: 259_200_000 },
      { key: "1w", label: "1 week", at: 604_800_000 },
    ]);
  });

  it("treats resurfaced snapshot rows as untriaged snoozed rows sorted by wake metadata", () => {
    const activeSnapshot = makeActiveSnapshot({
      lanes: {
        needs_attention: [{
          id: 11,
          snapshot_item_id: 11,
          uid: "snapshot-resurfaced",
          email_id: "snapshot-resurfaced",
          account_id: "gmail-work",
          lane: "needs_attention",
          subject: "Wake this thread",
          from_name: "Casey",
          from_address: "casey@example.test",
          summary: "Follow up",
          date: "2026-05-02T15:00:00.000Z",
          read: false,
          source: "resurfaced_snooze",
          source_at: "2026-05-04T17:30:00.000Z",
          resurfaced_at: 1777915800000,
        }],
        fyi: [],
        noise: [],
      },
      carryover: [],
    });

    const rows = collectActiveSnapshotEmails(activeSnapshot);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      uid: "snapshot-resurfaced",
      _untriaged: true,
      _live: false,
      _activeSnapshot: true,
      _resurfaced: true,
      _resurfacedAt: 1777915800000,
      _lane: null,
    });
  });

  it("treats pending weak-security grace rows as active snapshot live rows", () => {
    const activeSnapshot = makeActiveSnapshot({
      lanes: {
        needs_attention: [{
          id: 12,
          snapshot_item_id: 12,
          uid: "security-pending",
          email_id: "security-pending",
          account_id: "gmail-work",
          lane: "needs_attention",
          subject: "New sign-in to your account",
          from_name: "Account Security",
          from_address: "security@example.com",
          summary: "Security triage pending.",
          date: "2026-05-02T15:00:00.000Z",
          read: false,
          source: "pending_security_grace",
          source_at: "2026-05-03T16:05:00.000Z",
        }],
        fyi: [],
        noise: [],
      },
      carryover: [],
    });

    const rows = collectActiveSnapshotEmails(activeSnapshot, {});

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      uid: "security-pending",
      _untriaged: true,
      _live: false,
      _activeSnapshot: true,
      _lane: null,
      _pendingSecurityGrace: true,
      // The countdown label is no longer baked here; it is derived live in the
      // row/reader from _pendingSecurityGraceAt + nowTick.
      _pendingSecurityGraceAt: Date.parse("2026-05-03T16:05:00.000Z"),
    });
    expect(rows[0]!._pendingSecurityGraceLabel).toBeUndefined();
  });

  it("collects handled snapshot rows as handled lane review rows", () => {
    const activeSnapshot = makeActiveSnapshot({
      lanes: {
        needs_attention: [],
        fyi: [],
        handled: [{
          id: 13,
          snapshot_item_id: 13,
          uid: "handled-thread",
          email_id: "handled-thread",
          account_id: "gmail-work",
          lane: "needs_attention",
          handled_at: "2026-05-03T16:10:00.000Z",
          subject: "Resolved contract",
          from_name: "Avery",
          from_address: "avery@example.test",
          summary: "Done.",
          date: "2026-05-02T15:00:00.000Z",
          read: true,
        }],
        noise: [],
      },
      carryover: [],
    });

    const rows = collectActiveSnapshotEmails(activeSnapshot);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      uid: "handled-thread",
      _activeSnapshot: true,
      _untriaged: false,
      _lane: "handled",
      handled_at: "2026-05-03T16:10:00.000Z",
    });
  });

  it("collects catch-up snapshot rows as Catch-up while read overrides only change read state", () => {
    const activeSnapshot = makeActiveSnapshot({
      lanes: {
        needs_attention: [],
        catch_up: [{
          id: "catch_up:14",
          snapshot_item_id: 14,
          uid: "late-fyi",
          email_id: "late-fyi",
          account_id: "gmail-work",
          lane: "catch_up",
          lane_at_snapshot: "fyi",
          subject: "Late FYI",
          from_name: "Sam",
          from_address: "sam@example.test",
          summary: "Arrived late last snapshot.",
          category: "updates",
          date: "2026-05-02T15:00:00.000Z",
          read: false,
          source: "catch_up",
        }],
        fyi: [],
        noise: [],
      },
      carryover: [],
    });

    const rows = collectActiveSnapshotEmails(activeSnapshot, { "late-fyi": true });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      uid: "late-fyi",
      _activeSnapshot: true,
      _untriaged: false,
      _lane: "catch_up",
      lane: "catch_up",
      lane_at_snapshot: "fyi",
      read: true,
      _catchUp: true,
    });
  });

  describe("defaultSnoozeTs", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // PDT instant (summer, UTC-7): 2026-07-15 14:00 Pacific. Next Pacific day is
    // the 16th, so the default snooze must land at 2026-07-16 09:00 Pacific
    // regardless of the host machine's local timezone.
    it("snoozes to 9:00 the next Pacific day during PDT", () => {
      vi.setSystemTime(new Date("2026-07-15T21:00:00.000Z")); // 14:00 PDT

      const ts = defaultSnoozeTs();

      expect(wallClock(ts, "America/Los_Angeles")).toBe("2026-07-16 09:00");
    });

    // PST instant (winter, UTC-8): 2026-01-15 22:00 Pacific. Next Pacific day is
    // the 16th -> 2026-01-16 09:00 Pacific. This instant is already the 16th in
    // UTC, which is exactly the case the old host-local Date.setHours version
    // got wrong on non-Pacific hosts.
    it("snoozes to 9:00 the next Pacific day during PST", () => {
      vi.setSystemTime(new Date("2026-01-16T06:00:00.000Z")); // 22:00 PST on the 15th

      const ts = defaultSnoozeTs();

      expect(wallClock(ts, "America/Los_Angeles")).toBe("2026-01-16 09:00");
    });
  });

  it("uses coarse pending security labels", () => {
    const classifyAt = Date.parse("2026-05-03T16:05:00.000Z");

    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T15:55:00.000Z"))).toBe("Triage delayed");
    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T16:03:30.000Z"))).toBe("Classifying soon");
    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T16:04:30.000Z"))).toBe("Classifying in <1m");
    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T16:05:01.000Z"))).toBe("Classifying");
  });
});
