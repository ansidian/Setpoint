import { describe, expect, it } from "vitest";
import {
  activeSnapshotWindow,
  normalizeSnapshot,
  normalizeSnapshotItem,
} from "./snapshot-lifecycle.js";

describe("snapshot lifecycle model", () => {
  it("computes the owner-local active snapshot window", () => {
    expect(activeSnapshotWindow({
      now: new Date("2026-05-07T18:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    })).toEqual({
      start_at: "2026-05-07T07:00:00.000Z",
      end_at: "2026-05-08T07:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
  });

  it("normalizes snapshot rows for service callers", () => {
    expect(normalizeSnapshot({
      id: "42",
      user_id: "user-1",
      status: "active",
    })).toEqual({
      id: 42,
      snapshot_item_id: 42,
      user_id: "user-1",
      status: "active",
    });
  });

  it("projects snapshot item rows into inbox-ready view items", () => {
    expect(normalizeSnapshotItem({
      id: "13",
      snapshot_id: "2",
      triage_id: "7",
      user_id: "user-1",
      account_id: "gmail-work",
      email_id: "email-1",
      lane_at_snapshot: "fyi",
      summary_at_snapshot: "Read this",
      action_at_snapshot: "Reply",
      urgency_at_snapshot: "high",
      category_at_snapshot: "finance",
      escalation_badge_at_snapshot: "Bill",
      subject_at_snapshot: "Invoice",
      from_name_at_snapshot: "Billing Team",
      from_address_at_snapshot: "billing@example.com",
      email_date_at_snapshot: "2026-05-07T15:00:00.000Z",
      account_label_at_snapshot: "Work",
      account_email_at_snapshot: "me@example.com",
      account_color_at_snapshot: "#123456",
      account_icon_at_snapshot: "Briefcase",
      sort_order: "9",
      is_carryover: 1,
      source: "catch_up",
      source_at: "2026-05-07T16:00:00.000Z",
      resurfaced_at: "7",
      dismissed_from_today_at: null,
      handled_at: null,
      provider_removed_at: null,
      read: 1,
      bill_candidate_json: "{\"payee_hint\":\"Billing Team\",\"amount\":12,\"due_date\":\"2026-05-10\",\"requires_confirmation\":true}",
    })).toMatchObject({
      id: "catch_up:13",
      snapshot_id: 2,
      triage_id: 7,
      uid: "email-1",
      lane: "catch_up",
      lane_at_snapshot: "fyi",
      summary: "Read this",
      preview: "Read this",
      action: "Reply",
      urgency: "high",
      category: "finance",
      escalation_badge: "Bill",
      from: "Billing Team",
      sort_order: 9,
      is_carryover: true,
      source: "catch_up",
      resurfaced_at: 7,
      read: true,
      hasBill: true,
      bill_candidate: {
        payee_hint: "Billing Team",
        amount: 12,
        due_date: "2026-05-10",
        requires_confirmation: true,
      },
      extractedBill: {
        payee: "Billing Team",
        amount: 12,
        due_date: "2026-05-10",
        type: "expense",
        requires_confirmation: true,
      },
      _catchUp: true,
      previous_snapshot_item_id: 13,
    });
  });
});
