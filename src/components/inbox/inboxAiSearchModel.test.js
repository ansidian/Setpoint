import { describe, expect, it } from "vitest";
import {
  EMPTY_INBOX_AI_SEARCH,
  clearInboxAiSearch,
  completeInboxAiRequest,
  failInboxAiRequest,
  inboxAiSemanticStatus,
  normalizeInboxAiSearchResponse,
  requestInboxAiConfirmation,
  startInboxAiRequest,
} from "./inboxAiSearchModel.js";

function aiResponse(overrides = {}) {
  return {
    answer_status: "ok",
    answer: {
      answer: "Amazon says the return deadline is May 12.",
      confidence: "medium",
      cited_source_uids: ["source-1"],
      missing_info: [],
      low_confidence_reason: "",
    },
    retrieval: {
      mode: "hybrid",
      vector_status: "ok",
      lexical_status: "ok",
      total_candidates: 4,
    },
    sources: [{
      uid: "source-1",
      sender: "Amazon Returns <returns@amazon.com>",
      subject: "Return reminder",
      date: "2026-05-08T15:00:00.000Z",
      snippet: "Return by May 12.",
      account: {
        id: "gmail-personal",
        label: "Personal",
        email: "me@example.com",
        color: "#cba6da",
      },
      metadata: { lane: "needs_attention" },
    }],
    ...overrides,
  };
}

describe("inbox AI search model", () => {
  it("opens confirmation only for a meaningful query", () => {
    expect(requestInboxAiConfirmation(EMPTY_INBOX_AI_SEARCH, "x")).toBe(EMPTY_INBOX_AI_SEARCH);

    const state = requestInboxAiConfirmation(EMPTY_INBOX_AI_SEARCH, "  amazon return  ");

    expect(state).toMatchObject({
      status: "confirming",
      query: "amazon return",
      answer: null,
      emails: [],
    });
  });

  it("ignores stale AI responses by request id", () => {
    const loading = startInboxAiRequest(EMPTY_INBOX_AI_SEARCH, "amazon return", 2);

    const stale = completeInboxAiRequest(loading, {
      requestId: 1,
      response: aiResponse(),
    });
    const current = completeInboxAiRequest(loading, {
      requestId: 2,
      response: aiResponse(),
    });

    expect(stale).toBe(loading);
    expect(current.status).toBe("answer");
    expect(current.emails).toHaveLength(1);
    expect(current.accountsById["gmail-personal"].name).toBe("Personal");
  });

  it("keeps stale errors from replacing a newer request", () => {
    const loading = startInboxAiRequest(EMPTY_INBOX_AI_SEARCH, "security alert", 5);

    expect(failInboxAiRequest(loading, {
      requestId: 4,
      error: new Error("old failure"),
    })).toBe(loading);
    expect(failInboxAiRequest(loading, {
      requestId: 5,
      error: new Error("provider unavailable"),
    })).toMatchObject({
      status: "error",
      error: "provider unavailable",
    });
  });

  it("normalizes grounded sources into reusable inbox rows", () => {
    const normalized = normalizeInboxAiSearchResponse(aiResponse(), { "source-1": true });

    expect(normalized.emails[0]).toMatchObject({
      id: "source-1",
      uid: "source-1",
      from: "Amazon Returns",
      fromEmail: "returns@amazon.com",
      read: true,
      _accountKey: "gmail-personal",
      _indexedSearch: true,
      _inboxAiSource: true,
    });
  });

  it("clears answer state when the query is edited or AI mode is canceled", () => {
    const answered = completeInboxAiRequest(
      startInboxAiRequest(EMPTY_INBOX_AI_SEARCH, "amazon return", 1),
      { requestId: 1, response: aiResponse() },
    );

    expect(clearInboxAiSearch(answered)).toEqual({
      ...EMPTY_INBOX_AI_SEARCH,
      requestId: 1,
    });
  });

  it("formats compact semantic status without exposing debug planner details", () => {
    expect(inboxAiSemanticStatus({
      vector_status: "ok",
      total_candidates: 2,
    })).toBe("Semantic + indexed mail · 2 candidates");
    expect(inboxAiSemanticStatus({
      vector_status: "unavailable",
      total_candidates: 1,
    })).toBe("Indexed fallback · 1 candidate");
  });
});
