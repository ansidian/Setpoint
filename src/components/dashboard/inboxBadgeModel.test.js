import { describe, expect, it } from "vitest";
import { computeInboxUnreadSignalCount } from "./inboxBadgeModel.js";

function snapshotRow(overrides = {}) {
  const uid = overrides.uid || overrides.email_id || overrides.id || "msg-1";
  return {
    id: uid,
    snapshot_item_id: uid,
    uid,
    email_id: uid,
    account_id: "gmail-work",
    lane: "needs_attention",
    subject: "Message",
    read: false,
    ...overrides,
  };
}

function activeSnapshot(lanes) {
  return {
    snapshot: { id: 1 },
    filters: {
      accounts: [{ account_id: "gmail-work", label: "Work", count: 0 }],
      categories: [],
    },
    carryover: lanes.carryover || [],
    lanes: {
      needs_attention: lanes.needs_attention || [],
      catch_up: lanes.catch_up || [],
      fyi: lanes.fyi || [],
      handled: lanes.handled || [],
      noise: lanes.noise || [],
    },
  };
}

describe("computeInboxUnreadSignalCount", () => {
  it("counts unread inbox signal while excluding classified noise and handled rows", () => {
    const count = computeInboxUnreadSignalCount({
      activeSnapshot: activeSnapshot({
        needs_attention: [snapshotRow({ uid: "need-1" })],
        fyi: [snapshotRow({ uid: "fyi-1", lane: "fyi" })],
        noise: [snapshotRow({ uid: "noise-1", lane: "noise" })],
        handled: [snapshotRow({ uid: "handled-1", lane: "needs_attention", handled_at: "2026-05-06T12:00:00.000Z" })],
      }),
      liveEmails: [{ uid: "live-1", read: false }],
      resurfacedEntries: [{ uid: "wake-1", read: false }],
      liveReadOverrides: {},
    });

    expect(count).toBe(4);
  });

  it("lets classified snapshot rows suppress live duplicates and applies read overrides", () => {
    const count = computeInboxUnreadSignalCount({
      activeSnapshot: activeSnapshot({
        needs_attention: [snapshotRow({ uid: "need-1" })],
        fyi: [snapshotRow({ uid: "read-override", lane: "fyi" })],
        noise: [snapshotRow({ uid: "noise-duplicate", lane: "noise" })],
      }),
      liveEmails: [
        { uid: "noise-duplicate", read: false },
        { uid: "need-1", read: false },
        { uid: "live-read-override", read: false },
      ],
      liveReadOverrides: {
        "read-override": true,
        "live-read-override": true,
      },
    });

    expect(count).toBe(1);
  });

  it("counts unread Catch-up rows and respects read overrides both ways", () => {
    expect(computeInboxUnreadSignalCount({
      activeSnapshot: activeSnapshot({
        catch_up: [snapshotRow({ uid: "late-fyi", lane: "catch_up", lane_at_snapshot: "fyi" })],
      }),
    })).toBe(1);

    expect(computeInboxUnreadSignalCount({
      activeSnapshot: activeSnapshot({
        catch_up: [snapshotRow({ uid: "late-fyi", lane: "catch_up", lane_at_snapshot: "fyi" })],
      }),
      liveReadOverrides: { "late-fyi": true },
    })).toBe(0);

    expect(computeInboxUnreadSignalCount({
      activeSnapshot: activeSnapshot({
        catch_up: [snapshotRow({ uid: "late-fyi", lane: "catch_up", lane_at_snapshot: "fyi", read: true })],
      }),
      liveReadOverrides: { "late-fyi": false },
    })).toBe(1);
  });
});
