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

    expect(events.map((event) => event.type)).toEqual([
      "tool_start", "tool_result", "text_delta", "run_end",
    ]);
    expect(events[1]).toEqual(expect.objectContaining({
      ok: true,
      summary: "Bills · 1 upcoming",
    }));
    // Transcript: user, assistant(tool_use), user(tool_result), assistant(text)
    expect(conversation.messages).toHaveLength(4);
    expect(conversation.messages[2].role).toBe("user");
    expect(conversation.messages[2].content[0]).toEqual(expect.objectContaining({
      type: "tool_result",
      tool_use_id: "tu_1",
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(recordUsage).toHaveBeenCalledTimes(2);
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
