import { describe, expect, it, vi } from "vitest";
import { clearCurrentDashboardEventSubscribers, subscribeCurrentDashboardEvents } from "../dashboard/current-events.ts";
import { createMigratedDb, queueEmail } from "./triage-worker.test-utils.ts";
import { processNextEmailTriageJob } from "./triage-worker.ts";

describe("email triage worker rule finalization", () => {
  it("finalizes queued mail with the no-model heuristic scorer without model calls or bill candidates", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Payment due tomorrow",
      body_snippet: "Your utility payment of $120 is due tomorrow.",
      body_text: "Your utility payment of $120 is due tomorrow.",
      from_name: "Utility Billing",
      from_address: "billing@utility.example",
    });
    await dbClient.execute({
      sql: "UPDATE ea_settings SET email_triage_mode = 'no_model' WHERE user_id = ?",
      args: ["user-1"],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:10:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "needs_attention",
      source: "no_model_heuristic",
      model_calls: [],
    });
    const rows = await dbClient.execute({
      sql: `SELECT lane, category, urgency, escalation_badge, triage_status,
                   triage_source, summary, action, model_usage_json,
                   cheap_model_result_json, strong_model_result_json,
                   estimated_cost_usd, latency_ms, bill_candidate_json
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "needs_attention",
      category: "uncategorized",
      urgency: "normal",
      escalation_badge: "Needs Review",
      triage_status: "complete",
      triage_source: "no_model_heuristic",
      summary: "Your utility payment of $120 is due tomorrow.",
      action: "Review",
      model_usage_json: "{}",
      cheap_model_result_json: null,
      strong_model_result_json: null,
      estimated_cost_usd: null,
      latency_ms: null,
      bill_candidate_json: null,
    });

    const items = await dbClient.execute({
      sql: `SELECT lane_at_snapshot, action_at_snapshot, escalation_badge_at_snapshot
            FROM ea_briefing_snapshot_items
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(items.rows[0]).toMatchObject({
      lane_at_snapshot: "needs_attention",
      action_at_snapshot: "Review",
      escalation_badge_at_snapshot: "Needs Review",
    });
    });

  it("keeps configured email interests out of noise", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "Anthropic",
      from_address: "news@anthropic.com",
      subject: "Weekend sale - 40% off",
      body_snippet: "Unsubscribe any time.",
      body_text: "Sale ends soon. Unsubscribe any time.",
    });
    await dbClient.execute({
      sql: "UPDATE ea_settings SET email_interests_json = ? WHERE user_id = ?",
      args: [JSON.stringify(["Anthropic"]), "user-1"],
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:15:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "fyi",
      source: "rule",
      model_calls: [],
    });
    const rows = await dbClient.execute({
      sql: `SELECT lane, category, triage_source, summary, action, decision_metadata_json
            FROM ea_email_triage WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      category: "updates",
      triage_source: "rule",
      summary: "Matched email interest: Anthropic.",
      action: "Review when convenient",
    });
    expect(JSON.parse(String(rows.rows[0]!.decision_metadata_json))).toMatchObject({
      preflight: {
        reasonCode: "email_interest_promoted_noise_to_fyi",
        matchedInterest: "Anthropic",
        interestPromotion: {
          originalLane: "noise",
          originalReasonCode: "marketing_noise",
        },
      },
    });
    });

  it("stores preflight reason metadata for no-model rule finalization", async () => {
    clearCurrentDashboardEventSubscribers();
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "USPS Informed Delivery",
      from_address: "informeddelivery@usps.com",
      subject: "Your Daily Digest for May 5",
      body_snippet: "Mail and packages arriving soon.",
      body_text: "This digest includes an unsubscribe footer.",
    });
    const events: Record<string, unknown>[] = [];
    const unsubscribe = subscribeCurrentDashboardEvents("user-1", (event: Record<string, unknown>) => events.push(event));
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:18:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "fyi",
      source: "rule",
      model_calls: [],
    });
    const rows = await dbClient.execute({
      sql: `SELECT lane, category, decision_metadata_json
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      category: "delivery",
    });
    expect(JSON.parse(String(rows.rows[0]!.decision_metadata_json))).toMatchObject({
      preflight: {
        action: "finalize",
        reasonCode: "delivery_digest_fyi",
        matchedRuleKey: "default_delivery_digest_fyi",
        modelSaved: true,
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
        source: "email_triage",
        reason: "email_triage_finalized",
        details: {
          triggerType: "fyi_finalized",
          eventKey: "email_triage:gmail-work:msg-1:email_triage_finalized",
          emailId: "msg-1",
          emailReceivedAt: "2026-05-03T12:00:00.000Z",
          lane: "fyi",
          triageSource: "rule",
          reason: "email_triage_finalized",
        },
      }),
    ]);
    unsubscribe();
    });

  it("uses enabled database rules before falling back to model routing", async () => {
    const dbClient = await createMigratedDb();
    await dbClient.execute({
      sql: `INSERT INTO ea_triage_rules
              (user_id, name, priority, rule_type, match_json,
               lane, category, urgency, confidence, reason)
            VALUES (?, 'Delivery vendor FYI', 5, 'sender_domain', ?,
                    'fyi', 'delivery', 'low', 0.91, 'Trusted delivery notification.')`,
      args: ["user-1", JSON.stringify({ from_domains: ["vendor.example"] })],
    });
    await queueEmail(dbClient, {
      subject: "Package status update",
      body_snippet: "Your package is on the way.",
      body_text: "Your package is on the way.",
      from_name: "Vendor",
      from_address: "alerts@vendor.example",
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:22:00.000Z"),
    });

    expect(result).toMatchObject({
      lane: "fyi",
      source: "rule",
      model_calls: [],
    });
    const rows = await dbClient.execute({
      sql: "SELECT lane, category, confidence, triage_source, rule_id FROM ea_email_triage WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      category: "delivery",
      confidence: 0.91,
      triage_source: "rule",
      rule_id: 1,
    });
    });

});
