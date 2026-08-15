import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    const input = screen.getByPlaceholderText<HTMLInputElement>("Ask about your day…");
    fireEvent.change(input, { target: { value: "  any bills?  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("any bills?")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("does not submit an empty / whitespace-only draft on Enter", () => {
    render(<ComposerHarness />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Ask about your day…");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("none")).toBeTruthy();
    expect(input.value).toBe("   ");
  });

  it("submits via the send button and clears the draft", () => {
    render(<ComposerHarness />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Ask about your day…");
    fireEvent.change(input, { target: { value: "find it" } });
    fireEvent.click(screen.getByTitle("Send"));
    expect(screen.getByText("find it")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("disables the input and shows the working placeholder while busy", () => {
    render(<AlfredComposer {...baseProps} busy />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Working…");
    expect(input.disabled).toBe(true);
  });

  it("clears the local draft when clearSignal changes (new chat)", () => {
    const { rerender } = render(<AlfredComposer {...baseProps} clearSignal="0:0" />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Ask about your day…");
    fireEvent.change(input, { target: { value: "half-typed" } });
    expect(input.value).toBe("half-typed");
    rerender(<AlfredComposer {...baseProps} clearSignal="1:0" />);
    expect(screen.getByPlaceholderText<HTMLInputElement>("Ask about your day…").value).toBe("");
  });

  it("allows typing while email preparation is pending but blocks sending", () => {
    render(<AlfredComposer {...baseProps} pendingEmail={{
      key: "mail-1",
      source: { uid: "mail-1", subject: "Subject", senderName: "Pat", senderAddress: "pat@example.com", timestamp: null },
      status: "preparing",
      prepared: null,
      error: null,
    }} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Ask about this email…");
    fireEvent.change(input, { target: { value: "Draft while loading" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("Draft while loading");
    expect(screen.getByRole("button", { name: "Send message to Alfred" })).toHaveProperty("disabled", true);
  });

  it("restores the submitted prompt when Alfred returns an error", async () => {
    render(<AlfredComposer {...baseProps} onSubmit={async () => ({ status: "error", message: "Failed" })} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Ask about your day…");
    fireEvent.change(input, { target: { value: "Do not lose this" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.value).toBe("Do not lose this"));
  });
});
