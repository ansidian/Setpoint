import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlfredRunEvent } from "../../../shared/types/alfred";
import AlfredPanel from "./AlfredPanel";

let runs: Response[] = [];

function scriptedRun(events: AlfredRunEvent[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
  runs.push(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
}

function deferredRun(events: AlfredRunEvent[]): { response: Response; finish: () => void } {
  const encoder = new TextEncoder();
  let closeStream = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      closeStream = () => {
        controller.enqueue(encoder.encode('event: run_end\ndata: {"type":"run_end","stop_reason":"end_turn"}\n\n'));
        controller.close();
      };
    },
  });
  return { response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }), finish: () => closeStream() };
}

beforeEach(() => {
  runs = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "https://setpoint.test").pathname;
    if (path === "/api/alfred/run") return runs.shift() ?? new Response(null, { status: 200 });
    if (path.startsWith("/api/briefing/email/")) {
      return new Response(JSON.stringify({ body: "Body" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseProps = { open: true, onClose: () => {}, accent: "#cba6da", handoff: null, newChatTick: 0 };

describe("AlfredPanel", () => {
  it("shows the empty state with coverage-correct copy and suggestions", () => {
    render(<AlfredPanel {...baseProps} />);
    expect(screen.getByText("What do you need?")).toBeTruthy();
    expect(screen.getByText(/Read-only for now/)).toBeTruthy();
    expect(screen.getByText("What's left today?")).toBeTruthy();
    expect(screen.queryByText(/act on Todoist/)).toBeNull();
  });

  it("submits the draft on Enter and renders the streamed answer", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "tool_start", tool_id: "t1", name: "get_upcoming_bills" },
      { type: "tool_result", tool_id: "t1", name: "get_upcoming_bills", ok: true, summary: "Bills · 1 upcoming" },
      { type: "rows", kind: "bill", items: [{ id: "b1", scheduleId: "s1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false, type: "bill", openActionDisabled: false }] },
      { type: "text_delta", text: "One bill is due. The rest can wait." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    render(<AlfredPanel {...baseProps} />);
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "Any bills?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("One bill is due.")).toBeTruthy());
    expect(screen.getByText("The rest can wait.")).toBeTruthy();
    // The tool chip is now tucked behind a "steps" disclosure, collapsed by default.
    expect(screen.queryByText("Bills · 1 upcoming")).toBeNull();
    const steps = screen.getByRole("button", { name: /1 step\b/ });
    fireEvent.click(steps);
    expect(screen.getByText("Bills · 1 upcoming")).toBeTruthy();
    expect(screen.getByText("Rent")).toBeTruthy();
    expect(screen.getByText("Any bills?")).toBeTruthy();
  });

  it("keeps every between-tool narration interleaved with its steps and identifies the final answer", async () => {
    // The reported regression: narration Alfred says between tool calls vanished.
    // A real multi-step run must read like an agentic trail — each narration line
    // persists as quiet prose above the tools it introduced; only the final answer
    // resolves into the serif line.
    const narration = 'Let me read a few more confirmation emails to better understand what constitutes "nothing after applied," and check for more rejections.';
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "text_delta", text: "Let me search your mail." },
      { type: "tool_start", tool_id: "t1", name: "search_email" },
      { type: "tool_result", tool_id: "t1", name: "search_email", ok: true, summary: "Mail · 12 matches" },
      { type: "text_delta", text: narration },
      { type: "tool_start", tool_id: "t2", name: "get_email_body" },
      { type: "tool_result", tool_id: "t2", name: "get_email_body", ok: true, summary: "Mail · opened message" },
      { type: "tool_start", tool_id: "t3", name: "get_email_body" },
      { type: "tool_result", tool_id: "t3", name: "get_email_body", ok: true, summary: "Mail · opened message" },
      { type: "text_delta", text: "Here's what I found." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    render(<AlfredPanel {...baseProps} />);
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "What needs me?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("Here's what I found.")).toBeTruthy());

    // Both narration lines survived — including the exact text the owner reported losing.
    const first = screen.getByText("Let me search your mail.");
    const second = screen.getByText(narration);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    const messageKinds = Array.from(document.querySelectorAll("[data-alfred-message-kind]"))
      .map((node) => node.getAttribute("data-alfred-message-kind"));
    expect(messageKinds).toEqual(["preamble", "tools", "preamble", "tools", "answer"]);
    expect(first.closest('[data-alfred-message-kind="preamble"]')).toBeTruthy();
    expect(second.closest('[data-alfred-message-kind="preamble"]')).toBeTruthy();
    expect(screen.getByText("Here's what I found.").closest('[data-alfred-message-kind="answer"]')).toBeTruthy();

    // Each narration introduced its own settled step disclosure (no lingering spinner).
    expect(screen.getByRole("button", { name: /1 step\b/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /2 steps/ })).toBeTruthy();
  });

  it("renders a run error produced by the panel model", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "run_error", message: "Alfred could not complete this run." },
    ]);
    render(<AlfredPanel {...baseProps} />);
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "Try this" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("Alfred could not complete this run.")).toBeTruthy());
  });

  it("retries a handoff that arrived during an in-flight run instead of dropping it (P2-3)", async () => {
    const pending = deferredRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
    ]);
    runs.push(pending.response);
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "run_end", stop_reason: "end_turn" },
    ]);

    const { rerender } = render(<AlfredPanel {...baseProps} handoff={null} />);
    rerender(<AlfredPanel {...baseProps} handoff={{ id: "h1", query: "first handoff" }} />);
    await waitFor(() => expect(screen.getByText("first handoff")).toBeTruthy());

    // A second handoff arrives while the first run is still streaming (busy).
    rerender(<AlfredPanel {...baseProps} handoff={{ id: "h2", query: "second handoff" }} />);
    expect(screen.queryByText("second handoff")).toBeNull();

    // When the first run finishes, the dropped handoff must fire — not vanish.
    pending.finish();
    await waitFor(() => expect(screen.getByText("second handoff")).toBeTruthy());
  });

  it("closes on Escape in the composer", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return <><AlfredPanel {...baseProps} open={open} onClose={() => setOpen(false)} /><output>{open ? "panel open" : "panel closed"}</output></>;
    }
    render(<Harness />);
    fireEvent.keyDown(screen.getByPlaceholderText("Ask about your day…"), { key: "Escape" });
    expect(screen.getByText("panel closed")).toBeTruthy();
  });

  it("submits a handoff query when the handoff prop changes", async () => {
    scriptedRun([{ type: "run_end", stop_reason: "end_turn" }]);
    const { rerender } = render(<AlfredPanel {...baseProps} />);
    rerender(<AlfredPanel {...baseProps} handoff={{ id: 1, query: "car insurance email" }} />);
    await waitFor(() => expect(screen.getByText("car insurance email")).toBeTruthy());
  });

  it("clears the conversation when newChatTick changes", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "text_delta", text: "Hello." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const { rerender } = render(<AlfredPanel {...baseProps} />);
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Hello.")).toBeTruthy());
    fireEvent.change(input, { target: { value: "half-typed follow-up" } });

    rerender(<AlfredPanel {...baseProps} newChatTick={1} />);
    await waitFor(() => expect(screen.queryByText("Hello.")).toBeNull());
    expect(screen.getByText("What do you need?")).toBeTruthy();
    expect(screen.getByPlaceholderText<HTMLInputElement>("Ask about your day…").value).toBe("");
  });

  it("shows the active conversation model as a read-only hint", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "openai", model: "gpt-5.6-sol" },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    render(<AlfredPanel {...baseProps} />);
    expect(screen.getByText("Settings default")).toBeTruthy();
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("OpenAI · GPT-5.6 Sol")).toBeTruthy());
  });

  it("dispatches a calendar request when a bill chip is clicked", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "rows", kind: "bill", items: [{ id: "b1", scheduleId: "s1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false, type: "bill", openActionDisabled: false }] },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    function Harness() {
      const [request, setRequest] = useState("none");
      return <><AlfredPanel {...baseProps} onOpenCalendarItem={(next) => setRequest(`${next.viewKey}:${next.focusItemId}`)} /><output>{request}</output></>;
    }
    render(<Harness />);
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "Any bills?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Rent")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Rent/ }));
    expect(screen.getByText("bills:b1")).toBeTruthy();
  });

  it("opens the read-only preview when an email chip is clicked", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "rows", kind: "email", items: [{ uid: "m1", subject: "Verify enrollment", from: { name: "Financial Aid" }, email_date: "2026-06-12T17:30:00.000Z" }] },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    render(<AlfredPanel {...baseProps} />);
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "find it" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Verify enrollment")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Verify enrollment/ }));
    expect(screen.getByRole("dialog", { name: "Email preview" })).toBeTruthy();
  });

  it("clears the preview when the panel closes", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "rows", kind: "email", items: [{ uid: "m1", subject: "Verify enrollment", from: { name: "Financial Aid" }, email_date: "2026-06-12T17:30:00.000Z" }] },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const { rerender } = render(<AlfredPanel {...baseProps} />);
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "find it" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Verify enrollment")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Verify enrollment/ }));
    expect(screen.getByRole("dialog", { name: "Email preview" })).toBeTruthy();

    rerender(<AlfredPanel {...baseProps} open={false} />);
    expect(screen.queryByRole("dialog", { name: "Email preview" })).toBeNull();
  });

  it("Escape closes the preview first, then the panel", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "rows", kind: "email", items: [{ uid: "m1", subject: "Verify enrollment", from: { name: "Financial Aid" }, email_date: "2026-06-12T17:30:00.000Z" }] },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    function Harness() {
      const [open, setOpen] = useState(true);
      return <><AlfredPanel {...baseProps} open={open} onClose={() => setOpen(false)} /><output>{open ? "panel open" : "panel closed"}</output></>;
    }
    render(<Harness />);
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "find it" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Verify enrollment")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Verify enrollment/ }));
    expect(screen.getByRole("dialog", { name: "Email preview" })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Email preview" })).toBeNull();
    expect(screen.getByText("panel open")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByText("panel closed")).toBeTruthy();
  });
});
