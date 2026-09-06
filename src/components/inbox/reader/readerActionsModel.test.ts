import { describe, expect, it } from "vitest";

import { resolveReaderActions, resolveReaderActionGroups } from "./readerActionsModel";

// Active-snapshot row carries a snapshot_item_id, like every real reader email
// (inboxRow spreads it through; the dispatch + Sidebar require it).
function snapshotEmail(overrides = {}) {
  return {
    id: "m1",
    uid: "m1",
    _activeSnapshot: true,
    snapshot_item_id: 42,
    _lane: "needs_attention",
    ...overrides,
  };
}

describe("resolveReaderActions snapshot workflow", () => {
  it("offers handle/dismiss/move (except current lane) for a needs_attention row", () => {
    const a = resolveReaderActions(snapshotEmail({ _lane: "needs_attention" }));
    expect(a.canHandle).toBe(true);
    expect(a.canDismiss).toBe(true);
    expect(a.canMoveToFyi).toBe(true);
    expect(a.canMoveToNoise).toBe(true);
    expect(a.canMoveToNeeds).toBe(false);
    expect(a.canReopen).toBe(false);
    expect(a.showSnapshotWorkflowActions).toBe(true);
  });

  it("offers only reopen for a handled row", () => {
    const a = resolveReaderActions(snapshotEmail({ _lane: "handled", handled_at: "2026-05-03T16:00:00Z" }));
    expect(a.canReopen).toBe(true);
    expect(a.canHandle).toBe(false);
    expect(a.canDismiss).toBe(false);
    expect(a.canMoveToFyi).toBe(false);
  });

  it("keeps a queued row dismissible but blocks moves/handle (and is not a full workflow row)", () => {
    const a = resolveReaderActions(snapshotEmail({ _lane: "queued" }));
    expect(a.canDismiss).toBe(true);
    expect(a.canHandle).toBe(false);
    expect(a.canMoveToFyi).toBe(false);
    expect(a.canReopen).toBe(false);
    expect(a.showSnapshotWorkflowActions).toBe(false);
  });

  it("strips every snapshot action for a catch-up row", () => {
    const a = resolveReaderActions(snapshotEmail({ _lane: "catch_up", lane_at_snapshot: "fyi" }));
    expect(a.canHandle).toBe(false);
    expect(a.canDismiss).toBe(false);
    expect(a.canMoveToFyi).toBe(false);
    expect(a.canReopen).toBe(false);
    expect(a.catchUp).toBe(true);
    expect(a.showDestructiveActions).toBe(false);
  });

  it("blocks all mutating actions when read-only", () => {
    const a = resolveReaderActions(snapshotEmail({ _lane: "needs_attention" }), { readOnly: true });
    expect(a.canHandle).toBe(false);
    expect(a.canDismiss).toBe(false);
    expect(a.canMoveToFyi).toBe(false);
    expect(a.showMutableActions).toBe(false);
    expect(a.showDestructiveActions).toBe(false);
  });

  it("DRIFT GUARD: an active-snapshot row missing snapshot_item_id exposes no snapshot actions", () => {
    const a = resolveReaderActions({ _activeSnapshot: true, _lane: "needs_attention" });
    expect(a.canHandle).toBe(false);
    expect(a.canDismiss).toBe(false);
    expect(a.canMoveToFyi).toBe(false);
    expect(a.canMoveToNoise).toBe(false);
    expect(a.canReopen).toBe(false);
    expect(a.showSnapshotWorkflowActions).toBe(false);
  });
});

describe("resolveReaderActions pin toggle", () => {
  it("is true for any email — including readOnly and catch-up rows (exempt from both gates)", () => {
    expect(resolveReaderActions(snapshotEmail({ _lane: "needs_attention" })).canPin).toBe(true);
    expect(resolveReaderActions(snapshotEmail({ _lane: "needs_attention" }), { readOnly: true }).canPin).toBe(true);
    expect(resolveReaderActions(snapshotEmail({ _lane: "catch_up", lane_at_snapshot: "fyi" })).canPin).toBe(true);
  });

  it("is false with no email", () => {
    expect(resolveReaderActions(null).canPin).toBe(false);
    expect(resolveReaderActions(undefined).canPin).toBe(false);
  });

  it("mirrors email._pinned", () => {
    expect(resolveReaderActions(snapshotEmail({ _pinned: true })).pinned).toBe(true);
    expect(resolveReaderActions(snapshotEmail({ _pinned: false })).pinned).toBe(false);
    expect(resolveReaderActions(snapshotEmail()).pinned).toBe(false);
  });
});

describe("resolveReaderActions bill toggle", () => {
  it("is eligible for bill, live/untriaged, queued, and untriaged_read rows", () => {
    expect(resolveReaderActions({ hasBill: true }).billToggleEligible).toBe(true);
    expect(resolveReaderActions({ _untriaged: true }).billToggleEligible).toBe(true);
    expect(resolveReaderActions(snapshotEmail({ _lane: "queued" })).billToggleEligible).toBe(true);
    expect(resolveReaderActions(snapshotEmail({ _lane: "untriaged_read" })).billToggleEligible).toBe(true);
  });

  it("is not eligible for a triaged non-bill row", () => {
    expect(resolveReaderActions(snapshotEmail({ _lane: "needs_attention", hasBill: false })).billToggleEligible).toBe(false);
  });
});


it("offers early return without snapshot or destructive actions for deferred mail", () => {
  const email = { uid: "deferred", _snoozed: true, _lane: "fyi" };
  const actions = resolveReaderActions(email);
  expect(actions.canHandle).toBe(false);
  expect(actions.canDismiss).toBe(false);
  expect(actions.canMoveToNeeds).toBe(false);
  expect(actions.showDestructiveActions).toBe(false);
  expect(resolveReaderActionGroups(email).triageItems.map((item) => item.key)).toEqual(["unsnooze", "pin-toggle", "toggle-read"]);
  expect(resolveReaderActionGroups({ ...email, _snoozedUnavailable: true }).triageItems).toEqual([
    expect.objectContaining({ key: "unsnooze", disabled: true }),
  ]);
});
