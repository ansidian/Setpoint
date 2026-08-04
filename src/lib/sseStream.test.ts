import { describe, expect, it, vi } from "vitest";
import { readSseStream } from "./sseStream";

function streamOf(strings: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const s of strings) controller.enqueue(encoder.encode(s));
      controller.close();
    },
  });
}

function frame(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

describe("readSseStream", () => {
  it("parses each frame's data payload and reports it in order", async () => {
    const onEvent = vi.fn();
    await readSseStream(streamOf([
      frame("run_start", { conversation_id: "c1" }),
      frame("text_delta", { text: "Hi" }),
      frame("run_end", { stop_reason: "end_turn" }),
    ]), onEvent);

    expect(onEvent.mock.calls.map(([e]) => e.type)).toEqual([
      "run_start", "text_delta", "run_end",
    ]);
    expect(onEvent.mock.calls[1]![0].text).toBe("Hi");
  });

  it("handles frames split across chunk boundaries", async () => {
    const whole = frame("text_delta", { text: "split me" });
    const events: unknown[] = [];
    await readSseStream(streamOf([whole.slice(0, 21), whole.slice(21)]), (event) => events.push(event));
    expect(events).toEqual([expect.objectContaining({ text: "split me" })]);
  });

  it("ignores frames without a data line", async () => {
    const events: unknown[] = [];
    await readSseStream(streamOf([": keepalive\n\n", frame("run_end", {})]), (event) => events.push(event));
    expect(events).toEqual([expect.objectContaining({ type: "run_end" })]);
  });

  it("skips a malformed frame and continues reading later events", async () => {
    const onEvent = vi.fn();

    await readSseStream(streamOf([
      frame("run_start", { conversation_id: "c1" }),
      "data: {not json\n\n",
      frame("run_end", { stop_reason: "end_turn" }),
    ]), onEvent);

    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual([
      "run_start", "run_end",
    ]);
  });

  it("propagates errors thrown by the event consumer", async () => {
    const consumerError = new Error("consumer failed");

    await expect(readSseStream(
      streamOf([frame("run_start", { conversation_id: "c1" })]),
      () => { throw consumerError; },
    )).rejects.toBe(consumerError);
  });
});
