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

  it("uses coarse pending security labels", () => {
    const classifyAt = Date.parse("2026-05-03T16:05:00.000Z");

    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T15:55:00.000Z"))).toBe("Triage delayed");
    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T16:03:30.000Z"))).toBe("Classifying soon");
    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T16:04:30.000Z"))).toBe("Classifying in <1m");
    expect(pendingSecurityGraceLabel(classifyAt, Date.parse("2026-05-03T16:05:01.000Z"))).toBe("Classifying");
  });
});
