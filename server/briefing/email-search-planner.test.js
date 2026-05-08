import { describe, expect, it, vi } from "vitest";
import {
  createInboxAiQueryPlan,
  parseInboxAiRetrievalPlan,
} from "./email-search-planner.js";
import { answerInboxAiSearch } from "./email-search-answer.js";

function openAiPlan(plan) {
  return {
    ok: true,
    json: async () => ({
      output_text: JSON.stringify(plan),
      model: "gpt-5.4-mini",
      usage: { input_tokens: 20, output_tokens: 30 },
    }),
  };
}

describe("inbox AI query planner", () => {
  it("normalizes only allowlisted retrieval plan fields and caps lists", () => {
    const plan = parseInboxAiRetrievalPlan({
      semantic_query: "amazon return deadline",
      lexical_queries: ["amazon return", "drop off", "refund", "extra"],
      sender_domains: ["amazon.com", "bad domain!", "ups.com", "extra.com", "more.com", "overflow.com"],
      sender_addresses: ["returns@amazon.com", "not an address"],
      read_filter: "unread",
      date_window: { after: "2026-05-01T00:00:00Z", before: "not-a-date" },
      lanes: ["needs_attention", "DROP TABLE"],
      categories: ["delivery", "finance", "not valid"],
      urgency: ["high", "urgent"],
      intents: ["deadline", "dropoff", "too", "many", "items"],
      exclusions: ["refund", "marketing", "overflow", "extra"],
      confidence: 1.5,
      sql: "SELECT * FROM mail",
    });

    expect(plan).toEqual({
      semantic_query: "amazon return deadline",
      lexical_queries: ["amazon return", "drop off", "refund"],
      sender_domains: ["amazon.com", "ups.com", "extra.com", "more.com", "overflow.com"],
      sender_addresses: ["returns@amazon.com"],
      read_filter: "unread",
      date_window: { after: "2026-05-01T00:00:00.000Z", before: null },
      lanes: ["needs_attention"],
      categories: ["delivery", "finance"],
      urgency: ["high"],
      intents: ["deadline", "dropoff", "too"],
      exclusions: ["refund", "marketing", "overflow"],
      confidence: 1,
    });
    expect(plan).not.toHaveProperty("sql");
  });

  it("lets explicit read flags override planner inferred read filters", async () => {
    const fetchImpl = vi.fn(async () => openAiPlan({
      semantic_query: "google security",
      read_filter: "read",
    }));

    const result = await createInboxAiQueryPlan({
      q: "is:unread google security",
      fetchImpl,
      apiKey: "test-openai-key",
    });

    expect(result.plan.read_filter).toBe("unread");
    expect(result.plan.explicit_read_filter).toBe(true);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.input).toContain("is:unread google security");
  });

  it("instructs the planner to preserve ambiguous short queries", async () => {
    const fetchImpl = vi.fn(async () => openAiPlan({
      semantic_query: "prime promo",
      lexical_queries: ["prime promo"],
      sender_domains: [],
      sender_addresses: [],
      read_filter: null,
      date_window: { after: null, before: null },
      lanes: [],
      categories: [],
      urgency: [],
      intents: [],
      exclusions: [],
      confidence: 0.8,
    }));

    await createInboxAiQueryPlan({
      q: "prime promo",
      fetchImpl,
      apiKey: "test-openai-key",
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.instructions).toContain("preserve ambiguity");
    expect(body.instructions).toContain("do not narrow to Amazon-only");
  });

  it("falls back to raw retrieval when planner fails and exposes planner only in debug", async () => {
    const retrieve = vi.fn(async (_userId, options) => ({
      mode: "lexical",
      lexical: { status: "ok", count: 1 },
      vector: { status: "unavailable", count: 0 },
      total: 1,
      candidates: [{
        uid: "source-1",
        subject: "Google security alert",
        body_snippet: "New sign in",
        body_excerpt: "New sign in",
        from: { name: "Google", address: "no-reply@google.com" },
        account: { id: "gmail-work", label: "Work" },
        metadata: {},
        provenance: { lexical: true, vector: false },
        scores: {},
      }],
      receivedOptions: options,
    }));
    const fetchImpl = vi.fn(async () => openAiPlan({
      answer: "There was a sign in alert.",
      confidence: "medium",
      cited_source_uids: ["source-1"],
      missing_info: [],
      low_confidence_reason: "",
    }));
    const planner = vi.fn(async () => {
      throw Object.assign(new Error("bad planner"), { code: "planner_bad_output" });
    });

    const normal = await answerInboxAiSearch("user-1", {
      q: "google sign in alert",
      retrieve,
      planner,
      fetchImpl,
      apiKey: "test-openai-key",
      debug: false,
    });
    const debug = await answerInboxAiSearch("user-1", {
      q: "google sign in alert",
      retrieve,
      planner,
      fetchImpl,
      apiKey: "test-openai-key",
      debug: true,
    });

    expect(retrieve.mock.calls[0][1]).not.toHaveProperty("plan");
    expect(normal).not.toHaveProperty("planner");
    expect(debug.planner).toMatchObject({
      status: "fallback",
      error_class: "planner_bad_output",
    });
  });
});
