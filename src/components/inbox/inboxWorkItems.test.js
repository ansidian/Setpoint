import { describe, expect, it } from "vitest";

import {
  collectActiveSnapshotEmails,
  collectLiveEmails,
  collectResurfaced,
  makeSynthAccount,
  mergeReadState,
} from "./inboxWorkItems.js";
import { makeActiveSnapshot } from "./test-utils/inboxFixtures.js";

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
      _untriaged: true,
      _resurfaced: true,
      _resurfacedAt: 123,
    });
    expect(resurfacedRows[0]).toMatchObject({
      uid: "wake-1",
      _accountKey: "work",
      _live: true,
      _resurfaced: true,
      _resurfacedAt: 456,
    });
  });

  it("honors object and Map read overrides", () => {
    expect(mergeReadState(false, "uid-1", { "uid-1": true })).toBe(true);
    expect(mergeReadState(true, "uid-1", new Map([["uid-1", false]]))).toBe(false);
    expect(mergeReadState(false, "uid-2", { "uid-1": true })).toBe(false);
  });
});
