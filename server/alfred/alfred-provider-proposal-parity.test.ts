import { describe, expect, it, vi } from "vitest";
import { createAlfredConversation } from "./alfred-conversations.ts";
import { runAlfred } from "./alfred-run.ts";
import type { AlfredDependencies, AlfredFetch } from "./alfred-types.ts";

function anthropicBody(): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  const events = [
    { type: "message_start", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  return (async function* stream() {
    for (const event of events) yield encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }());
}

function openAiBody(): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  const event = {
    type: "response.completed",
    response: {
      status: "completed",
      model: "gpt-5.6-sol",
      usage: { input_tokens: 1, output_tokens: 1 },
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] }],
    },
  };
  return (async function* stream() {
    yield encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  }());
}

describe("Alfred provider proposal schema parity", () => {
  it("exposes the same allowlisted non-mutating proposal contract to Anthropic and OpenAI", async () => {
    const anthropicFetch = vi.fn<AlfredFetch>(async () => ({
      ok: true, status: 200, text: async () => "", body: anthropicBody(),
    }));
    const openAiFetch = vi.fn<AlfredFetch>(async () => ({
      ok: true, status: 200, text: async () => "", body: openAiBody(),
    }));
    const common = {
      userId: "user-1",
      message: "What is on my calendar?",
      emit: vi.fn(),
      apiKey: "key",
      deps: {} as AlfredDependencies,
      recordUsage: vi.fn().mockResolvedValue(undefined),
    };

    await runAlfred({
      ...common,
      conversation: createAlfredConversation({ provider: "anthropic", model: "claude-sonnet-4-6" }),
      fetchImpl: anthropicFetch,
    });
    await runAlfred({
      ...common,
      conversation: createAlfredConversation({ provider: "openai", model: "gpt-5.6-sol" }),
      fetchImpl: openAiFetch,
    });

    // test-architecture: allow-boundary-interaction -- These provider request payloads are the outbound AI boundary; schema equality is the observable parity contract.
    const anthropicRequest = JSON.parse(String(anthropicFetch.mock.calls[0]?.[1]?.body));
    // test-architecture: allow-boundary-interaction -- These provider request payloads are the outbound AI boundary; schema equality is the observable parity contract.
    const openAiRequest = JSON.parse(String(openAiFetch.mock.calls[0]?.[1]?.body));
    const anthropicProposal = anthropicRequest.tools.find((tool: { name: string }) => tool.name === "propose_calendar_event");
    const openAiProposal = openAiRequest.tools.find((tool: { name: string }) => tool.name === "propose_calendar_event");

    expect(anthropicProposal.input_schema).toEqual(openAiProposal.parameters);
    expect(Object.keys(anthropicProposal.input_schema.properties).sort()).toEqual([
      "all_day",
      "calendar_name",
      "description",
      "end_date",
      "end_time",
      "location",
      "start_date",
      "start_time",
      "title",
    ]);
    expect(anthropicProposal.input_schema.additionalProperties).toBe(false);
  });
});
