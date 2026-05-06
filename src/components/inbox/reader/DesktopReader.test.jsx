import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesktopReader from "./DesktopReader.jsx";

const billBadgeMock = vi.hoisted(() => vi.fn());

vi.mock("../../bills/BillBadge", () => ({
  default: function BillBadgeMock(props) {
    billBadgeMock(props);
    return <div data-testid="bill-badge" />;
  },
}));

afterEach(() => {
  cleanup();
  billBadgeMock.mockClear();
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
      billOpen={overrides.billOpen || false}
      billMounted={overrides.billMounted || false}
      setBillOpen={() => {}}
      trashHoldProgress={0}
      snoozeHoldProgress={0}
      snoozeBtnRef={{ current: null }}
      snoozeOpen={false}
      setSnoozeOpen={() => {}}
      bodyState={overrides.bodyState || { loading: false, error: null, body: "" }}
      drafting={false}
      setDrafting={() => {}}
      readOnly={overrides.readOnly || false}
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

  it("passes the loaded provider body to bill extraction instead of the row preview", () => {
    renderReader({
      billOpen: true,
      billMounted: true,
      email: {
        subject: "Card payment due",
        preview: "Short preview without the full statement.",
        body: "Old row body summary.",
        hasBill: true,
      },
      bodyState: {
        loading: false,
        error: null,
        body: "<html><body>Full provider statement with amount $132.14 due May 10.</body></html>",
      },
    });

    expect(screen.getByTestId("bill-badge")).toBeTruthy();
    expect(billBadgeMock).toHaveBeenCalledWith(expect.objectContaining({
      emailBody: "<html><body>Full provider statement with amount $132.14 due May 10.</body></html>",
      emailBodyLoading: false,
      emailBodySource: "loaded",
    }));
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

  it("shows compact desktop key hints for immediate reader actions", () => {
    renderReader();

    expect(screen.getByRole("button", { name: /move to fyi/i }).textContent).toContain("F");
    expect(screen.getByRole("button", { name: /move to noise/i }).textContent).toContain("N");
    expect(screen.getByRole("button", { name: /mark handled/i }).textContent).toContain("H");
    expect(screen.getByRole("button", { name: /dismiss from today/i }).textContent).toContain("D");
    expect(screen.getByRole("button", { name: /snooze email/i }).textContent).toContain("S");
    expect(screen.getByRole("button", { name: /trash email/i }).textContent).toContain("E");
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

	  it("shows Reopen for handled active snapshot rows", () => {
	    const { onAction } = renderReader({
	      email: {
	        _lane: "handled",
	        handled_at: "2026-05-03T16:10:00.000Z",
	      },
	    });

	    expect(screen.getByRole("button", { name: /reopen/i })).toBeTruthy();
	    expect(screen.getByRole("button", { name: /reopen/i }).textContent).toContain("H");
	    expect(screen.queryByRole("button", { name: /mark handled/i })).toBeNull();
	    expect(screen.queryByRole("button", { name: /move to fyi/i })).toBeNull();

	    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
	    expect(onAction).toHaveBeenCalledWith("snapshot-reopen");
	  });

	  it("hides mutating actions for read-only snapshot rows", () => {
    renderReader({ readOnly: true });

    expect(screen.queryByRole("button", { name: /move to fyi/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark handled/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /dismiss from today/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark read/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /snooze email/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /trash email/i })).toBeNull();
  });
});
