import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  runAlfredStream: vi.fn(),
  deleteAlfredConversation: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("../../api", () => api);

const { default: useAlfredChat } = await import("./useAlfredChat.js");

function scriptedRun(events) {
  api.runAlfredStream.mockImplementation(async ({ onEvent }) => {
    for (const e of events) onEvent(e);
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAlfredChat", () => {
  it("submits a message, streams events, and tracks the conversation id", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", model: "claude-sonnet-4-6" },
      { type: "text_delta", text: "All clear." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const { result } = renderHook(() => useAlfredChat());

    await act(async () => { await result.current.submit("What's left?"); });

    expect(result.current.messages.map((m) => m.type)).toEqual(["user", "say"]);
    expect(result.current.messages[1].text).toBe("All clear.");
    expect(result.current.busy).toBe(false);

    // Follow-up reuses the conversation id from run_start
    scriptedRun([{ type: "run_end", stop_reason: "end_turn" }]);
    await act(async () => { await result.current.submit("and tomorrow?"); });
    expect(api.runAlfredStream.mock.calls[1][0].conversationId).toBe("c1");
  });

  it("sends the selected model id", async () => {
    scriptedRun([{ type: "run_end", stop_reason: "end_turn" }]);
    const { result } = renderHook(() => useAlfredChat());
    act(() => result.current.setModelKey("haiku"));
    await act(async () => { await result.current.submit("hi"); });
    expect(api.runAlfredStream.mock.calls[0][0].model).toBe("claude-haiku-4-5-20251001");
  });

  it("appends an error line when the run throws", async () => {
    api.runAlfredStream.mockRejectedValue(new Error("api down"));
    const { result } = renderHook(() => useAlfredChat());
    await act(async () => { await result.current.submit("hi"); });
    expect(result.current.messages.at(-1)).toMatchObject({ type: "error", text: "api down" });
    expect(result.current.busy).toBe(false);
  });

  it("ignores submits while busy", async () => {
    let release;
    api.runAlfredStream.mockImplementation(() => new Promise((r) => { release = r; }));
    const { result } = renderHook(() => useAlfredChat());
    act(() => { result.current.submit("first"); });
    await waitFor(() => expect(result.current.busy).toBe(true));
    await act(async () => { await result.current.submit("second"); });
    expect(api.runAlfredStream).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
  });

  it("new chat aborts, deletes the server conversation, and clears messages", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c9", model: "claude-sonnet-4-6" },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const { result } = renderHook(() => useAlfredChat());
    await act(async () => { await result.current.submit("hi"); });

    act(() => result.current.newChat());

    expect(result.current.messages).toEqual([]);
    expect(result.current.busy).toBe(false);
    expect(api.deleteAlfredConversation).toHaveBeenCalledWith("c9");
  });
});
