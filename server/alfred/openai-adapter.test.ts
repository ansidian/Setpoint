import { describe, expect, it, vi } from "vitest";
import { createAlfredConversation } from "./alfred-conversations.ts";
import { runAlfred } from "./alfred-run.ts";
import type { AlfredDependencies, AlfredFetch, AlfredUsageRecorder } from "./alfred-types.ts";
import type { AlfredRunEvent } from "../../shared/types/alfred.ts";

function responseStream(event: Record<string, unknown>): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  const frames = [
    ...(event.delta ? [{ type: "response.output_text.delta", delta: event.delta }] : []),
    { type: "response.completed", response: event.response },
  ];
  return (async function* generate() {
    for (const frame of frames) yield encoder.encode(`data: ${JSON.stringify(frame)}\n\n`);
  }());
}

describe("OpenAI Alfred adapter", () => {
  it("runs the Responses function-call loop and replays stateless output items", async () => {
    const turns = [
      {
        response: {
          status: "completed",
          model: "gpt-5.6-sol",
          usage: {
            input_tokens: 10,
            input_tokens_details: { cached_tokens: 4 },
            output_tokens: 6,
          },
          output: [{
            type: "function_call",
            id: "fc-item-1",
            call_id: "call-1",
            name: "get_email_body",
            arguments: JSON.stringify({ uid: "mail-1" }),
          }],
        },
      },
      {
        delta: "I couldn't open that message.",
        response: {
          status: "completed",
          model: "gpt-5.6-sol",
          usage: { input_tokens: 18, output_tokens: 8 },
          output: [{
            type: "message",
            id: "msg-1",
            role: "assistant",
            content: [{ type: "output_text", text: "I couldn't open that message." }],
          }],
        },
      },
    ];
    let call = 0;
    const fetchImpl = vi.fn<AlfredFetch>(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      body: responseStream(turns[call++]!),
    }));
    const events: AlfredRunEvent[] = [];
    const recordUsage = vi.fn<AlfredUsageRecorder>().mockResolvedValue(undefined);
    const getEmailBody = vi.fn().mockRejectedValue(new Error("mail provider down"));
    const conversation = createAlfredConversation({ provider: "openai", model: "gpt-5.6-sol" });

    await runAlfred({
      userId: "user-1",
      conversation,
      message: "Open that email",
      emit: (event) => events.push(event),
      fetchImpl,
      apiKey: "openai-key",
      deps: { getEmailBody } as unknown as AlfredDependencies,
      recordUsage,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.type)).toEqual([
      "tool_start",
      "tool_result",
      "text_delta",
      "run_end",
    ]);
    expect(events[1]).toMatchObject({ ok: false, tool_id: "call-1" });

    const firstRequest = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/responses");
    expect(firstRequest).toMatchObject({
      model: "gpt-5.6-sol",
      stream: true,
      store: false,
      include: ["reasoning.encrypted_content"],
    });
    expect(firstRequest.tools[0]).toMatchObject({ type: "function", name: expect.any(String) });

    const secondRequest = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(secondRequest.input.map((item: { type?: string; role?: string }) => item.type || item.role))
      .toEqual(["user", "function_call", "function_call_output"]);
    expect(secondRequest.input[2]).toMatchObject({ call_id: "call-1" });

    const runUsage = recordUsage.mock.calls.map((entry) => entry[1])
      .filter((entry) => entry.eventType === "alfred_run_turn");
    expect(runUsage[0]?.usage).toMatchObject({
      input_tokens: 10,
      cache_read_input_tokens: 4,
      output_tokens: 6,
    });
    expect(runUsage.every((entry) => entry.metadata.provider === "openai")).toBe(true);
  });
});
