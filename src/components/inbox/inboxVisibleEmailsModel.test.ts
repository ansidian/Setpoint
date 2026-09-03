import { describe, expect, it } from "vitest";
import { selectVisibleEmails } from "./inboxVisibleEmailsModel";
import type { InboxEmailLike } from "./inboxTypes";

function email(overrides: Partial<InboxEmailLike> = {}): InboxEmailLike {
  const uid = String(overrides.uid || overrides.id || "msg-1");
  return {
    id: uid,
    uid,
    _accountKey: "work",
    category: "marketing",
    _lane: "needs_attention",
    _untriaged: false,
    read: false,
    date: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("selectVisibleEmails", () => {
  it("uses indexed-search results instead of the live inbox projection when search is active", () => {
    const indexedSearchEmails = [email({ uid: "hit-1" })];
    const result = selectVisibleEmails({
      flatEmails: [email({ uid: "live-1" })],
      indexedSearchActive: true,
      indexedSearchEmails,
    });
    expect(result).toEqual(indexedSearchEmails);
  });

  it("hides snoozed rows whose boundary is still in the future", () => {
    const nowTick = 1_000;
    const result = selectVisibleEmails({
      flatEmails: [email({ uid: "a" }), email({ uid: "b" })],
      snoozedMap: new Map([["b", nowTick + 500]]),
      nowTick,
    });
    expect(result.map((e) => e.uid)).toEqual(["a"]);
  });

  it("surfaces a snoozed row again once its boundary has passed", () => {
    const nowTick = 2_000;
    const result = selectVisibleEmails({
      flatEmails: [email({ uid: "a" })],
      snoozedMap: new Map([["a", nowTick - 1]]),
      nowTick,
    });
    expect(result.map((e) => e.uid)).toEqual(["a"]);
  });

  it("surfaces a row at the exact snooze boundary (strict > nowTick, not >=)", () => {
    const nowTick = 2_000;
    const result = selectVisibleEmails({
      flatEmails: [email({ uid: "a" })],
      snoozedMap: new Map([["a", nowTick]]),
      nowTick,
    });
    expect(result.map((e) => e.uid)).toEqual(["a"]);
  });

  it("applies account and lane scope", () => {
    const flatEmails = [
      email({ uid: "work-mkt", _accountKey: "work", category: "marketing", _lane: "fyi" }),
      email({ uid: "personal", _accountKey: "personal", _lane: "fyi" }),
      email({ uid: "work-fin", _accountKey: "work", category: "finance", _lane: "fyi" }),
      email({ uid: "work-noise", _accountKey: "work", category: "marketing", _lane: "noise" }),
    ];
    const result = selectVisibleEmails({
      flatEmails,
      accountId: "work",
      lane: "fyi",
    });
    expect(result.map((e) => e.uid)).toEqual(["work-mkt", "work-fin"]);
  });

  it("sorts by lane order, then newest-first", () => {
    const flatEmails = [
      email({ uid: "fyi-old", _lane: "fyi", date: "2026-01-01T00:00:00.000Z" }),
      email({ uid: "queued", _lane: "queued", date: "2026-01-01T00:00:00.000Z" }),
      email({ uid: "untriaged", _untriaged: true, _lane: "queued", date: "2026-01-01T00:00:00.000Z" }),
      email({ uid: "fyi-new", _lane: "fyi", date: "2026-06-01T00:00:00.000Z" }),
    ];
    const result = selectVisibleEmails({ flatEmails });
    expect(result.map((e) => e.uid)).toEqual(["queued", "untriaged", "fyi-new", "fyi-old"]);
  });

  it("uses _resurfacedAt as the recency key, ranking a row up when it resurfaced recently", () => {
    const flatEmails = [
      // Old raw date, but resurfaced more recently than the other row's date.
      email({ uid: "resurfaced", _lane: "fyi", date: "2026-01-01T00:00:00.000Z", _resurfacedAt: Date.parse("2026-12-01T00:00:00.000Z") }),
      email({ uid: "recent-date", _lane: "fyi", date: "2026-06-01T00:00:00.000Z" }),
    ];
    const result = selectVisibleEmails({ flatEmails });
    expect(result.map((e) => e.uid)).toEqual(["resurfaced", "recent-date"]);
  });

  it("REPLACES the date with _resurfacedAt (not max), so an old resurface ranks the row down", () => {
    const flatEmails = [
      // Recent raw date but an OLD resurface time: the resurface time must replace
      // the date (so this sorts last), ruling out a max(date, resurfacedAt) bug.
      email({ uid: "stale-resurface", _lane: "fyi", date: "2026-06-01T00:00:00.000Z", _resurfacedAt: Date.parse("2026-02-01T00:00:00.000Z") }),
      email({ uid: "middle", _lane: "fyi", date: "2026-03-01T00:00:00.000Z" }),
    ];
    const result = selectVisibleEmails({ flatEmails });
    expect(result.map((e) => e.uid)).toEqual(["middle", "stale-resurface"]);
  });

  it("pin beats snooze: a _pinned row still returns even when snoozed until the future", () => {
    const nowTick = 1_000;
    const flatEmails = [
      email({ uid: "pinned-snoozed", _pinned: true, _pinnedAt: 500 }),
      email({ uid: "plain-snoozed" }),
    ];
    const result = selectVisibleEmails({
      flatEmails,
      snoozedMap: new Map([
        ["pinned-snoozed", nowTick + 500],
        ["plain-snoozed", nowTick + 500],
      ]),
      nowTick,
    });
    expect(result.map((e) => e.uid)).toEqual(["pinned-snoozed"]);
  });

  it("pinned rows bypass the lane filter", () => {
    const flatEmails = [
      email({
        uid: "pinned-other-lane",
        _pinned: true,
        _pinnedAt: 500,
        _lane: "needs_attention",
        category: "finance",
      }),
      email({ uid: "plain-fyi", _lane: "fyi", category: "marketing" }),
    ];
    const result = selectVisibleEmails({
      flatEmails,
      lane: "fyi",
    });
    expect(result.map((e) => e.uid)).toEqual(["pinned-other-lane", "plain-fyi"]);
  });

  it("pinned rows still RESPECT the account filter", () => {
    const flatEmails = [
      email({ uid: "pinned-wrong-account", _pinned: true, _pinnedAt: 500, _accountKey: "personal" }),
      email({ uid: "work-row", _accountKey: "work" }),
    ];
    const result = selectVisibleEmails({
      flatEmails,
      accountId: "work",
    });
    expect(result.map((e) => e.uid)).toEqual(["work-row"]);
  });

  it("sorts all pinned rows before non-pinned rows, newest pin first", () => {
    const flatEmails = [
      email({ uid: "untriaged", _untriaged: true }),
      email({ uid: "pin-older", _pinned: true, _pinnedAt: 100 }),
      email({ uid: "pin-newer", _pinned: true, _pinnedAt: 900 }),
      email({ uid: "plain" }),
    ];
    const result = selectVisibleEmails({ flatEmails });
    expect(result.map((e) => e.uid)).toEqual(["pin-newer", "pin-older", "untriaged", "plain"]);
  });

  it("orders mobile rows by message date across lanes and resurfacing, after matching pins", () => {
    const flatEmails = [
      email({ uid: "resurfaced", _lane: "needs_attention", date: "2026-01-01T00:00:00.000Z", _resurfacedAt: Date.parse("2026-12-01T00:00:00.000Z") }),
      email({ uid: "pin-older", _pinned: true, _pinnedAt: 100 }),
      email({ uid: "queued", _lane: "queued", date: "2026-03-01T00:00:00.000Z" }),
      email({ uid: "pin-newer", _pinned: true, _pinnedAt: 900 }),
      email({ uid: "noise-newest", _lane: "noise", date: "2026-06-01T00:00:00.000Z" }),
    ];
    const result = selectVisibleEmails({ flatEmails, sortOrder: "newest" });

    expect(result.map((row) => row.uid)).toEqual([
      "pin-newer", "pin-older", "noise-newest", "queued", "resurfaced",
    ]);
  });

  it("narrows the scoped inbox to unread rows, including only unread pins", () => {
    const flatEmails = [
      email({ uid: "unread", _lane: "fyi" }),
      email({ uid: "read", _lane: "fyi", read: true }),
      email({ uid: "untriaged-read", _lane: "untriaged_read" }),
      email({ uid: "read-pin", _pinned: true, _pinnedAt: 900, read: true }),
      email({ uid: "unread-pin", _pinned: true, _pinnedAt: 100 }),
      email({ uid: "other-account", _accountKey: "personal", _lane: "fyi" }),
      email({ uid: "other-lane", _lane: "noise" }),
      email({ uid: "snoozed", _lane: "fyi" }),
    ];
    const result = selectVisibleEmails({
      flatEmails,
      sortOrder: "newest",
      unreadOnly: true,
      accountId: "work",
      lane: "fyi",
      nowTick: 1_000,
      snoozedMap: new Map([["snoozed", 2_000], ["unread-pin", 2_000]]),
    });

    expect(result.map((row) => row.uid)).toEqual(["unread-pin", "unread"]);
    expect(selectVisibleEmails({ flatEmails, unreadOnly: true }).map((row) => row.uid))
      .not.toContain("untriaged-read");
  });

  it("filters and sorts loaded search matches without introducing inbox rows or changing search scope", () => {
    const indexedSearchEmails = [
      email({ uid: "older", date: "2026-01-01T00:00:00.000Z" }),
      email({ uid: "read-match", read: true }),
      email({ uid: "newer", _accountKey: "personal", _lane: "noise", date: "2026-06-01T00:00:00.000Z" }),
    ];
    const result = selectVisibleEmails({
      flatEmails: [email({ uid: "inbox-pin", _pinned: true })],
      indexedSearchActive: true,
      indexedSearchEmails,
      accountId: "work",
      lane: "fyi",
      snoozedMap: new Map([["newer", 2_000]]),
      nowTick: 1_000,
      sortOrder: "newest",
      unreadOnly: true,
    });

    expect(result.map((row) => row.uid)).toEqual(["newer", "older"]);
    // The source remains intact for the open reader and for turning Unread off.
    expect(indexedSearchEmails.map((row) => row.uid)).toEqual(["older", "read-match", "newer"]);
  });

});
