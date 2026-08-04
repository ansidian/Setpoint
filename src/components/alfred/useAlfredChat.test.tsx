import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlfredRunEvent } from "../../../shared/types/alfred";
import useAlfredChat from "./useAlfredChat";

interface RequestRecord { path: string; method: string; body: Record<string, unknown> | null }
let requests: RequestRecord[] = [];
let runs: Response[] = [];

function sseResponse(events: AlfredRunEvent[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function scriptedRun(events: AlfredRunEvent[]): void {
  runs.push(sseResponse(events));
}

function deferredRun(events: AlfredRunEvent[]): { response: Response; finish: () => void } {
  const encoder = new TextEncoder();
  let closeStream = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      }
      closeStream = () => {
        controller.enqueue(encoder.encode('event: run_end\ndata: {"type":"run_end","stop_reason":"end_turn"}\n\n'));
        controller.close();
      };
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    finish: () => closeStream(),
  };
}

beforeEach(() => {
  requests = [];
  runs = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(input), "https://setpoint.test").pathname;
    requests.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    if (path === "/api/alfred/run") return runs.shift() ?? sseResponse([]);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAlfredChat", () => {
  it("submits a message, streams events, and reuses the conversation id", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "text_delta", text: "All clear." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const { result } = renderHook(() => useAlfredChat());

    await act(async () => { await result.current.submit("What's left?"); });

    expect(result.current.messages.map((message) => message.type)).toEqual(["user", "say"]);
    expect(result.current.messages[1]).toMatchObject({ type: "say", text: "All clear." });
    expect(result.current.activeModel).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
    expect(result.current.busy).toBe(false);

    scriptedRun([{ type: "run_end", stop_reason: "end_turn" }]);
    await act(async () => { await result.current.submit("and tomorrow?"); });
    expect(requests.filter((request) => request.path === "/api/alfred/run")[1]?.body)
      .toEqual({ message: "and tomorrow?", conversationId: "c1" });
  });

  it("does not send a client-selected model", async () => {
    scriptedRun([{ type: "run_end", stop_reason: "end_turn" }]);
    const { result } = renderHook(() => useAlfredChat());
    await act(async () => { await result.current.submit("hi"); });
    expect(requests[0]?.body).toEqual({ message: "hi" });
  });

  it("appends an error line when the run fails", async () => {
    runs.push(new Response(JSON.stringify({ message: "api down" }), { status: 500, headers: { "content-type": "application/json" } }));
    const { result } = renderHook(() => useAlfredChat());
    await act(async () => { await result.current.submit("hi"); });
    expect(result.current.messages[result.current.messages.length - 1]).toMatchObject({ type: "error", text: "api down" });
    expect(result.current.busy).toBe(false);
  });

  it("ignores submits while busy", async () => {
    const pending = deferredRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
    ]);
    runs.push(pending.response);
    const { result } = renderHook(() => useAlfredChat());
    act(() => { void result.current.submit("first"); });
    await waitFor(() => expect(result.current.busy).toBe(true));
    await act(async () => { await result.current.submit("second"); });
    expect(result.current.messages.filter((message) => message.type === "user").map((message) => message.text)).toEqual(["first"]);
    await act(async () => { pending.finish(); });
  });

  it("new chat deletes the server conversation and clears local state", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c9", provider: "openai", model: "gpt-5.6-sol" },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const { result } = renderHook(() => useAlfredChat());
    await act(async () => { await result.current.submit("hi"); });

    act(() => result.current.newChat());

    expect(result.current.messages).toEqual([]);
    expect(result.current.activeModel).toBeNull();
    expect(result.current.busy).toBe(false);
    await waitFor(() => expect(requests).toContainEqual({ path: "/api/alfred/conversations/c9", method: "DELETE", body: null }));
  });

  it("new chat clears the composer draft", () => {
    const { result } = renderHook(() => useAlfredChat());
    act(() => result.current.setDraft("half-typed question"));
    expect(result.current.draft).toBe("half-typed question");

    act(() => result.current.newChat());

    expect(result.current.draft).toBe("");
  });
});
