import { describe, expect, it, vi } from "vitest";
import { consumeAnthropicStream } from "./anthropic-stream.js";

function sse(events) {
  // Each entry: [eventName, dataObject]
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function* chunks(strings) {
  const encoder = new TextEncoder();
  for (const s of strings) yield encoder.encode(s);
}

describe("consumeAnthropicStream", () => {
  it("assembles streamed text and reports deltas", async () => {
    const onTextDelta = vi.fn();
    const stream = chunks(sse([
      ["message_start", { type: "message_start", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 10 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Two things " } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "need you." } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } }],
      ["message_stop", { type: "message_stop" }],
    ]));

    const turn = await consumeAnthropicStream(stream, { onTextDelta });

    expect(turn.content).toEqual([{ type: "text", text: "Two things need you." }]);
    expect(turn.stopReason).toBe("end_turn");
    expect(turn.model).toBe("claude-sonnet-4-6");
    expect(turn.usage).toEqual({ input_tokens: 10, output_tokens: 12 });
    expect(onTextDelta).toHaveBeenCalledWith("Two things ");
    expect(onTextDelta).toHaveBeenCalledWith("need you.");
  });

  it("assembles tool_use blocks from partial json deltas", async () => {
    const stream = chunks(sse([
      ["message_start", { type: "message_start", message: { model: "claude-sonnet-4-6", usage: {} } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_1", name: "search_email" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"car ins' } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'urance"}' } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } }],
      ["message_stop", { type: "message_stop" }],
    ]));

    const turn = await consumeAnthropicStream(stream, {});

    expect(turn.content).toEqual([
      { type: "tool_use", id: "tu_1", name: "search_email", input: { query: "car insurance" } },
    ]);
    expect(turn.stopReason).toBe("tool_use");
  });

  it("handles events split across chunk boundaries", async () => {
    const [full] = sse([
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ]);
    const rest = sse([
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} }],
    ]);
    const stream = chunks([full.slice(0, 25), full.slice(25), ...rest]);

    const turn = await consumeAnthropicStream(stream, {});
    expect(turn.content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("throws on an error event", async () => {
    const stream = chunks(sse([
      ["error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }],
    ]));
    await expect(consumeAnthropicStream(stream, {})).rejects.toThrow("Overloaded");
  });
});
