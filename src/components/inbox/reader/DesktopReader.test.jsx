// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesktopReader from "./DesktopReader.jsx";
import { shouldSuspendInboxHotkeys } from "../inboxHotkeys.js";

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
  const setDrafting = overrides.setDrafting || vi.fn();
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
        snapshot_item_id: 42,
        _lane: "needs_attention",
        ...overrides.email,
      }}
      account={{ name: "Work", color: "#cba6da" }}
      accent="#cba6da"
      pinned={false}
      onAction={onAction}
      onClose={() => {}}
      showTriage={false}
      showDraft={overrides.showDraft || false}
      billOpen={overrides.billOpen || false}
      billMounted={overrides.billMounted || false}
      setBillOpen={() => {}}
      snoozeBtnRef={{ current: null }}
      snoozeOpen={overrides.snoozeOpen ?? false}
      setSnoozeOpen={overrides.setSnoozeOpen || (() => {})}
      bodyState={overrides.bodyState || { loading: false, error: null, body: "" }}
      billResolution={overrides.billResolution}
      drafting={overrides.drafting || false}
      setDrafting={setDrafting}
      readOnly={overrides.readOnly || false}
    />,
  );
  return { onAction, setDrafting };
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

  it("shows an actioned Actual match and turns bill pay into a review affordance", () => {
    renderReader({
      email: {
        subject: "Utility payment due",
        category: "finance",
        hasBill: true,
      },
      billResolution: {
        status: "resolved",
        actualStatus: {
          status: "already_scheduled",
          evidence: { amount: 142.31, dueDate: "2026-08-12" },
        },
      },
    });

    expect(screen.getByText("Already scheduled in Actual")).toBeTruthy();
    expect(screen.getByRole("button", { name: /view bill/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /pay bill/i })).toBeNull();
  });

  it("hides the bill-pay affordance for triaged non-bill emails", () => {
    renderReader({
      email: {
        subject: "Regular update",
        category: "needs_attention",
        hasBill: false,
        _untriaged: false,
      },
    });

    expect(screen.queryByRole("button", { name: /pay bill/i })).toBeNull();
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
    expect(screen.getByRole("button", { name: /pin email/i })).toBeTruthy();
    expect(screen.queryByText("Move to FYI")).toBeNull();
    expect(screen.queryByText("Move to Noise")).toBeNull();
    expect(screen.queryByText("Dismiss")).toBeNull();
  });

  it("allows FYI snapshot rows to be marked handled", () => {
    const { onAction } = renderReader({ email: { _lane: "fyi" } });

    const handledButton = screen.getByRole("button", { name: /mark handled/i });
    expect(handledButton.textContent).toContain("H");
    expect(screen.queryByRole("button", { name: /move to fyi/i })).toBeNull();

    fireEvent.click(handledButton);
    expect(onAction).toHaveBeenCalledWith("snapshot-handled");
  });

  it("shows compact desktop key hints for immediate reader actions", () => {
    renderReader();

    expect(screen.getByRole("button", { name: /move to fyi/i }).textContent).toContain("F");
    expect(screen.getByRole("button", { name: /move to noise/i }).textContent).toContain("N");
    expect(screen.getByRole("button", { name: /mark handled/i }).textContent).toContain("H");
    expect(screen.getByRole("button", { name: /dismiss from today/i }).textContent).toContain("D");
    expect(screen.getByRole("button", { name: /snooze email/i }).textContent).toContain("S");
    expect(screen.getByRole("button", { name: /trash email/i }).textContent).toContain("E");
    expect(screen.getByRole("button", { name: /pin email/i }).textContent).toContain("P");
  });

  it("suspends inbox hotkeys while the desktop snooze menu is open without moving focus", () => {
    renderReader({ snoozeOpen: true });
    const snoozeButton = screen.getByRole("button", { name: /snooze email/i });
    snoozeButton.focus();

    expect(document.activeElement).toBe(snoozeButton);
    expect(shouldSuspendInboxHotkeys(snoozeButton)).toBe(true);
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
    // Pin is exempt from the readOnly gate — pinning from a frozen snapshot is the feature.
    expect(screen.getByRole("button", { name: /pin email/i })).toBeTruthy();
  });

  it("limits Catch-up rows to read state and Gmail open actions", () => {
    renderReader({
      email: {
        id: "gmail-gmail-work-late-fyi",
        uid: "gmail-gmail-work-late-fyi",
        account_id: "gmail-work",
        account_email: "work@example.test",
        _lane: "catch_up",
        lane_at_snapshot: "fyi",
        hasBill: true,
        claude: { draftReply: "Thanks." },
      },
    });

    expect(screen.getByRole("button", { name: /mark read/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /open in gmail/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /move to needs attention/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move to fyi/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move to noise/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark handled/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /dismiss from today/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /snooze email/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /trash email/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /pay bill/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /review reply/i })).toBeNull();
  });

  it("keeps queued snapshot rows dismissible but blocks manual triage and handled workflows", () => {
    const { onAction } = renderReader({
      email: {
        _lane: "queued",
        _arrivalGraceQueued: true,
        hasBill: false,
      },
    });

    expect(screen.getByRole("button", { name: /dismiss from today/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /pay bill/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /mark read/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /snooze email/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /trash email/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /move to needs attention/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move to fyi/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move to noise/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark handled/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /dismiss from today/i }));
    expect(onAction).toHaveBeenCalledWith("snapshot-dismiss");
  });

  it("keeps untriaged-read snapshot rows out of snapshot lifecycle actions", () => {
    renderReader({
      email: {
        _lane: "untriaged_read",
        _untriagedRead: true,
        read: true,
        hasBill: false,
      },
    });

    expect(screen.getByRole("button", { name: /mark unread/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /pay bill/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /snooze email/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /trash email/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /dismiss from today/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move to fyi/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark handled/i })).toBeNull();
  });

  it("hides snapshot lifecycle actions when snapshot_item_id is missing (drift guard)", () => {
    // An active-snapshot row without a snapshot_item_id cannot be acted on (the
    // dispatch + hotkeys both require it), so the buttons must not appear.
    renderReader({ email: { _lane: "needs_attention", snapshot_item_id: undefined } });

    expect(screen.queryByRole("button", { name: /mark handled/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /dismiss from today/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move to fyi/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move to noise/i })).toBeNull();
  });
});

