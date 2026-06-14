import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAlfred } from "./alfred-run.js";
import {
  _clearAlfredConversationsForTest,
  createAlfredConversation,
} from "./alfred-conversations.js";

function sseBody(events) {
  const encoder = new TextEncoder();
  const frames = events.map((data) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
  return (async function* generate() {
    for (const frame of frames) yield encoder.encode(frame);
  }());
}

function textTurn(text, stopReason = "end_turn") {
  return [
    { type: "message_start", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 5 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ];
}

function toolUseTurn(name, input, id = "tu_1") {
  return [
    { type: "message_start", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 5 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
    { type: "message_stop" },
  ];
}

function fetchScript(turns) {
  let call = 0;
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    body: sseBody(turns[Math.min(call++, turns.length - 1)]),
  }));
  return fetchImpl;
}

describe("runAlfred", () => {
  let conversation;
  let emit;
  let events;
  let recordUsage;

  beforeEach(() => {
    _clearAlfredConversationsForTest();
    conversation = createAlfredConversation({ now: 0 });
    events = [];
    emit = vi.fn((event) => events.push(event));
    recordUsage = vi.fn().mockResolvedValue(undefined);
  });

  it("reverts a dangling user turn when a run throws, keeping the conversation reusable (P2-19)", async () => {
    const overloaded = vi.fn(async () => ({ ok: false, status: 529, text: async () => "overloaded" }));
    await expect(runAlfred({
      userId: "user-1", conversation, message: "first question", model: "claude-sonnet-4-6",
      emit, fetchImpl: overloaded, apiKey: "key", deps: {}, recordUsage,
    })).rejects.toThrow();
    // The just-pushed user turn must be removed so reuse doesn't send two
    // consecutive user messages (which the Anthropic Messages API 400s).
    expect(conversation.messages).toHaveLength(0);

    // A retry on the same conversation then produces a valid alternating transcript.
    const ok = fetchScript([textTurn("Recovered.")]);
    await runAlfred({
      userId: "user-1", conversation, message: "second question", model: "claude-sonnet-4-6",
      emit, fetchImpl: ok, apiKey: "key", deps: {}, recordUsage,
    });
    const roles = conversation.messages.map((m) => m.role);
    expect(roles.some((role, i) => i > 0 && role === "user" && roles[i - 1] === "user")).toBe(false);
    expect(conversation.messages.at(-1).role).toBe("assistant");
  });

  it("streams a plain text answer and ends the run", async () => {
    const fetchImpl = fetchScript([textTurn("All clear today.")]);

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "What's left today?",
      model: "claude-sonnet-4-6",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: {},
      recordUsage,
    });

    expect(events.map((event) => event.type)).toEqual(["text_delta", "run_end"]);
    expect(events[0].text).toBe("All clear today.");
    expect(conversation.messages).toEqual([
      { role: "user", content: "What's left today?" },
      { role: "assistant", content: [{ type: "text", text: "All clear today." }] },
    ]);
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });

  it("executes tool calls between turns and threads results back", async () => {
    const fetchImpl = fetchScript([
      toolUseTurn("get_upcoming_bills", { start: "2026-06-12", end: "2026-07-12" }),
      textTurn("One bill is due."),
    ]);
    const readBillsMirrorRange = vi.fn().mockResolvedValue({
      schedules: [{ id: "b-1", name: "Car insurance", payee: "Geico", amount: 182.13, next_date: "2026-06-21", paid: false, type: "bill" }],
      syncHealth: { state: "current" },
    });

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "Any bills coming up?",
      model: "claude-sonnet-4-6",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: { readBillsMirrorRange },
      recordUsage,
    });

    // The prose-only answer about a retrieved bill triggers the show_items
    // nudge once; the scripted model answers in prose again and the run ends.
    expect(events.map((event) => event.type)).toEqual([
      "tool_start", "tool_result", "text_delta", "text_delta", "run_end",
    ]);
    expect(events[1]).toEqual(expect.objectContaining({
      ok: true,
      summary: "Bills · 1 upcoming",
    }));
    // Transcript: user, assistant(tool_use), user(tool_result),
    // assistant(text), user(nudge), assistant(text)
    expect(conversation.messages).toHaveLength(6);
    expect(conversation.messages[2].role).toBe("user");
    expect(conversation.messages[2].content[0]).toEqual(expect.objectContaining({
      type: "tool_result",
      tool_use_id: "tu_1",
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(recordUsage).toHaveBeenCalledTimes(3);
  });

  it("marks the last block of the last outgoing message as a cache breakpoint", async () => {
    const fetchImpl = fetchScript([textTurn("All clear today.")]);

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "What's left today?",
      model: "claude-sonnet-4-6",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: {},
      recordUsage,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const lastMessage = body.messages.at(-1);
    expect(lastMessage.content).toEqual([
      { type: "text", text: "What's left today?", cache_control: { type: "ephemeral" } },
    ]);
    // Exactly one breakpoint per request — prefix = tools + system + transcript.
    expect(JSON.stringify(body).match(/cache_control/g)).toHaveLength(1);
    // The stored transcript keeps its plain-string shape, unmarked.
    expect(conversation.messages[0]).toEqual({ role: "user", content: "What's left today?" });
  });

  it("moves the cache breakpoint onto the tool_result block on follow-up turns", async () => {
    const fetchImpl = fetchScript([
      toolUseTurn("get_upcoming_bills", { start: "2026-06-12", end: "2026-07-12" }),
      textTurn("One bill is due."),
    ]);
    const readBillsMirrorRange = vi.fn().mockResolvedValue({ schedules: [], syncHealth: { state: "current" } });

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "Any bills coming up?",
      model: "claude-sonnet-4-6",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: { readBillsMirrorRange },
      recordUsage,
    });

    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    const lastMessage = secondBody.messages.at(-1);
    expect(lastMessage.content.at(-1)).toEqual(expect.objectContaining({
      type: "tool_result",
      cache_control: { type: "ephemeral" },
    }));
    expect(JSON.stringify(secondBody).match(/cache_control/g)).toHaveLength(1);
    // No marker leaks into the stored transcript.
    expect(JSON.stringify(conversation.messages)).not.toContain("cache_control");
  });

  it("nudges the model once when it answers about retrieved items without show_items", async () => {
    const fetchImpl = fetchScript([
      toolUseTurn("get_upcoming_bills", { start: "2026-06-12", end: "2026-07-12" }),
      textTurn("Your car insurance is due June 21."),
      toolUseTurn("show_items", { kind: "bill", ids: ["b-1"] }, "tu_2"),
      textTurn("Due in nine days."),
    ]);
    const readBillsMirrorRange = vi.fn().mockResolvedValue({
      schedules: [{ id: "b-1", name: "Car insurance", payee: "Geico", amount: 182.13, next_date: "2026-06-21", paid: false, type: "bill" }],
      syncHealth: { state: "current" },
    });

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "When is my car insurance due?",
      model: "claude-haiku-4-5-20251001",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: { readBillsMirrorRange },
      recordUsage,
    });

    // The prose answer streams, then the nudge produces real rows.
    expect(events.map((event) => event.type)).toEqual([
      "tool_start", "tool_result", "text_delta",
      "tool_start", "rows", "tool_result", "text_delta", "run_end",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const nudge = conversation.messages.find(
      (entry) => entry.role === "user" && typeof entry.content === "string" && entry.content.includes("show_items"),
    );
    expect(nudge.content).toContain("<system-reminder>");
  });

  it("does not nudge when the result set is too large to plausibly be named", async () => {
    const fetchImpl = fetchScript([
      toolUseTurn("get_deadlines", { start: "2026-06-12", end: "2026-09-12" }),
      textTurn("You have 37 open deadlines this quarter."),
    ]);
    const upcoming = Array.from({ length: 37 }, (_, i) => ({
      id: `td-${i}`, content: `Task ${i}`, due_date: "2026-07-01", status: "incomplete",
    }));
    const readCalendarDeadlineRange = vi.fn().mockResolvedValue({ payload: { upcoming }, errors: [] });

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "how many deadlines do I have?",
      model: "claude-haiku-4-5-20251001",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: { readCalendarDeadlineRange },
      recordUsage,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(events.at(-1).type).toBe("run_end");
  });

  it("nudge text includes 'transactions' when a small search_transactions result is returned without show_items", async () => {
    const fetchImpl = fetchScript([
      toolUseTurn("search_transactions", { start: "2026-05-01", end: "2026-05-31" }),
      textTurn("You spent $42.10 at Trader Joes."),
    ]);
    const queryTransactions = vi.fn().mockResolvedValue({
      total: 1,
      truncated: false,
      transactions: [{ id: "t1", date: "2026-05-05", amount: 42.1, payee: "Trader Joes", category: "Groceries", account: "Checking" }],
    });

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "what did I spend at trader joes?",
      model: "claude-haiku-4-5-20251001",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: { queryTransactions },
      recordUsage,
    });

    const nudge = conversation.messages.find(
      (entry) => entry.role === "user" && typeof entry.content === "string" && entry.content.includes("show_items"),
    );
    expect(nudge).toBeDefined();
    expect(nudge.content).toContain("<system-reminder>");
    expect(nudge.content).toContain("transactions");
  });

  it("does not nudge when summarize_spending returns a low dollar total (its total is a dollar sum, not a row count)", async () => {
    const fetchImpl = fetchScript([
      toolUseTurn("summarize_spending", { start: "2026-05-01", end: "2026-05-31" }),
      textTurn("You spent $5.00 on coffee in May."),
    ]);
    const summarizeSpending = vi.fn().mockResolvedValue({
      total: 5,
      period: { start: "2026-05-01", end: "2026-05-31" },
      group_by: "category",
      buckets: [{ label: "Coffee", amount: 5, count: 1 }],
    });

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "how much did I spend on coffee?",
      model: "claude-haiku-4-5-20251001",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: { summarizeSpending },
      recordUsage,
    });

    expect(conversation.messages.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("show_items"),
    )).toBeUndefined();
    expect(events.at(-1).type).toBe("run_end");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops with run_error at the iteration cap", async () => {
    const fetchImpl = fetchScript([
      toolUseTurn("get_deadlines", { start: "2026-06-12", end: "2026-06-13" }),
    ]);
    const readCalendarDeadlineRange = vi.fn().mockResolvedValue({ payload: { upcoming: [] }, errors: [] });

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "loop forever",
      model: "claude-sonnet-4-6",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: { readCalendarDeadlineRange },
      recordUsage,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(12);
    expect(events.at(-1).type).toBe("run_error");
  });

  it("surfaces a failed tool to the model instead of crashing the run", async () => {
    const fetchImpl = fetchScript([
      toolUseTurn("get_email_body", { uid: "em-9" }),
      textTurn("Could not open that email."),
    ]);
    const getEmailBody = vi.fn().mockRejectedValue(new Error("provider down"));

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "open it",
      model: "claude-sonnet-4-6",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: { getEmailBody },
      recordUsage,
    });

    const toolResult = events.find((event) => event.type === "tool_result");
    expect(toolResult.ok).toBe(false);
    expect(conversation.messages[2].content[0].is_error).toBe(true);
    expect(events.at(-1).type).toBe("run_end");
  });

  it("throws on a non-ok API response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 529, text: async () => "overloaded" }));
    await expect(runAlfred({
      userId: "user-1",
      conversation,
      message: "hi",
      model: "claude-sonnet-4-6",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: {},
      recordUsage,
    })).rejects.toThrow("Anthropic API error (529)");
  });
});
