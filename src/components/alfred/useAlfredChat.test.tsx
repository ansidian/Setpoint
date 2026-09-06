import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlfredRunEvent } from "../../../shared/types/alfred";
import useAlfredChat from "./useAlfredChat";

interface RequestRecord { path: string; method: string; body: Record<string, unknown> | null }
let requests: RequestRecord[] = [];
let runs: Response[] = [];
let failCreatedAck = false;

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
  failCreatedAck = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(input), "https://setpoint.test").pathname;
    requests.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    if (path === "/api/alfred/run") return runs.shift() ?? sseResponse([]);
    if (path.endsWith("/created") && failCreatedAck) {
      return new Response(JSON.stringify({ message: "temporary" }), { status: 503, headers: { "content-type": "application/json" } });
    }
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

  it("sends only the prepared email handle and marks the owner turn failed when the run errors", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "run_error", code: "context_window_exceeded", message: "This chat is too long." },
    ]);
    const { result } = renderHook(() => useAlfredChat());
    let submitResult: Awaited<ReturnType<typeof result.current.submit>> | undefined;

    await act(async () => {
      submitResult = await result.current.submit("Summarize it", {
        contextId: "ctx-1",
        uid: "mail-1",
        subject: "A long email",
        sender: { name: "Pat", address: "pat@example.com", display: "Pat <pat@example.com>" },
        timestamp: "2026-08-14T19:00:00Z",
        charCount: 400,
      });
    });

    expect(requests[0]?.body).toEqual({ message: "Summarize it", emailContextId: "ctx-1" });
    expect(submitResult).toEqual({ status: "error", code: "context_window_exceeded", message: "This chat is too long." });
    expect(result.current.messages[0]).toMatchObject({ type: "user", failed: true, attachment: { uid: "mail-1" } });
  });

  it("visibly resets stale local transcript when the server starts a replacement conversation", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "text_delta", text: "Old answer." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const { result } = renderHook(() => useAlfredChat());
    await act(async () => { await result.current.submit("First"); });

    scriptedRun([
      { type: "run_start", conversation_id: "c2", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    await act(async () => { await result.current.submit("After expiry"); });

    expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "notice", text: expect.stringContaining("expired") }),
      expect.objectContaining({ type: "user", text: "After expiry" }),
    ]));
    expect(result.current.messages.some((message) => message.type === "say" && message.text === "Old answer.")).toBe(false);
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

  it("stops a streaming response, settles progress, and ignores buffered content while preserving retry", async () => {
    const encoder = new TextEncoder();
    const encode = (event: AlfredRunEvent) => encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      init.signal?.addEventListener("abort", () => {
        // Model a provider frame already queued when the fetch cancellation arrives.
        stream.enqueue(encode({ type: "text_delta", text: "Late content must not appear" }));
        queueMicrotask(() => stream.error(new DOMException("Aborted", "AbortError")));
      }, { once: true });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    const { result } = renderHook(() => useAlfredChat());
    let submission!: ReturnType<typeof result.current.submit>;
    act(() => { submission = result.current.submit("Find the related email"); });
    await act(async () => {
      stream.enqueue(encode({ type: "run_start", conversation_id: "stopped-chat", provider: "anthropic", model: "claude-sonnet-4-6" }));
      stream.enqueue(encode({ type: "tool_start", tool_id: "search-1", name: "search_email" }));
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.messages).toContainEqual(expect.objectContaining({ type: "tools", done: false }));
    let outcome: Awaited<typeof submission> | undefined;
    await act(async () => { result.current.stop(); outcome = await submission; });
    expect(outcome).toEqual({ status: "error", message: "Response stopped. You can edit your question and try again." });
    expect(result.current.busy).toBe(false);
    expect(result.current.messages).toContainEqual(expect.objectContaining({ type: "tools", done: true }));
    expect(result.current.messages).toContainEqual(expect.objectContaining({ type: "user", text: "Find the related email", failed: true }));
    expect(result.current.messages.some((message) => message.type === "say")).toBe(false);

    vi.stubGlobal("fetch", async () => sseResponse([
      { type: "text_delta", text: "Here is the related email." },
      { type: "run_end", stop_reason: "end_turn" },
    ]));
    await act(async () => { outcome = await result.current.submit("Find the related email"); });
    expect(outcome).toEqual({ status: "success" });
    expect(result.current.messages).toContainEqual(expect.objectContaining({ type: "say", text: "Here is the related email.", done: true }));
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

  it("clears an uncreated proposal at the advertised conversation expiry", async () => {
    vi.useFakeTimers();
    const expiresAt = new Date(Date.now() + 1_000).toISOString();
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6", expires_at: expiresAt },
      { type: "calendar_proposal", proposal: {
        id: "proposal-1", revisionOf: null, title: "Project review", allDay: false,
        startDate: "2026-08-18", endDate: "2026-08-18", startTime: "15:00", endTime: "15:30",
        location: "", description: "", source: { kind: "unavailable" },
        duplicateCheckUnavailable: true, past: false,
      } },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const { result, unmount } = renderHook(() => useAlfredChat());
    await act(async () => { await result.current.submit("Schedule a project review"); });
    expect(result.current.messages.some((message) => message.type === "calendar-proposal")).toBe(true);

    act(() => { vi.advanceTimersByTime(1_001); });
    expect(result.current.messages.some((message) => message.type === "calendar-proposal")).toBe(false);
    unmount();
    vi.useRealTimers();
  });

  it("keeps Calendar save success authoritative and retries a failed Created acknowledgement on the next run", async () => {
    failCreatedAck = true;
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "calendar_proposal", proposal: {
        id: "proposal-1", revisionOf: null, title: "Project review", allDay: false,
        startDate: "2026-08-18", endDate: "2026-08-18", startTime: "15:00", endTime: "15:30",
        location: "", description: "", source: { kind: "unavailable" },
        duplicateCheckUnavailable: true, past: false,
      } },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const { result } = renderHook(() => useAlfredChat());
    await act(async () => { await result.current.submit("Schedule a project review"); });
    await act(async () => {
      result.current.completeProposal("proposal-1", {
        id: "event-1", title: "Project review", allDay: false,
        startMs: new Date("2026-08-18T22:00:00.000Z").getTime(),
        endMs: new Date("2026-08-18T22:30:00.000Z").getTime(),
        location: "", description: "", calendarName: "Personal",
        accountId: "account-1", calendarId: "primary",
      } as never);
    });
    expect(result.current.messages.find((message) => message.type === "calendar-proposal"))
      .toMatchObject({ status: "created", createdEvent: { id: "event-1" } });

    failCreatedAck = false;
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    await act(async () => { await result.current.submit("What is next?"); });
    expect(requests.filter((request) => request.path === "/api/alfred/run").slice(-1)[0]?.body)
      .toMatchObject({ createdProposalIds: ["proposal-1"] });
  });
});
