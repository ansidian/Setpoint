import { describe, expect, it } from "vitest";
import { selectVisibleEmails } from "./inboxVisibleEmailsModel.js";

function email(overrides = {}) {
  const uid = overrides.uid || overrides.id || "msg-1";
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
  it("returns the indexed-search results verbatim (by reference) when search is active", () => {
    const indexedSearchEmails = [email({ uid: "hit-1" })];
    const result = selectVisibleEmails({
      flatEmails: [email({ uid: "live-1" })],
      indexedSearchActive: true,
      indexedSearchEmails,
    });
    // Identity matters: EmailRow's memo relies on the same array reference.
    expect(result).toBe(indexedSearchEmails);
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

  it("applies account, category, and lane scope", () => {
    const flatEmails = [
      email({ uid: "work-mkt", _accountKey: "work", category: "marketing", _lane: "fyi" }),
      email({ uid: "personal", _accountKey: "personal", _lane: "fyi" }),
      email({ uid: "work-fin", _accountKey: "work", category: "finance", _lane: "fyi" }),
      email({ uid: "work-noise", _accountKey: "work", category: "marketing", _lane: "noise" }),
    ];
    const result = selectVisibleEmails({
      flatEmails,
      accountId: "work",
      categoryFilter: "marketing",
      lane: "fyi",
    });
    expect(result.map((e) => e.uid)).toEqual(["work-mkt"]);
  });

  it("treats lane '__live' as the untriaged bucket", () => {
    const flatEmails = [
      email({ uid: "triaged", _untriaged: false }),
      email({ uid: "untriaged", _untriaged: true, _lane: "queued" }),
    ];
    const result = selectVisibleEmails({ flatEmails, lane: "__live" });
    expect(result.map((e) => e.uid)).toEqual(["untriaged"]);
  });

  it("sorts untriaged first, then by lane order, then newest-first", () => {
    const flatEmails = [
      email({ uid: "fyi-old", _lane: "fyi", date: "2026-01-01T00:00:00.000Z" }),
      email({ uid: "queued", _lane: "queued", date: "2026-01-01T00:00:00.000Z" }),
      email({ uid: "untriaged", _untriaged: true, _lane: "queued", date: "2026-01-01T00:00:00.000Z" }),
      email({ uid: "fyi-new", _lane: "fyi", date: "2026-06-01T00:00:00.000Z" }),
    ];
    const result = selectVisibleEmails({ flatEmails });
    expect(result.map((e) => e.uid)).toEqual(["untriaged", "queued", "fyi-new", "fyi-old"]);
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
});
