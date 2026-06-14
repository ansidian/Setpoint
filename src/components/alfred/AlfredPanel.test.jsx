import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  runAlfredStream: vi.fn(),
  deleteAlfredConversation: vi.fn().mockResolvedValue({ ok: true }),
  getEmailBody: vi.fn().mockResolvedValue({ body: "Body" }),
  peekEmailBody: vi.fn(() => null),
}));
vi.mock("../../api", () => api);

const { default: AlfredPanel } = await import("./AlfredPanel.jsx");

function scriptedRun(events) {
  api.runAlfredStream.mockImplementation(async ({ onEvent }) => {
    for (const e of events) onEvent(e);
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
      { type: "run_start", conversation_id: "c1", model: "claude-sonnet-4-6" },
      { type: "tool_start", tool_id: "t1", name: "get_upcoming_bills" },
      { type: "tool_result", tool_id: "t1", name: "get_upcoming_bills", ok: true, summary: "Bills · 1 upcoming" },
      { type: "rows", kind: "bill", items: [{ id: "b1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false }] },
      { type: "text_delta", text: "One bill is due." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    render(<AlfredPanel {...baseProps} />);
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "Any bills?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("One bill is due.")).toBeTruthy());
    expect(screen.getByText("Bills · 1 upcoming")).toBeTruthy();
    expect(screen.getByText("Rent")).toBeTruthy();
    expect(screen.getByText("Any bills?")).toBeTruthy();
  });

  it("retries a handoff that arrived during an in-flight run instead of dropping it (P2-3)", async () => {
    let resolveFirst;
    api.runAlfredStream
      .mockImplementationOnce(async ({ onEvent }) => {
        onEvent({ type: "run_start", conversation_id: "c1", model: "claude-sonnet-4-6" });
        await new Promise((r) => { resolveFirst = r; });
        onEvent({ type: "run_end", stop_reason: "end_turn" });
      })
      .mockImplementation(async ({ onEvent }) => {
        onEvent({ type: "run_start", conversation_id: "c1", model: "claude-sonnet-4-6" });
        onEvent({ type: "run_end", stop_reason: "end_turn" });
      });

    const { rerender } = render(<AlfredPanel {...baseProps} handoff={null} />);
    rerender(<AlfredPanel {...baseProps} handoff={{ id: "h1", query: "first handoff" }} />);
    await waitFor(() => expect(api.runAlfredStream).toHaveBeenCalledTimes(1));

    // A second handoff arrives while the first run is still streaming (busy).
    rerender(<AlfredPanel {...baseProps} handoff={{ id: "h2", query: "second handoff" }} />);
    expect(api.runAlfredStream).toHaveBeenCalledTimes(1);

    // When the first run finishes, the dropped handoff must fire — not vanish.
    resolveFirst();
    await waitFor(() => expect(api.runAlfredStream).toHaveBeenCalledTimes(2));
    expect(api.runAlfredStream.mock.calls[1][0].message).toBe("second handoff");
  });

  it("closes on Escape in the composer", () => {
    const onClose = vi.fn();
    render(<AlfredPanel {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(screen.getByPlaceholderText("Ask about your day…"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("submits a handoff query when the handoff prop changes", async () => {
    scriptedRun([{ type: "run_end", stop_reason: "end_turn" }]);
    const { rerender } = render(<AlfredPanel {...baseProps} />);
    rerender(<AlfredPanel {...baseProps} handoff={{ id: 1, query: "car insurance email" }} />);
    await waitFor(() => expect(api.runAlfredStream).toHaveBeenCalledTimes(1));
    expect(api.runAlfredStream.mock.calls[0][0].message).toBe("car insurance email");
  });

  it("clears the conversation when newChatTick changes", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", model: "claude-sonnet-4-6" },
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
    expect(screen.getByPlaceholderText("Ask about your day…").value).toBe("");
  });

  it("shows the model hint for the selected model", () => {
    render(<AlfredPanel {...baseProps} />);
    expect(screen.getByText("claude sonnet 4.6")).toBeTruthy();
    fireEvent.click(screen.getByText("haiku"));
    expect(screen.getByText("claude haiku 4.5")).toBeTruthy();
  });

  it("dispatches a calendar request when a bill chip is clicked", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", model: "claude-sonnet-4-6" },
      { type: "rows", kind: "bill", items: [{ id: "b1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false }] },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const onOpenCalendarItem = vi.fn();
    render(<AlfredPanel {...baseProps} onOpenCalendarItem={onOpenCalendarItem} />);
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "Any bills?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Rent")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Rent/ }));
    expect(onOpenCalendarItem).toHaveBeenCalledTimes(1);
    expect(onOpenCalendarItem.mock.calls[0][0].viewKey).toBe("bills");
    expect(onOpenCalendarItem.mock.calls[0][0].focusItemId).toBe("b1");
  });

  it("opens the read-only preview when an email chip is clicked", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", model: "claude-sonnet-4-6" },
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
      { type: "run_start", conversation_id: "c1", model: "claude-sonnet-4-6" },
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
      { type: "run_start", conversation_id: "c1", model: "claude-sonnet-4-6" },
      { type: "rows", kind: "email", items: [{ uid: "m1", subject: "Verify enrollment", from: { name: "Financial Aid" }, email_date: "2026-06-12T17:30:00.000Z" }] },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const onClose = vi.fn();
    render(<AlfredPanel {...baseProps} onClose={onClose} />);
    const input = screen.getByPlaceholderText("Ask about your day…");
    fireEvent.change(input, { target: { value: "find it" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Verify enrollment")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Verify enrollment/ }));
    expect(screen.getByRole("dialog", { name: "Email preview" })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Email preview" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
