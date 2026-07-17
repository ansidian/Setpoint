import { describe, expect, it } from "vitest";
import {
  buildFilters,
  buildLanes,
  buildSnapshotView,
  compareAccountFilters,
  emptyProcessingState,
} from "./snapshotViewModel.ts";
import type { SnapshotItem, SnapshotRecord } from "../../shared/types/snapshots.ts";

function item(overrides: Record<string, unknown> = {}): SnapshotItem {
  return {
    id: 1,
    snapshot_id: 1,
    triage_id: 1,
    user_id: "user-1",
    account_id: "acct-1",
    email_id: "email-1",
    uid: "email-1",
    account_label: "Personal",
    account_email: "me@example.com",
    account_color: "#fff",
    account_icon: "mail",
    category: "bills",
    lane: "needs_attention",
    lane_at_snapshot: "needs_attention",
    summary: "",
    preview: "",
    action: "",
    urgency: "normal",
    deadline_at: null,
    escalation_badge: null,
    subject: "",
    from: "",
    from_name: "",
    from_address: "",
    date: null,
    email_date: null,
    sort_order: 0,
    is_carryover: false,
    source: null,
    source_at: null,
    resurfaced_at: null,
    _resurfaced: false,
    _resurfacedAt: null,
    dismissed_from_today_at: null,
    handled_at: null,
    provider_removed_at: null,
    read: false,
    hasBill: false,
    bill_candidate: null,
    extractedBill: null,
    _catchUp: false,
    previous_snapshot_item_id: null,
    ...overrides,
  } as SnapshotItem;
}

function snapshot(status: SnapshotRecord["status"]): SnapshotRecord {
  return {
    id: 1,
    snapshot_item_id: 1,
    start_at: "2026-05-20T00:00:00.000Z",
    end_at: "2026-05-21T00:00:00.000Z",
    timezone: "America/Los_Angeles",
    status,
  };
}

describe("buildLanes", () => {
  it("routes handled, carryover, catch_up, and lane items to the right buckets", () => {
    const { lanes, carryover } = buildLanes([
      item({ lane: "needs_attention" }),
      item({ lane: "queued" }),
      item({ lane: "fyi" }),
      item({ handled_at: "2026-05-20T00:00:00Z", lane: "needs_attention" }),
      item({ is_carryover: 1, lane: "needs_attention" }),
      item({ lane: "catch_up" }),
      item({ lane: "nonexistent_lane" }), // dropped — no matching bucket
    ]);
    expect(lanes.needs_attention).toHaveLength(1);
    expect(lanes.queued).toHaveLength(1);
    expect(lanes.fyi).toHaveLength(1);
    expect(lanes.handled).toHaveLength(1);
    expect(lanes.catch_up).toHaveLength(1);
    expect(carryover).toHaveLength(1);
  });

  it("prioritizes handled over carryover", () => {
    const { lanes, carryover } = buildLanes([item({ handled_at: "x", is_carryover: 1 })]);
    expect(lanes.handled).toHaveLength(1);
    expect(carryover).toHaveLength(0);
  });
});

describe("buildFilters", () => {
  it("aggregates account + category counts; default sort is count desc then label", () => {
    const filters = buildFilters([
      item({ account_id: "a", account_label: "Alpha", category: "bills" }),
      item({ account_id: "b", account_label: "Beta", category: "bills" }),
      item({ account_id: "b", account_label: "Beta", category: "news" }),
      item({ account_id: "c", account_label: "Gamma", category: null }),
    ]);
    expect(filters.accounts.map((a) => a.account_id)).toEqual(["b", "a", "c"]); // b has 2, then a/c by label
    expect(filters.accounts[0]!.count).toBe(2);
    expect(filters.categories).toEqual([
      { category: "bills", count: 2 },
      { category: "news", count: 1 },
      { category: "uncategorized", count: 1 },
    ]);
  });

  it("uses the account order map when provided", () => {
    const accountOrder = new Map([
      ["b", { index: 0, sort_order: 1, created_at: 0 }],
      ["a", { index: 1, sort_order: 2, created_at: 0 }],
    ]);
    const filters = buildFilters([
      item({ account_id: "a", account_label: "Alpha" }),
      item({ account_id: "a", account_label: "Alpha" }),
      item({ account_id: "b", account_label: "Beta" }),
    ], accountOrder);
    expect(filters.accounts.map((a) => a.account_id)).toEqual(["b", "a"]); // sort_order wins over count
  });
});

describe("compareAccountFilters", () => {
  const order = new Map([
    ["x", { index: 0, sort_order: 1, created_at: 100 }],
    ["y", { index: 1, sort_order: 2, created_at: 100 }],
  ]);
  it("orders by sort_order, then created_at, then index; ordered before unordered", () => {
    expect(compareAccountFilters(order, { account_id: "x" }, { account_id: "y" })).toBeLessThan(0);
    expect(compareAccountFilters(order, { account_id: "x" }, { account_id: "z", label: "Z" })).toBe(-1);
    expect(compareAccountFilters(order, { account_id: "z", label: "Z" }, { account_id: "x" })).toBe(1);
  });
  it("falls back to label then account_id when neither is ordered", () => {
    expect(compareAccountFilters(order, { account_id: "m", label: "A" }, { account_id: "n", label: "B" })).toBeLessThan(0);
  });
});

describe("buildSnapshotView", () => {
  it("assembles snapshot/lanes/laneCounts/filters and marks non-active as readOnly", () => {
    const view = buildSnapshotView(
      snapshot("frozen"),
      [item({ lane: "needs_attention" }), item({ is_carryover: 1, lane: "needs_attention" })],
      undefined,
      null,
      3,
    );
    expect(view.readOnly).toBe(true);
    expect(view.laneCounts).toMatchObject({ needs_attention: 1, carryover: 1 });
    expect(view.carryoverAgedOut).toBe(3);
    expect(view.processing).toEqual(emptyProcessingState());
    expect(view.filters.accounts).toHaveLength(1);
  });

  it("only adds a catch_up laneCount when catch_up items exist; active snapshot is editable", () => {
    const without = buildSnapshotView(snapshot("active"), [item()]);
    expect(without.readOnly).toBe(false);
    expect(without.laneCounts.catch_up).toBeUndefined();
    const withCatch = buildSnapshotView(snapshot("active"), [item({ lane: "catch_up" })]);
    expect(withCatch.laneCounts.catch_up).toBe(1);
  });
});

describe("emptyProcessingState", () => {
  it("is inactive with auto/no_model modes and zeroed job counts", () => {
    expect(emptyProcessingState()).toMatchObject({
      active: false,
      email_triage_mode: "auto",
      effective_email_triage_mode: "no_model",
      email_triage: { total: 0, active: false },
      gmail_history_sync: { total: 0, active: false },
    });
  });
});
