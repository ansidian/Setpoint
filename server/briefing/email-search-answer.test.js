import { describe, expect, it, vi } from "vitest";
import {
  INBOX_AI_ANSWER_BODY_CHAR_LIMIT,
  answerInboxAiSearch,
  buildInboxAiAnswerPayload,
  parseInboxAiAnswerOutput,
} from "./email-search-answer.js";

const sourceCandidate = {
  uid: "source-1",
  subject: "Credit card payment due",
  body_snippet: "Payment due May 10",
  body_excerpt: `${"A".repeat(INBOX_AI_ANSWER_BODY_CHAR_LIMIT)}TAIL`,
  email_date: "2026-05-08T12:00:00Z",
  from: { name: "Bank", address: "alerts@bank.example" },
  account: { id: "gmail-work", label: "Work", email: "work@example.com" },
  metadata: { lane: "needs_attention", category: "finance", urgency: "high" },
  provenance: { lexical: true, vector: true },
  scores: { lexical: 0.5, vector: 0.9, combined: 0.75 },
};

function retrieval(candidates = [sourceCandidate]) {
  return {
    mode: "hybrid",
    lexical: { status: "ok", count: candidates.length },
    vector: { status: "ok", count: candidates.length },
    parsed_query: { date_window: null },
    candidates,
  };
}

function openAiResponse(answer) {
  return {
    ok: true,
    json: async () => ({
      output_text: JSON.stringify(answer),
      usage: { input_tokens: 100, output_tokens: 50 },
      model: "gpt-5.4-mini",
    }),
  };
}

