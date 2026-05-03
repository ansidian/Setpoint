import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesktopReader from "./DesktopReader.jsx";

afterEach(() => {
  cleanup();
});

function renderReader(overrides = {}) {
  const onAction = vi.fn();
  render(
    <DesktopReader
      email={{
        id: "msg-1",
        uid: "msg-1",
        subject: "Action needed",
        from: "Sender",
        fromEmail: "sender@example.test",
        date: "2026-05-03T15:00:00.000Z",
        _activeSnapshot: true,
        _lane: "needs_attention",
        ...overrides.email,
      }}
      account={{ name: "Work", color: "#cba6da" }}
      accent="#cba6da"
      pinned={false}
      onAction={onAction}
      onClose={() => {}}
      showTriage={false}
      showDraft={false}
      billOpen={false}
      billMounted={false}
      setBillOpen={() => {}}
      trashHoldProgress={0}
      snoozeHoldProgress={0}
      snoozeBtnRef={{ current: null }}
      snoozeOpen={false}
      setSnoozeOpen={() => {}}
      bodyState={{ loading: false, error: null, body: "" }}
      drafting={false}
      setDrafting={() => {}}
    />,
  );
  return { onAction };
}

describe("DesktopReader snapshot actions", () => {
  it("keeps the bill-pay affordance visible for triaged finance bill emails", () => {
    renderReader({
      email: {
        subject: "Utility payment due",
        category: "finance",
        hasBill: true,
        _untriaged: false,
      },
    });

    expect(screen.getByRole("button", { name: /pay bill/i })).toBeTruthy();
  });

  it("shows manual correction controls for active snapshot rows", () => {
    renderReader();

    expect(screen.getByRole("button", { name: /move to fyi/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /move to noise/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /mark handled/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /dismiss from today/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /pin email/i })).toBeNull();
    expect(screen.queryByText("Move to FYI")).toBeNull();
    expect(screen.queryByText("Move to Noise")).toBeNull();
    expect(screen.queryByText("Dismiss")).toBeNull();
  });

  it("dispatches snapshot lane and lifecycle actions", () => {
    const { onAction } = renderReader();

    fireEvent.click(screen.getByRole("button", { name: /move to fyi/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark handled/i }));
    fireEvent.click(screen.getByRole("button", { name: /dismiss from today/i }));

    expect(onAction).toHaveBeenCalledWith("snapshot-move-lane", "fyi");
    expect(onAction).toHaveBeenCalledWith("snapshot-handled");
    expect(onAction).toHaveBeenCalledWith("snapshot-dismiss");
  });
});