describe("DesktopReader pin toggle", () => {
  it("dispatches pin-toggle when clicked", () => {
    const { onAction } = renderReader();

    fireEvent.click(screen.getByRole("button", { name: /pin email/i }));
    expect(onAction).toHaveBeenCalledWith("pin-toggle");
  });

  it("flips the aria-label when the email is pinned", () => {
    renderReader({ email: { _pinned: true } });

    expect(screen.getByRole("button", { name: /unpin email/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^pin email$/i })).toBeNull();
  });

  it("renders even for catch-up rows", () => {
    renderReader({
      email: {
        _lane: "catch_up",
        lane_at_snapshot: "fyi",
      },
    });

    expect(screen.getByRole("button", { name: /pin email/i })).toBeTruthy();
  });
});

describe("DesktopReader draft reply (P1-2)", () => {
  it("copies the AI draft to the clipboard without trashing the email", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { onAction, setDrafting } = renderReader({
      showDraft: true,
      email: { claude: { draftReply: "Thanks, that works for me." } },
    });

    // The draft panel's primary action must copy, not send-and-trash. There is
    // no send endpoint, so the old "Send" button silently trashed the email.
    fireEvent.click(screen.getByRole("button", { name: /copy draft/i }));

    await waitFor(() => expect(setDrafting).toHaveBeenCalledWith(false));
    expect(writeText).toHaveBeenCalledWith("Thanks, that works for me.");
    expect(onAction).not.toHaveBeenCalledWith("trash");
    expect(screen.queryByRole("button", { name: /^send$/i })).toBeNull();
  });
});
