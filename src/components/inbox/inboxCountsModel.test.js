import { describe, expect, it } from "vitest";
import { computeScopedNoiseUnreadCount } from "./inboxCountsModel.js";

function email(overrides = {}) {
  const uid = overrides.uid || overrides.id || "msg-1";
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
  it("counts unread noise in the current account and category scope", () => {
    const count = computeScopedNoiseUnreadCount([
      email({ uid: "noise-1" }),
      email({ uid: "noise-read", read: true }),
      email({ uid: "fyi-1", _lane: "fyi" }),
      email({ uid: "personal-noise", _accountKey: "personal" }),
      email({ uid: "finance-noise", category: "finance" }),
    ], {
      accountId: "work",
      categoryFilter: "marketing",
    });

    expect(count).toBe(1);
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
