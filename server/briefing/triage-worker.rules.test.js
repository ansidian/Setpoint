import { describe, expect, it, vi } from "vitest";
import { __resetCurrentDashboardEventsForTests, subscribeCurrentDashboardEvents } from "../dashboard/current-events.js";
import { createMigratedDb, queueEmail } from "./triage-worker.test-utils.js";
import { processNextEmailTriageJob } from "./triage-worker.js";

describe("email triage worker rule finalization", () => {
  it("finalizes queued mail with no-model local rules without model calls or bill candidates", async () => {
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
      source: "no_model_fallback",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

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
      triage_source: "no_model_fallback",
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

  it("finalizes obvious noise with rules only and attaches it to the active snapshot", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient);
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:15:00.000Z"),
    });

    expect(result).toEqual({
      processed: true,
      job_id: expect.any(Number),
      email_id: "msg-1",
      lane: "noise",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const triage = await dbClient.execute({
      sql: `SELECT lane, category, urgency, triage_status, triage_source,
                   confidence, summary, action, model_usage_json,
                   cheap_model_result_json, strong_model_result_json
            FROM ea_email_triage
            WHERE user_id = ? AND account_id = ? AND email_id = ?`,
      args: ["user-1", "gmail-work", "msg-1"],
    });
    expect(triage.rows[0]).toMatchObject({
      lane: "noise",
      category: "marketing",
      urgency: "low",
      triage_status: "complete",
      triage_source: "rule",
      confidence: 0.94,
      summary: "Promotional or bulk email.",
      action: "Ignore",
      model_usage_json: "{}",
      cheap_model_result_json: null,
      strong_model_result_json: null,
    });

    const items = await dbClient.execute({
      sql: `SELECT lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
                   category_at_snapshot, subject_at_snapshot, from_address_at_snapshot
            FROM ea_briefing_snapshot_items
            WHERE user_id = ? AND account_id = ? AND email_id = ?`,
      args: ["user-1", "gmail-work", "msg-1"],
    });
    expect(items.rows).toEqual([
      expect.objectContaining({
        lane_at_snapshot: "noise",
        summary_at_snapshot: "Promotional or bulk email.",
        action_at_snapshot: "Ignore",
        category_at_snapshot: "marketing",
        subject_at_snapshot: "Weekend sale - 40% off",
        from_address_at_snapshot: "deals@example.com",
      }),
    ]);
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
    expect(modelClient.classify).not.toHaveBeenCalled();

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
    expect(JSON.parse(rows.rows[0].decision_metadata_json)).toMatchObject({
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

  it("finalizes one-time verification codes without model calls", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Here's your verification code 367936",
      body_snippet: "Please verify it's you. This code expires soon.",
      body_text: "Please verify it's you. Enter verification code 367936 to continue.",
      from_name: "LinkedIn",
      from_address: "security-noreply@linkedin.com",
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:16:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "noise",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const rows = await dbClient.execute({
      sql: `SELECT lane, category, urgency, triage_source, summary, action,
                   cheap_model_result_json, strong_model_result_json
            FROM ea_email_triage WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "noise",
      category: "security",
      urgency: "low",
      triage_source: "rule",
      summary: "One-time authentication code.",
      action: "Ignore",
      cheap_model_result_json: null,
      strong_model_result_json: null,
    });
    });

  it("finalizes obvious promotional subject lines without model calls", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Your promo code unlocks free shipping today",
      body_snippet: "Use this limited offer before it expires.",
      body_text: "Use this limited offer before it expires.",
      from_name: "Shop",
      from_address: "offers@shop.example",
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:17:00.000Z"),
    });

    expect(result).toMatchObject({
      processed: true,
      email_id: "msg-1",
      lane: "noise",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const rows = await dbClient.execute({
      sql: "SELECT lane, category, triage_source, summary, action FROM ea_email_triage WHERE email_id = ?",
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "noise",
      category: "marketing",
      triage_source: "rule",
      summary: "Promotional or bulk email.",
      action: "Ignore",
    });
    });

  it("stores preflight reason metadata for no-model rule finalization", async () => {
    __resetCurrentDashboardEventsForTests();
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      from_name: "USPS Informed Delivery",
      from_address: "informeddelivery@usps.com",
      subject: "Your Daily Digest for May 5",
      body_snippet: "Mail and packages arriving soon.",
      body_text: "This digest includes an unsubscribe footer.",
    });
    const events = [];
    const unsubscribe = subscribeCurrentDashboardEvents("user-1", (event) => events.push(event));
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
    expect(modelClient.classify).not.toHaveBeenCalled();

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
    expect(JSON.parse(rows.rows[0].decision_metadata_json)).toMatchObject({
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
    expect(modelClient.classify).not.toHaveBeenCalled();

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

  it("finalizes routine finance confirmations without model calls", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Payment confirmation",
      body_snippet: "Your direct deposit payment of $445.27 has been submitted.",
      body_text: "Your direct deposit payment of $445.27 has been submitted and should arrive in 3 business days.",
      from_name: "IHSS/WPCS E-Timesheets",
      from_address: "donotreply@etimesheets.ihss.ca.gov",
    });
    const modelClient = {
      classify: vi.fn(async ({ tier }) => ({
        decision: {
          lane: "fyi",
          category: "finance",
          urgency: "normal",
          escalation_badge: null,
          summary: "Payment confirmation for $445.27.",
          action: "No action needed.",
          deadline_at: null,
          confidence: 0.93,
          bill_candidate: null,
        },
        usage: { input_tokens: 80, output_tokens: 20 },
        estimated_cost_usd: 0.001,
        latency_ms: 120,
        tier,
      })),
    };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:28:00.000Z"),
    });

    expect(result).toMatchObject({
      lane: "fyi",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();

    const rows = await dbClient.execute({
      sql: `SELECT lane, category, triage_source, model_usage_json,
                   cheap_model_result_json, strong_model_result_json,
                   estimated_cost_usd, latency_ms
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      category: "finance",
      triage_source: "rule",
      strong_model_result_json: null,
      estimated_cost_usd: null,
      latency_ms: null,
    });
    expect(JSON.parse(rows.rows[0].model_usage_json)).toEqual({});
    expect(rows.rows[0].cheap_model_result_json).toBeNull();
    });

  it("finalizes routine autopay scheduled notices without treating soft review as action", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "An autopay is coming up soon for your card",
      body_snippet: "Autopay of $162.00 is scheduled. Review your statement if interested.",
      body_text: "Autopay of $162.00 is scheduled. Review your statement if interested. No action is needed.",
      from_name: "Card Services",
      from_address: "alerts@card.example",
    });
    const modelClient = { classify: vi.fn() };

    const result = await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:29:30.000Z"),
    });

    expect(result).toMatchObject({
      lane: "fyi",
      source: "rule",
      model_calls: [],
    });
    expect(modelClient.classify).not.toHaveBeenCalled();
    });

  it("drops generic model escalation badges from FYI decisions", async () => {
    const dbClient = await createMigratedDb();
    await queueEmail(dbClient, {
      subject: "Payment confirmation",
      body_snippet: "Your direct deposit payment has been submitted.",
      body_text: "Your direct deposit payment has been submitted and should arrive soon.",
      from_name: "IHSS/WPCS E-Timesheets",
      from_address: "donotreply@etimesheets.ihss.ca.gov",
    });
    const modelClient = {
      classify: vi.fn(async ({ tier }) => ({
        decision: {
          lane: "fyi",
          category: "finance",
          urgency: "normal",
          escalation_badge: "ESCALATED",
          summary: "Payment confirmation.",
          action: "No action needed.",
          deadline_at: null,
          confidence: 0.91,
          bill_candidate: null,
        },
        usage: { input_tokens: 80, output_tokens: 20 },
        tier,
      })),
    };

    await processNextEmailTriageJob({
      dbClient,
      modelClient,
      now: new Date("2026-05-03T12:29:00.000Z"),
    });

    const rows = await dbClient.execute({
      sql: `SELECT escalation_badge, lane
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(rows.rows[0]).toMatchObject({
      lane: "fyi",
      escalation_badge: null,
    });

    const items = await dbClient.execute({
      sql: `SELECT escalation_badge_at_snapshot
            FROM ea_briefing_snapshot_items
            WHERE email_id = ?`,
      args: ["msg-1"],
    });
    expect(items.rows[0].escalation_badge_at_snapshot).toBeNull();
    });
});