describe("inbox AI answer service", () => {
  it("builds a bounded source-grounded payload from retrieval candidates", () => {
    const payload = buildInboxAiAnswerPayload({
      query: "what payment is due?",
      candidates: [sourceCandidate],
      dateWindow: {
        after: "2026-05-08T00:00:00.000Z",
        before: "2026-05-15T00:00:00.000Z",
      },
    });

    expect(payload.date_window).toEqual({
      after: "2026-05-08T00:00:00.000Z",
      before: "2026-05-15T00:00:00.000Z",
    });
    expect(payload.sources).toEqual([
      expect.objectContaining({
        uid: "source-1",
        source_label: "Work (work@example.com)",
        sender: "Bank <alerts@bank.example>",
        subject: "Credit card payment due",
        snippet: "Payment due May 10",
        body_excerpt: expect.any(String),
        metadata: sourceCandidate.metadata,
        provenance: sourceCandidate.provenance,
      }),
    ]);
    expect(payload.sources[0].body_excerpt).toHaveLength(INBOX_AI_ANSWER_BODY_CHAR_LIMIT);
    expect(payload.sources[0].body_excerpt.endsWith("TAIL")).toBe(false);
  });

  it("uses OpenAI structured output with store false and validates cited source UIDs", async () => {
    const fetchImpl = vi.fn(async () => openAiResponse({
      answer: "Your card payment is due May 10.",
      confidence: "high",
      cited_source_uids: ["source-1", "hallucinated-source"],
      missing_info: [],
      low_confidence_reason: "",
    }));

    const result = await answerInboxAiSearch("user-1", {
      q: "what payment is due?",
      retrieve: vi.fn(async () => retrieval()),
      planner: null,
      fetchImpl,
      apiKey: "test-openai-key",
    });

    expect(result).toMatchObject({
      answer_status: "ok",
      answer: {
        answer: "Your card payment is due May 10.",
        confidence: "high",
        cited_source_uids: ["source-1"],
        missing_info: [],
        low_confidence_reason: "",
      },
      sources: [
        expect.objectContaining({ uid: "source-1" }),
      ],
      retrieval: {
        mode: "hybrid",
        vector_status: "ok",
        lexical_status: "ok",
        date_window: null,
      },
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.instructions).toContain("Use source_label, not uid");
    expect(body.instructions).toContain("do not count or cite messages outside that window");
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      name: "inbox_ai_answer",
      strict: true,
    });
    expect(JSON.stringify(body)).toContain("Credit card payment due");
  });

  it("replaces raw cited source UIDs in answer text with friendly account labels", async () => {
    const uid = "gmail-gmail-asu220250@gmail.com-19dd6365175696a5";
    const fetchImpl = vi.fn(async () => openAiResponse({
      answer: `This looks like the Chase promo. Source: ${uid}`,
      confidence: "high",
      cited_source_uids: [uid],
      missing_info: [],
      low_confidence_reason: "",
    }));

    const result = await answerInboxAiSearch("user-1", {
      q: "prime promo",
      retrieve: vi.fn(async () => retrieval([{
        ...sourceCandidate,
        uid,
        account: { id: "gmail-asu", label: "School", email: "asu220250@gmail.com" },
      }])),
      planner: null,
      fetchImpl,
      apiKey: "test-openai-key",
    });

    expect(result.answer.answer).toBe("This looks like the Chase promo. Source: School (asu220250@gmail.com)");
    expect(result.answer.cited_source_uids).toEqual([uid]);
    expect(result.sources[0]).toMatchObject({
      uid,
      source_label: "School (asu220250@gmail.com)",
    });
  });

  it("records planner, query embedding, and answer usage as content-free events", async () => {
    const fetchImpl = vi.fn(async () => openAiResponse({
      answer: "Your card payment is due May 10.",
      confidence: "high",
      cited_source_uids: ["source-1"],
      missing_info: [],
      low_confidence_reason: "",
    }));
    const recordUsage = vi.fn();

    await answerInboxAiSearch("user-1", {
      q: "what payment is due?",
      retrieve: vi.fn(async () => retrieval()),
      planner: vi.fn(async () => ({
        status: "ok",
        plan: {
          semantic_query: "payment due",
          lexical_queries: ["payment due"],
        },
        model: "gpt-5.4-mini",
        usage: { input_tokens: 80, output_tokens: 30 },
      })),
      fetchImpl,
      apiKey: "test-openai-key",
      recordUsage,
    });

    expect(recordUsage).toHaveBeenCalledWith("user-1", expect.objectContaining({
      eventType: "planner",
      model: "gpt-5.4-mini",
      usage: { input_tokens: 80, output_tokens: 30 },
      metadata: { planned: true },
    }));
    expect(recordUsage).toHaveBeenCalledWith("user-1", expect.objectContaining({
      eventType: "query_embedding",
      model: "text-embedding-3-small",
      estimated: true,
      metadata: expect.objectContaining({ vector_status: "ok" }),
    }));
    expect(recordUsage).toHaveBeenCalledWith("user-1", expect.objectContaining({
      eventType: "answer",
      model: "gpt-5.4-mini",
      usage: { input_tokens: 100, output_tokens: 50 },
      metadata: expect.objectContaining({
        source_count: 1,
        retrieval_mode: "hybrid",
      }),
    }));
  });

  it("preserves source rows when answer generation fails after retrieval", async () => {
    const result = await answerInboxAiSearch("user-1", {
      q: "what payment is due?",
      retrieve: vi.fn(async () => retrieval()),
      planner: null,
      fetchImpl: vi.fn(async () => ({ ok: false, status: 429, text: async () => "rate limited" })),
      apiKey: "test-openai-key",
    });

    expect(result).toMatchObject({
      answer_status: "error",
      answer: null,
      answer_error: {
        code: "inbox_ai_answer_provider_error",
      },
      sources: [expect.objectContaining({ uid: "source-1" })],
    });
  });

  it("fails closed without calling the model when retrieval has no candidates", async () => {
    const fetchImpl = vi.fn();
    const result = await answerInboxAiSearch("user-1", {
      q: "nothing",
      retrieve: vi.fn(async () => retrieval([])),
      planner: null,
      fetchImpl,
      apiKey: "test-openai-key",
    });

    expect(result).toMatchObject({
      answer_status: "no_sources",
      answer: null,
      sources: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed structured output", () => {
    expect(() => parseInboxAiAnswerOutput({
      answer: "",
      confidence: "certain",
      cited_source_uids: "source-1",
    }, new Set(["source-1"]))).toThrow(/Invalid inbox AI answer/);
  });
});
