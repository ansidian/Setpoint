import { describe, expect, it } from "vitest";
import { collectActiveSnapshotEmails, pendingSecurityGraceLabel } from "./helpers.js";
import { makeActiveSnapshot } from "./test-utils/inboxFixtures.js";

describe("inbox helpers", () => {
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

    const rows = collectActiveSnapshotEmails(activeSnapshot, {}, {
      nowMs: Date.parse("2026-05-03T16:04:30.000Z"),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      uid: "security-pending",
      _untriaged: true,
      _live: false,
      _activeSnapshot: true,
      _lane: null,
      _pendingSecurityGrace: true,
      _pendingSecurityGraceAt: Date.parse("2026-05-03T16:05:00.000Z"),
      _pendingSecurityGraceLabel: "Classifying in <1m",
    });
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

  it("uses coarse pending security labels", () => {
    const classifyAt = Date.parse("2026-05-03T16:05:00.000Z");

    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T15:55:00.000Z"))).toBe("Triage delayed");
    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T16:03:30.000Z"))).toBe("Classifying soon");
    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T16:04:30.000Z"))).toBe("Classifying in <1m");
    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T16:05:01.000Z"))).toBe("Classifying");
  });
});
