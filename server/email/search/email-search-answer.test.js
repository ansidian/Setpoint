import { describe, expect, it, vi } from "vitest";
import { answerInboxAiSearch } from "./email-search-answer.js";

const sourceCandidate = {
  uid: "source-1",
  subject: "Credit card payment due",
  body_snippet: "Payment due May 10",
  body_excerpt: `${"A".repeat(1200)}TAIL`,
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
    total: candidates.length,
    candidates,
  };
}

describe("inbox AI search service", () => {
  it("returns retrieval-only source rows without making an answer model request", async () => {
    const fetchImpl = vi.fn();

    const result = await answerInboxAiSearch("user-1", {
      q: "what payment is due?",
      retrieve: vi.fn(async () => retrieval()),
      planner: null,
      fetchImpl,
      apiKey: "test-openai-key",
    });

    expect(result).toMatchObject({
      answer_status: "ok",
      answer: null,
      sources: [
        expect.objectContaining({
          uid: "source-1",
          source_label: "Work (work@example.com)",
          sender: "Bank <alerts@bank.example>",
          subject: "Credit card payment due",
          snippet: "Payment due May 10",
          metadata: sourceCandidate.metadata,
          provenance: sourceCandidate.provenance,
        }),
      ],
      retrieval: {
        mode: "hybrid",
        vector_status: "ok",
        lexical_status: "ok",
        total_candidates: 1,
        date_window: null,
      },
    });
    expect(result.sources[0].body_excerpt).toHaveLength(1200);
    expect(result.sources[0].body_excerpt.endsWith("TAIL")).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records planner and query embedding usage without answer usage", async () => {
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
      fetchImpl: vi.fn(),
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
    expect(recordUsage.mock.calls.map(([, payload]) => payload.eventType)).toEqual([
      "planner",
      "query_embedding",
    ]);
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
});
