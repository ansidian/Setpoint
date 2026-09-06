import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AlfredComposer from "./AlfredComposer";

afterEach(cleanup);

const baseProps = {
  open: true,
  busy: false,
  accent: "#cba6da",
  modelHint: "claude sonnet 4.6",
  clearSignal: "0:0",
  pendingEmail: null,
  priorEmailCount: 0,
  overflowRecovery: false,
  onPreviewEmail: () => {},
  onRetryEmail: () => {},
  onRemoveEmail: () => {},
  onStartNewChat: () => {},
  onRecoverNewChat: () => {},
  onSubmit: async () => ({ status: "success" } as const),
};

function ComposerHarness() {
  const [submitted, setSubmitted] = useState("none");
  return <>
    <AlfredComposer {...baseProps} onSubmit={async (text) => {
      setSubmitted(text);
      return { status: "success" };
    }} />
    <output>{submitted}</output>
  </>;
}

describe("AlfredComposer", () => {
  it("submits the trimmed draft on Enter and clears the input", () => {
    render(<ComposerHarness />);
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>("Ask across mail, calendar, and finances…");
    fireEvent.change(input, { target: { value: "  any bills?  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("any bills?")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("does not submit an empty / whitespace-only draft on Enter", () => {
    render(<ComposerHarness />);
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>("Ask across mail, calendar, and finances…");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("none")).toBeTruthy();
    expect(input.value).toBe("   ");
  });

  it("clears the local draft when clearSignal changes (new chat)", () => {
    const { rerender } = render(<AlfredComposer {...baseProps} clearSignal="0:0" />);
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>("Ask across mail, calendar, and finances…");
    fireEvent.change(input, { target: { value: "half-typed" } });
    expect(input.value).toBe("half-typed");
    rerender(<AlfredComposer {...baseProps} clearSignal="1:0" />);
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>("Ask across mail, calendar, and finances…").value).toBe("");
  });

  it("allows typing while email preparation is pending but blocks sending", () => {
    render(<AlfredComposer {...baseProps} pendingEmail={{
      key: "mail-1",
      source: { uid: "mail-1", subject: "Subject", senderName: "Pat", senderAddress: "pat@example.com", timestamp: null },
      status: "preparing",
      prepared: null,
      error: null,
    }} />);
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>("Ask about this email…");
    fireEvent.change(input, { target: { value: "Draft while loading" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("Draft while loading");
    expect(screen.getByRole("button", { name: "Send message to Alfred" })).toHaveProperty("disabled", true);
  });

  it("restores the submitted prompt when Alfred returns an error", async () => {
    render(<AlfredComposer {...baseProps} onSubmit={async () => ({ status: "error", message: "Failed" })} />);
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>("Ask across mail, calendar, and finances…");
    fireEvent.change(input, { target: { value: "Do not lose this" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.value).toBe("Do not lose this"));
  });

  it.each(["new draft", "new chat"] as const)("a late failure preserves %s", async (nextAction) => {
    let finish!: (result: { status: "error"; message: string }) => void;
    const submission = new Promise<{ status: "error"; message: string }>((resolve) => { finish = resolve; });
    const props = { ...baseProps, onSubmit: () => submission };
    const { rerender } = render(<AlfredComposer {...props} />);
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message to Alfred" });
    fireEvent.change(input, { target: { value: "Original question" } });
    fireEvent.keyDown(input, { key: "Enter" });
    rerender(<AlfredComposer {...props} busy />);
    if (nextAction === "new draft") {
      fireEvent.change(input, { target: { value: "Next question" } });
    } else {
      rerender(<AlfredComposer {...props} clearSignal="1:0" />);
    }
    await act(async () => { finish({ status: "error", message: "Failed" }); await submission; });
    expect(input.value).toBe(nextAction === "new draft" ? "Next question" : "");
  });

});
