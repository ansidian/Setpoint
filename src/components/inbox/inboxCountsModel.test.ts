import { describe, expect, it } from "vitest";
import {
  computeScopedNoiseUnreadCount,
  computeLaneCounts,
  computeInboxChipCounts,
  computeUnreadCount,
  selectVisibleInboxLaneChips,
} from "./inboxCountsModel";
import type { InboxEmailLike } from "./inboxTypes";

function email(overrides: Partial<InboxEmailLike> = {}): InboxEmailLike {
  const uid = String(overrides.uid || overrides.id || "msg-1");
  return {
    id: uid,
    uid,
    _accountKey: "work",
    category: "marketing",
    _lane: "noise",
    read: false,
    ...overrides,
  };
}

describe("computeScopedNoiseUnreadCount", () => {
  it("counts unread noise in the current account scope", () => {
    const count = computeScopedNoiseUnreadCount([
      email({ uid: "noise-1" }),
      email({ uid: "noise-read", read: true }),
      email({ uid: "fyi-1", _lane: "fyi" }),
      email({ uid: "personal-noise", _accountKey: "personal" }),
      email({ uid: "finance-noise", category: "finance" }),
    ], {
      accountId: "work",
    });

    expect(count).toBe(2);
  });

  it("hides the noise unread count during indexed search and ignores snoozed rows", () => {
    const nowTick = Date.parse("2026-05-06T12:00:00.000Z");
    const emails = [
      email({ uid: "visible-noise" }),
      email({ uid: "snoozed-noise" }),
    ];

    expect(computeScopedNoiseUnreadCount(emails, {
      indexedSearchActive: true,
      nowTick,
    })).toBe(0);

    expect(computeScopedNoiseUnreadCount(emails, {
      indexedSearchActive: false,
      snoozedMap: new Map([["snoozed-noise", nowTick + 60_000]]),
      nowTick,
    })).toBe(1);
  });
});

describe("computeLaneCounts", () => {
  it("tallies per-lane counts in the account scope", () => {
    const counts = computeLaneCounts([
      email({ uid: "q1", _lane: "queued" }),
      email({ uid: "na1", _lane: "needs_attention" }),
      email({ uid: "na2", _lane: "needs_attention" }),
      email({ uid: "live1", _untriaged: true, _lane: "queued" }),
      email({ uid: "other-acct", _lane: "fyi", _accountKey: "personal" }),
    ], { accountId: "work" });

    expect(counts.queued).toBe(2);
    expect(counts.needs_attention).toBe(2);
    expect(counts.fyi).toBe(0);
  });

  it("mirrors needs_attention into the action alias", () => {
    const counts = computeLaneCounts([
      email({ uid: "na1", _lane: "needs_attention" }),
    ]);
    expect(counts.action).toBe(counts.needs_attention);
    expect(counts.action).toBe(1);
  });

  it("ignores snooze state (unlike the primary chip counts)", () => {
    // A snoozedMap that would hide this row everywhere snooze is honored; lane
    // counts must still include it. Guards against snooze filtering creeping in.
    const counts = computeLaneCounts([
      email({ uid: "snoozable", _lane: "fyi" }),
    ], { accountId: "__all", snoozedMap: new Map([["snoozable", Number.MAX_SAFE_INTEGER]]) });
    expect(counts.fyi).toBe(1);
  });
});

describe("computeInboxChipCounts", () => {
  it("honors snooze and tracks lane and __all counts", () => {
    const nowTick = 1_000;
    const counts = computeInboxChipCounts([
      email({ uid: "live1", _untriaged: true, _lane: "queued" }),
      email({ uid: "na1", _lane: "needs_attention" }),
      email({ uid: "snoozed", _lane: "fyi" }),
    ], {
      accountId: "work",
      snoozedMap: new Map([["snoozed", nowTick + 500]]),
      nowTick,
    });

    expect(counts.__all).toBe(2);
    expect(counts.queued).toBe(1);
    expect(counts.needs_attention).toBe(1);
    expect(counts.action).toBe(1);
    expect(counts.fyi).toBe(0);
  });
});

describe("computeUnreadCount", () => {
  it("counts unread rows but excludes the untriaged_read lane", () => {
    const count = computeUnreadCount([
      email({ uid: "unread-1", read: false, _lane: "needs_attention" }),
      email({ uid: "read-1", read: true, _lane: "needs_attention" }),
      email({ uid: "untriaged-read", read: false, _lane: "untriaged_read" }),
    ]);
    expect(count).toBe(1);
  });
});

describe("selectVisibleInboxLaneChips", () => {
  const chips = [
    { key: "__all", label: "All" },
    { key: "queued", label: "Queue" },
    { key: "carryover", label: "Carry" },
    { key: "needs_attention", label: "Needs" },
    { key: "catch_up", label: "Catch" },
    { key: "fyi", label: "FYI" },
    { key: "handled", label: "Handled" },
    { key: "noise", label: "Noise" },
  ];

  it("keeps All and positive natural triage lanes only", () => {
    const visible = selectVisibleInboxLaneChips(chips, {
      __all: 10,
      queued: 2,
      carryover: 1,
      needs_attention: 2,
      catch_up: 1,
      fyi: 0,
      handled: 1,
      noise: 1,
    });
    expect(visible.map((c) => c.key)).toEqual(["__all", "needs_attention", "noise"]);
  });

  it("preserves the source order of the surviving chips", () => {
    const visible = selectVisibleInboxLaneChips(chips, {
      __all: 1, needs_attention: 1, fyi: 1, noise: 1,
    });
    expect(visible.map((c) => c.key)).toEqual(["__all", "needs_attention", "fyi", "noise"]);
  });

  it("hides a natural lane whose key is absent from counts", () => {
    const sparse = { __all: 2, needs_attention: 2 };
    expect(
      selectVisibleInboxLaneChips(chips, sparse).map((c) => c.key),
    ).toEqual(["__all", "needs_attention"]);
  });
});
