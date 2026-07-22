import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import MobileReader from "./MobileReader";
import type { InboxEmailLike } from "../inboxTypes";
import { IDLE_BILL_RESOLUTION } from "./readerTypes";
import type { BillResolutionState } from "./readerTypes";

vi.mock("../../bills/BillBadge", () => ({
  default: function BillBadgeMock() {
    return <div data-testid="mobile-bill-badge" />;
  },
}));

afterEach(() => {
  cleanup();
});

type MobileReaderOverrides = Omit<Partial<ComponentProps<typeof MobileReader>>, "email" | "billResolution"> & {
  email?: Partial<InboxEmailLike>;
  billResolution?: Partial<BillResolutionState>;
};

function renderMobileReader(overrides: MobileReaderOverrides = {}) {
  const onAction = vi.fn();
  const onOpenRecordedBill = overrides.onOpenRecordedBill || vi.fn();
  const setBillOpen = overrides.setBillOpen || vi.fn();
  const setDrafting = overrides.setDrafting || vi.fn();
  render(
    <MobileReader
      email={{
        id: "msg-1",
        uid: "msg-1",
        subject: "Card payment due",
        from: "Bank",
        fromEmail: "bank@example.test",
        date: "2026-05-03T15:00:00.000Z",
        snapshot_item_id: 42,
        hasBill: true,
        preview: "Preview without bill details.",
        body: "Summary body.",
        ...overrides.email,
      }}
      account={{ name: "Inbox", color: "#cba6da" }}
      accent="#cba6da"
      onAction={onAction}
      onClose={() => {}}
      showTriage={false}
      billOpen={overrides.billOpen ?? true}
      billMounted={overrides.billMounted}
      setBillOpen={setBillOpen}
      onOpenRecordedBill={onOpenRecordedBill}
      snoozeOpen={false}
      setSnoozeOpen={() => {}}
      bodyState={overrides.bodyState || {
        loading: false,
        error: null,
        body: "<html><body>Full mobile provider bill with amount $88.20.</body></html>",
        source: "loaded",
      }}
      billResolution={overrides.billResolution ? { ...IDLE_BILL_RESOLUTION, ...overrides.billResolution } : undefined}
      drafting={overrides.drafting || false}
      setDrafting={setDrafting}
    />,
  );
  return { onAction, onOpenRecordedBill, setBillOpen };
}

describe("MobileReader controls", () => {
  it("keeps a previously opened bill drawer mounted but inert while closed", () => {
    renderMobileReader({ billOpen: false, billMounted: true });

    const drawer = screen.getByTestId("inbox-mobile-bill-panel");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(drawer.hasAttribute("inert")).toBe(true);
  });

  it("promotes the primary triage verbs while the overflow keeps the long tail", () => {
    const { onAction } = renderMobileReader({
      email: {
        hasBill: false,
        uid: "gmail-work-abc123",
        account_id: "work",
        account_email: "work@example.test",
        _activeSnapshot: true,
        _lane: "needs_attention",
      },
    });

    const triageBar = screen.getByTestId("inbox-mobile-triage-bar");
    expect(within(triageBar).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Handled",
      "FYI",
      "Noise",
      "Snooze",
      "Trash",
    ]);
    fireEvent.click(within(triageBar).getByRole("button", { name: "Handled" }));
    expect(onAction).toHaveBeenCalledWith("snapshot-handled");

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    const actionsMenu = screen.getByTestId("inbox-mobile-actions-menu");
    expect(within(actionsMenu).getByText("Pin")).toBeTruthy();
    expect(within(actionsMenu).getByText("Mark read")).toBeTruthy();
    expect(within(actionsMenu).getByText("Open in Gmail")).toBeTruthy();
    expect(within(actionsMenu).queryByText("Handled")).toBeNull();
    expect(within(actionsMenu).queryByText("Move to FYI")).toBeNull();
    expect(within(actionsMenu).queryByText("Move to Noise")).toBeNull();
    expect(within(actionsMenu).queryByText("Snooze")).toBeNull();
    expect(within(actionsMenu).queryByText("Trash")).toBeNull();
  });

  it("shows an actioned Actual match and keeps bill details available for review", () => {
    renderMobileReader({
      billOpen: false,
      billResolution: {
        status: "resolved",
        actualStatus: {
          status: "already_recorded",
          evidence: { amount: 88.2, dueDate: "2026-07-16" },
        },
      },
    });

    expect(screen.getByText("Already recorded in Actual")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));
    expect(screen.getByText("View bill details")).toBeTruthy();
    expect(screen.queryByText("Open bill pay")).toBeNull();
  });

  it("opens an already-recorded transaction in the calendar from the actions menu", () => {
    const { onOpenRecordedBill, setBillOpen } = renderMobileReader({
      billOpen: true,
      billResolution: {
        status: "resolved",
        actualStatus: {
          status: "already_recorded",
          evidence: {
            kind: "transaction",
            transactionId: "transaction-42",
            dueDate: "2026-07-16",
          },
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));
    fireEvent.click(screen.getByText("View bill details"));

    expect(onOpenRecordedBill).toHaveBeenCalledWith({
      date: "2026-07-16",
      itemId: "transaction-42",
    });
    expect(setBillOpen).not.toHaveBeenCalled();
  });

  it("allows FYI snapshot rows to be marked handled from the one-tap bar", () => {
    const { onAction } = renderMobileReader({
      email: {
        hasBill: false,
        _activeSnapshot: true,
        _lane: "fyi",
      },
    });

    const triageBar = screen.getByTestId("inbox-mobile-triage-bar");
    fireEvent.click(within(triageBar).getByRole("button", { name: "Handled" }));

    expect(onAction).toHaveBeenCalledWith("snapshot-handled");
    expect(within(triageBar).queryByText("FYI")).toBeNull();
  });
});

describe("MobileReader pin toggle", () => {
  it("renders the current pin state and dispatches pin-toggle from the tap menu", () => {
    const { onAction } = renderMobileReader({
      billOpen: false,
      email: { hasBill: false },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));
    fireEvent.click(screen.getByText("Pin"));

    expect(onAction).toHaveBeenCalledWith("pin-toggle", undefined);

    cleanup();
    renderMobileReader({
      billOpen: false,
      email: { hasBill: false, _pinned: true },
    });
    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));
    expect(screen.getByText("Unpin")).toBeTruthy();
  });
});
