import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlfredStream } from "./api";

type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as Response;
}

describe("runAlfredStream", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn<TestFetch>());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the Alfred request with the CSRF header", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(sseResponse([
      'event: run_start\ndata: {"type":"run_start","conversation_id":"c1","provider":"anthropic","model":"claude-sonnet-4-6"}\n\n',
      'event: run_end\ndata: {"type":"run_end","stop_reason":"end_turn"}\n\n',
    ]));
    const onEvent = vi.fn();

    await runAlfredStream({
      message: "hi",
      conversationId: "c1",
      onEvent,
    });

    // test-architecture: allow-boundary-interaction -- Alfred HTTP/SSE transport is an outbound browser boundary; request and event wire data are the API facade's observable contract.
    const [url, init] = fetchMock.mock.calls[0]!;
    if (!init || typeof init.body !== "string") throw new Error("Expected Alfred request init");
    expect(url).toBe("/api/alfred/run");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("X-Requested-With")).toBe("Setpoint");
    expect(JSON.parse(init.body)).toEqual({
      message: "hi",
      conversationId: "c1",
    });
  });

  it("throws the server message on a non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "Unknown model" }),
    } as Response);
    await expect(runAlfredStream({ message: "hi", onEvent: vi.fn() }))
      .rejects.toThrow("Unknown model");
  });
});
