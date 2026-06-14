import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlfredStream } from "./api.js";

function sseResponse(frames) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return { ok: true, status: 200, body };
}

describe("runAlfredStream", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs with CSRF header and streams events to onEvent", async () => {
    fetch.mockResolvedValue(sseResponse([
      'event: run_start\ndata: {"type":"run_start","conversation_id":"c1","model":"claude-sonnet-4-6"}\n\n',
      'event: run_end\ndata: {"type":"run_end","stop_reason":"end_turn"}\n\n',
    ]));
    const onEvent = vi.fn();

    await runAlfredStream({
      message: "hi",
      conversationId: "c1",
      model: "claude-sonnet-4-6",
      onEvent,
    });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/alfred/run");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Requested-With"]).toBe("Setpoint");
    expect(JSON.parse(init.body)).toEqual({
      message: "hi",
      conversationId: "c1",
      model: "claude-sonnet-4-6",
    });
    expect(onEvent.mock.calls.map(([e]) => e.type)).toEqual(["run_start", "run_end"]);
  });

  it("throws the server message on a non-ok response", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "Unknown model" }),
    });
    await expect(runAlfredStream({ message: "hi", onEvent: vi.fn() }))
      .rejects.toThrow("Unknown model");
  });
});
