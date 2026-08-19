import { describe, expect, it } from "vitest";

import {
  collectActiveSnapshotEmails,
  collectLiveEmails,
  collectPinned,
  collectResurfaced,
  makeSynthAccount,
  mergePinnedIntoFlat,
  pinnedEntryFromSnapshot,
} from "./inboxWorkItems";
import { makeActiveSnapshot } from "./test-utils/inboxFixtures";

describe("inbox work items", () => {
  it("normalizes active snapshot rows as work items with lane and account metadata", () => {
    const snapshot = makeActiveSnapshot({
      lanes: {
        needs_attention: [{
          id: 1,
          uid: "email-1",
          account_id: "gmail-work",
          lane: "action",
          subject: "Action needed",
          from_name: "Taylor",
          summary: "Review this",
          read: false,
          urgency: "high",
        }],
        fyi: [],
        noise: [],
      },
      carryover: [],
    });

    expect(collectActiveSnapshotEmails(snapshot, { "email-1": true })).toEqual([
      expect.objectContaining({
        id: "email-1",
        uid: "email-1",
        _activeSnapshot: true,
        _live: false,
        _lane: "needs_attention",
        read: true,
        urgentFlag: { label: "High" },
      }),
    ]);
  });

  it("projects arrival grace lanes without treating them as live untriaged rows", () => {
    const snapshot = makeActiveSnapshot({
      lanes: {
        queued: [{
          id: 2,
          uid: "queued-1",
          account_id: "gmail-work",
          lane: "queued",
          source: "arrival_grace",
          subject: "Fresh arrival",
          read: false,
        }],
        needs_attention: [],
        fyi: [],
        untriaged_read: [{
          id: 3,
          uid: "read-1",
          account_id: "gmail-work",
          lane: "untriaged_read",
          source: "arrival_grace_read",
          subject: "Read before triage",
          read: false,
        }],
        noise: [],
      },
      carryover: [],
    });

    const rows = collectActiveSnapshotEmails(snapshot, { "queued-1": true });

    expect(rows).toEqual([
      expect.objectContaining({
        uid: "queued-1",
        _lane: "queued",
        _arrivalGraceQueued: true,
        _untriaged: false,
        read: true,
      }),
      expect.objectContaining({
        uid: "read-1",
        _lane: "untriaged_read",
        _untriagedRead: true,
        _untriaged: false,
        read: true,
      }),
    ]);
  });

  it("projects resurfaced snapshot rows in their stored lane", () => {
    const snapshot = makeActiveSnapshot({
      lanes: {
        needs_attention: [
          {
            id: 11,
            snapshot_item_id: 11,
            uid: "snapshot-resurfaced",
            account_id: "gmail-work",
            lane: "needs_attention",
            source: "resurfaced_snooze",
            source_at: "2026-05-04T17:30:00.000Z",
            resurfaced_at: 1777915800000,
          },
        ],
        fyi: [],
        noise: [],
      },
      carryover: [],
    });

    const rows = collectActiveSnapshotEmails(snapshot);

    expect(rows[0]).toMatchObject({
      uid: "snapshot-resurfaced",
      _untriaged: false,
      _live: false,
      _activeSnapshot: true,
      _resurfaced: true,
      _resurfacedAt: 1777915800000,
      _lane: "needs_attention",
    });
  });

  it("projects handled and catch-up rows while read overrides only change read state", () => {
    const snapshot = makeActiveSnapshot({
      lanes: {
        needs_attention: [],
        catch_up: [{
          id: "catch_up:14",
          snapshot_item_id: 14,
          uid: "late-fyi",
          account_id: "gmail-work",
          lane: "catch_up",
          lane_at_snapshot: "fyi",
          read: false,
          source: "catch_up",
        }],
        fyi: [],
        handled: [{
          id: 13,
          snapshot_item_id: 13,
          uid: "handled-thread",
          account_id: "gmail-work",
          lane: "needs_attention",
          handled_at: "2026-05-03T16:10:00.000Z",
          read: true,
        }],
        noise: [],
      },
      carryover: [],
    });

    const rows = collectActiveSnapshotEmails(snapshot, { "late-fyi": true });

    expect(rows).toEqual([
      expect.objectContaining({
        uid: "late-fyi",
        _activeSnapshot: true,
        _lane: "catch_up",
        lane: "catch_up",
        lane_at_snapshot: "fyi",
        read: true,
        _catchUp: true,
      }),
      expect.objectContaining({
        uid: "handled-thread",
        _activeSnapshot: true,
        _untriaged: false,
        _lane: "handled",
        handled_at: "2026-05-03T16:10:00.000Z",
      }),
    ]);
  });

  it("normalizes live and resurfaced rows through the same account seam", () => {
    const synthAccount = makeSynthAccount([{ id: "work", name: "Work", color: "#fff", icon: "Mail" }]);
    const liveRows = collectLiveEmails(
      [{ uid: "live-1", account_label: "Work", read: false, body_preview: "Preview" }],
      synthAccount,
      new Set(),
      { "live-1": true },
      new Map([["live-1", { resurfaced_at: 123 }]]),
    );
    const resurfacedRows = collectResurfaced(
      new Map([["wake-1", {
        read: false,
        resurfaced_at: 456,
        snapshot: { uid: "wake-1", account_label: "Work", body_preview: "Wake" },
      }]]),
      synthAccount,
      {},
      new Set(),
    );

    expect(liveRows[0]).toMatchObject({
      uid: "live-1",
      read: true,
      _accountKey: "work",
      _live: true,
      _untriaged: false,
      _lane: "queued",
      _arrivalGraceQueued: true,
      _resurfaced: true,
      _resurfacedAt: 123,
    });
    expect(resurfacedRows[0]).toMatchObject({
      uid: "wake-1",
      _accountKey: "work",
      _live: true,
      _resurfaced: true,
      _resurfacedAt: 456,
      _untriaged: false,
      _lane: "needs_attention",
    });
  });

  describe("collectPinned", () => {
    it("builds a row per entry with _pinned/_pinnedAt and a synthesized account", () => {
      const synthAccount = makeSynthAccount([{ id: "work", name: "Work", color: "#fff", icon: "Mail" }]);
      const rows = collectPinned(
        [{
          uid: "pin-1",
          account_label: "Work",
          subject: "Pinned subject",
          read: false,
          pinned_at: "2026-06-30T12:00:00.000Z",
        }],
        synthAccount,
        {},
      );

      expect(rows).toEqual([
        expect.objectContaining({
          uid: "pin-1",
          id: "pin-1",
          _accountKey: "work",
          _pinned: true,
          _pinnedAt: Date.parse("2026-06-30T12:00:00.000Z"),
        }),
      ]);
    });

    it("skips entries without a uid", () => {
      const synthAccount = makeSynthAccount([]);
      const rows = collectPinned(
        [{ subject: "No uid", pinned_at: "2026-06-30T12:00:00.000Z" }],
        synthAccount,
        {},
      );

      expect(rows).toEqual([]);
    });

    it("applies the read-override merge like the other collectors", () => {
      const synthAccount = makeSynthAccount([]);
      const rows = collectPinned(
        [{ uid: "pin-2", read: false, pinned_at: "2026-06-30T12:00:00.000Z" }],
        synthAccount,
        { "pin-2": true },
      );

      expect(rows[0]).toMatchObject({ uid: "pin-2", read: true });
    });
  });

  describe("mergePinnedIntoFlat", () => {
    it("decorates a matching flat row in place, preserving snapshot_item_id and _lane, without appending a duplicate", () => {
      const flatRows = [{
        uid: "shared-1",
        snapshot_item_id: "snap-77",
        _lane: "needs_attention",
        subject: "Original",
      }];
      const pinnedRows = [{
        uid: "shared-1",
        id: "shared-1",
        _pinned: true,
        _pinnedAt: 12345,
        subject: "Pinned view",
      }];

      const merged = mergePinnedIntoFlat(flatRows, pinnedRows);

      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({
        uid: "shared-1",
        snapshot_item_id: "snap-77",
        _lane: "needs_attention",
        subject: "Original",
        _pinned: true,
        _pinnedAt: 12345,
      });
    });

    it("appends a pinned row with no matching flat row", () => {
      const flatRows = [{ uid: "existing-1", subject: "Existing" }];
      const pinnedRows = [{ uid: "pin-only-1", _pinned: true, _pinnedAt: 999 }];

      const merged = mergePinnedIntoFlat(flatRows, pinnedRows);

      expect(merged).toHaveLength(2);
      expect(merged[1]).toMatchObject({ uid: "pin-only-1", _pinned: true, _pinnedAt: 999 });
    });

    it("returns the same flatRows reference when there are no pins", () => {
      const flatRows = [{ uid: "existing-1", subject: "Existing" }];

      expect(mergePinnedIntoFlat(flatRows, [])).toBe(flatRows);
      expect(mergePinnedIntoFlat(flatRows, null)).toBe(flatRows);
    });
  });

  describe("pinnedEntryFromSnapshot", () => {
    it("maps buildEmailSnapshot field names onto the PinnedEntry shape", () => {
      const snap = {
        account_id: "gmail-work",
        subject: "Hello",
        from: "Taylor",
        fromEmail: "taylor@example.com",
        from_email: "taylor@example.com",
        preview: "Preview text",
        date: "2026-06-29T00:00:00.000Z",
        read: true,
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#fff",
        account_icon: "Mail",
        urgency: "high",
      };

      const entry = pinnedEntryFromSnapshot("pin-3", 1719700000000, snap);

      expect(entry).toEqual({
        uid: "pin-3",
        pinned_at: new Date(1719700000000).toISOString(),
        account_id: "gmail-work",
        subject: "Hello",
        from_name: "Taylor",
        from_address: "taylor@example.com",
        preview: "Preview text",
        date: "2026-06-29T00:00:00.000Z",
        read: true,
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#fff",
        account_icon: "Mail",
        lane: null,
        urgency: "high",
        category: null,
        handled_at: null,
        provider_state: null,
      });
    });
  });
});
