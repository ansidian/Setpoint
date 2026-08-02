import { beforeEach, describe, expect, it, vi } from "vitest";
import { looksLikeGroupingQuestion, runAlfred } from "./alfred-run.ts";
import {
  clearAlfredConversations,
  createAlfredConversation,
} from "./alfred-conversations.ts";
import type { AlfredRunEvent } from "../../shared/types/alfred.ts";
import type {
  AlfredConversation,
  AlfredDependencies,
  AlfredFetch,
  AlfredUsageRecorder,
  AnthropicMessage,
} from "./alfred-types.ts";

interface DenseArray<T> extends Array<T> {
  [index: number]: T;
  at(index: number): T;
  find(predicate: (value: T, index: number, obj: T[]) => unknown): T;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U): DenseArray<U>;
}
type TestConversation = Omit<AlfredConversation, "messages"> & { messages: DenseArray<AnthropicMessage> };
type SseTestEvent = Record<string, unknown> & { type: string };

function testDeps(overrides: Partial<AlfredDependencies> = {}): AlfredDependencies {
  return overrides as AlfredDependencies;
}

function sseBody(events: SseTestEvent[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  const frames = events.map((data) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
  return (async function* generate() {
    for (const frame of frames) yield encoder.encode(frame);
  }());
}

function textTurn(text: string, stopReason = "end_turn"): SseTestEvent[] {
  return [
    { type: "message_start", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 5 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ];
}

function toolUseTurn(name: string, input: Record<string, unknown>, id = "tu_1"): SseTestEvent[] {
  return [
    { type: "message_start", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 5 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
    { type: "message_stop" },
  ];
}

function fetchScript(turns: SseTestEvent[][]) {
  let call = 0;
  const fetchImpl = vi.fn<AlfredFetch>(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    body: sseBody(turns[Math.min(call++, turns.length - 1)] || []),
  }));
  return fetchImpl;
}

describe("looksLikeGroupingQuestion", () => {
  it("treats a split into 2+ categories as a grouping question", () => {
    expect(looksLikeGroupingQuestion("how many were rejections, how many ghosts?")).toBe(true);
    expect(looksLikeGroupingQuestion("break my spending down by category")).toBe(true);
    expect(looksLikeGroupingQuestion("group my bills by status")).toBe(true);
    expect(looksLikeGroupingQuestion("what's the distribution of my deadlines?")).toBe(true);
    expect(looksLikeGroupingQuestion("rejections vs ghosts in the last 3 months")).toBe(true);
  });

  it("does not treat a single count or a magnitude as a grouping question", () => {
    // A lone "how many" is one number, and "how much" is a sum — both read fine in
    // one line; nudging them toward a breakdown card would force a 1-bucket card.
    expect(looksLikeGroupingQuestion("how many deadlines do I have?")).toBe(false);
    expect(looksLikeGroupingQuestion("how much did I spend on coffee?")).toBe(false);
    expect(looksLikeGroupingQuestion("what's on my calendar tomorrow?")).toBe(false);
  });
});

describe("runAlfred", () => {
  let conversation: TestConversation;
  let emit: ReturnType<typeof vi.fn<(event: AlfredRunEvent) => void>>;
  let events: DenseArray<AlfredRunEvent & Record<string, unknown>>;
  let recordUsage: ReturnType<typeof vi.fn<AlfredUsageRecorder>>;

  beforeEach(() => {
    clearAlfredConversations();
    conversation = createAlfredConversation({ now: 0 }) as TestConversation;
    events = [] as unknown as DenseArray<AlfredRunEvent & Record<string, unknown>>;
    emit = vi.fn((event: AlfredRunEvent) => { events.push(event as AlfredRunEvent & Record<string, unknown>); });
    recordUsage = vi.fn<AlfredUsageRecorder>().mockResolvedValue(undefined);
  });

  it("reverts a dangling user turn when a run throws, keeping the conversation reusable (P2-19)", async () => {
    const overloaded = vi.fn<AlfredFetch>(async () => ({ ok: false, status: 529, text: async () => "overloaded" }));
    await expect(runAlfred({
      userId: "user-1", conversation, message: "first question",
      emit, fetchImpl: overloaded, apiKey: "key", deps: testDeps(), recordUsage,
    })).rejects.toThrow();
    // The just-pushed user turn must be removed so reuse doesn't send two
    // consecutive user messages (which the Anthropic Messages API 400s).
    expect(conversation.messages).toHaveLength(0);

    // A retry on the same conversation then produces a valid alternating transcript.
    const ok = fetchScript([textTurn("Recovered.")]);
    await runAlfred({
      userId: "user-1", conversation, message: "second question",
      emit, fetchImpl: ok, apiKey: "key", deps: testDeps(), recordUsage,
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
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps(),
      recordUsage,
    });

    expect(events.map((event) => event.type)).toEqual(["text_delta", "run_end"]);
    expect(events[0]!.text).toBe("All clear today.");
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
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps({ readBillsMirrorRange }),
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
    expect(conversation.messages[2]!.role).toBe("user");
    const toolResultContent = conversation.messages[2]!.content;
    expect(Array.isArray(toolResultContent) ? toolResultContent[0] : null).toEqual(expect.objectContaining({
      type: "tool_result",
      tool_use_id: "tu_1",
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // 3 model turns (alfred_run_turn) + 1 tool call (alfred_tool_call) = 4 records.
    expect(recordUsage).toHaveBeenCalledTimes(4);
  });

  it("records an alfred_tool_call usage row per tool call (T1)", async () => {
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
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps({ readBillsMirrorRange }),
      recordUsage,
    });

    const toolRow = recordUsage.mock.calls
      .map((call) => call[1])
      .find((arg) => arg.eventType === "alfred_tool_call");
    expect(toolRow).toBeTruthy();
    if (!toolRow) throw new Error("Expected Alfred tool usage row");
    expect(toolRow.metadata.tool).toBe("get_upcoming_bills");
    expect(toolRow.metadata.ok).toBe(true);
    expect(typeof toolRow.metadata.duration_ms).toBe("number");
    expect(toolRow.metadata.conversation_id).toBe(conversation.id);
  });

  it("marks the last block of the last outgoing message as a cache breakpoint", async () => {
    const fetchImpl = fetchScript([textTurn("All clear today.")]);

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "What's left today?",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps(),
      recordUsage,
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
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
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps({ readBillsMirrorRange }),
      recordUsage,
    });

    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
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
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps({ readBillsMirrorRange }),
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
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps({ readCalendarDeadlineRange }),
      recordUsage,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(events.at(-1).type).toBe("run_end");
  });

  it("does not nudge when the run grouped retrieved items via group_items", async () => {
    const fetchImpl = fetchScript([
      toolUseTurn("get_upcoming_bills", { start: "2026-06-12", end: "2026-07-12" }),
      toolUseTurn("group_items", { kind: "bill", title: "By status", groups: [{ label: "Unpaid", ids: ["b-1"] }] }, "tu_2"),
      textTurn("One unpaid bill."),
    ]);
    const readBillsMirrorRange = vi.fn().mockResolvedValue({
      schedules: [{ id: "b-1", name: "Car insurance", payee: "Geico", amount: 182.13, next_date: "2026-06-21", paid: false, type: "bill" }],
      syncHealth: { state: "current" },
    });

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "group my bills by status",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps({ readBillsMirrorRange }),
      recordUsage,
    });

    // group_items satisfies cite-by-reference → no nudge → 3 model calls, not 4.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(events.some((e) => e.type === "breakdown")).toBe(true);
    expect(events.at(-1).type).toBe("run_end");
    const nudge = conversation.messages.find(
      (entry) => entry.role === "user" && typeof entry.content === "string" && entry.content.includes("<system-reminder>"),
    );
    expect(nudge).toBeUndefined();
  });

  it("nudges toward group_items when a split question is answered in prose without a card", async () => {
    const fetchImpl = fetchScript([
      toolUseTurn("get_deadlines", { start: "2026-06-01", end: "2026-09-01" }),
      textTurn("3 are overdue and the rest are upcoming."),
      toolUseTurn("group_items", {
        kind: "deadline",
        title: "By status",
        groups: [{ label: "Overdue", ids: ["td-0"] }, { label: "Upcoming", ids: ["td-1"] }],
      }, "tu_2"),
      textTurn("3 overdue, 9 upcoming."),
    ]);
    // 13 rows > MAX_NUDGE_ITEMS (12, one default search page), so the small-set
    // show_items backstop can't fire — only the split/categorize backstop can,
    // which keeps this test unambiguous.
    const upcoming = Array.from({ length: 13 }, (_, i) => ({
      id: `td-${i}`, content: `Task ${i}`, due_date: "2026-07-01", status: "incomplete",
    }));
    const readCalendarDeadlineRange = vi.fn().mockResolvedValue({ payload: { upcoming }, errors: [] });

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "how many of my deadlines are overdue, and how many are upcoming?",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps({ readCalendarDeadlineRange }),
      recordUsage,
    });

    const nudge = conversation.messages.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("group_items"),
    );
    expect(nudge).toBeDefined();
    expect(nudge.content).toContain("<system-reminder>");
    // The nudge drove a real breakdown card, then the run ended cleanly.
    expect(events.some((e) => e.type === "breakdown")).toBe(true);
    expect(events.at(-1).type).toBe("run_end");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not nudge when summarize_transactions returns a low dollar total (its total is a dollar sum, not a row count)", async () => {
    const fetchImpl = fetchScript([
      toolUseTurn("summarize_transactions", { start: "2026-05-01", end: "2026-05-31" }),
      textTurn("You spent $5.00 on coffee in May."),
    ]);
    const summarizeTransactions = vi.fn().mockResolvedValue({
      total: 5,
      period: { start: "2026-05-01", end: "2026-05-31" },
      group_by: "category",
      buckets: [{ label: "Coffee", amount: 5, count: 1 }],
    });

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "how much did I spend on coffee?",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps({ summarizeTransactions }),
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
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps({ readCalendarDeadlineRange }),
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
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps({ getEmailBody }),
      recordUsage,
    });

    const toolResult = events.find((event) => event.type === "tool_result");
    expect(toolResult.ok).toBe(false);
    const failedToolContent = conversation.messages[2]!.content;
    const failedToolBlock = Array.isArray(failedToolContent) ? failedToolContent[0] : undefined;
    expect(failedToolBlock && "is_error" in failedToolBlock ? failedToolBlock.is_error : undefined).toBe(true);
    expect(events.at(-1).type).toBe("run_end");
  });

  it("throws on a non-ok API response", async () => {
    const fetchImpl = vi.fn<AlfredFetch>(async () => ({ ok: false, status: 529, text: async () => "overloaded" }));
    await expect(runAlfred({
      userId: "user-1",
      conversation,
      message: "hi",
      emit,
      fetchImpl,
      apiKey: "key",
      deps: testDeps(),
      recordUsage,
    })).rejects.toThrow("Anthropic API error (529)");
  });
});
