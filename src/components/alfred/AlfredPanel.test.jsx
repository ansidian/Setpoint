import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  runAlfredStream: vi.fn(),
  deleteAlfredConversation: vi.fn().mockResolvedValue({ ok: true }),
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

    rerender(<AlfredPanel {...baseProps} newChatTick={1} />);
    await waitFor(() => expect(screen.queryByText("Hello.")).toBeNull());
    expect(screen.getByText("What do you need?")).toBeTruthy();
  });

  it("shows the model hint for the selected model", () => {
    render(<AlfredPanel {...baseProps} />);
    expect(screen.getByText("claude sonnet 4.6")).toBeTruthy();
    fireEvent.click(screen.getByText("haiku"));
    expect(screen.getByText("claude haiku 4.5")).toBeTruthy();
  });
});
