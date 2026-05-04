import { describe, expect, it } from "vitest";
import { collectActiveSnapshotEmails } from "./helpers.js";
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
});
