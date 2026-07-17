import { describe, expect, it } from "vitest";
import { READ_SCOPE, resolveReadScope, planMarkAllVisibleRead } from "./inboxReadRoutingModel";

describe("resolveReadScope", () => {
  it("routes live rows to the live scope regardless of uid", () => {
    expect(resolveReadScope({ _live: true, uid: "m1" })).toBe(READ_SCOPE.LIVE);
    expect(resolveReadScope({ _live: true })).toBe(READ_SCOPE.LIVE);
  });

  it("routes active-snapshot rows with a uid to the snapshot scope", () => {
    expect(resolveReadScope({ _activeSnapshot: true, uid: "m1" })).toBe(READ_SCOPE.SNAPSHOT);
  });

  it("falls back to indexed scope for active-snapshot rows missing a uid", () => {
    expect(resolveReadScope({ _activeSnapshot: true })).toBe(READ_SCOPE.INDEXED);
  });

  it("treats anything else (and nullish) as the indexed scope", () => {
    expect(resolveReadScope({ uid: "m1" })).toBe(READ_SCOPE.INDEXED);
    expect(resolveReadScope(null)).toBe(READ_SCOPE.INDEXED);
    expect(resolveReadScope(undefined)).toBe(READ_SCOPE.INDEXED);
  });

  it("prefers live over snapshot when a row carries both flags", () => {
    expect(resolveReadScope({ _live: true, _activeSnapshot: true, uid: "m1" })).toBe(READ_SCOPE.LIVE);
  });
});

describe("planMarkAllVisibleRead", () => {
  it("ignores rows already read", () => {
    const plan = planMarkAllVisibleRead([
      { uid: "read-1", read: true, _live: true },
      { uid: "unread-1", read: false, _live: true },
    ]);
    expect(plan.unread.map((e) => e.uid)).toEqual(["unread-1"]);
    expect(plan.allUids).toEqual(["unread-1"]);
  });

  it("collects live and snapshot uids as override targets and every unread uid as allUids", () => {
    const plan = planMarkAllVisibleRead([
      { uid: "live-1", read: false, _live: true },
      { uid: "snap-1", read: false, _activeSnapshot: true },
      { uid: "indexed-1", read: false, _indexedSearch: true },
    ]);
    expect(plan.overrideUids).toEqual(["live-1", "snap-1"]);
    expect(plan.allUids).toEqual(["live-1", "snap-1", "indexed-1"]);
  });

  it("excludes uid-less rows from both override targets and allUids", () => {
    const plan = planMarkAllVisibleRead([
      { read: false, _live: true },
      { read: false, _activeSnapshot: true },
      { uid: "indexed-1", read: false },
    ]);
    expect(plan.overrideUids).toEqual([]);
    expect(plan.allUids).toEqual(["indexed-1"]);
  });

  it("returns empty plans for an empty or all-read list", () => {
    expect(planMarkAllVisibleRead([])).toEqual({ unread: [], overrideUids: [], allUids: [] });
    expect(planMarkAllVisibleRead([{ uid: "a", read: true, _live: true }]))
      .toEqual({ unread: [], overrideUids: [], allUids: [] });
  });
});
