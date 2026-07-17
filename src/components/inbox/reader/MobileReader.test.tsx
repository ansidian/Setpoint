// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import MobileReader from "./MobileReader";
import type { InboxEmailLike } from "../inboxTypes";
import { IDLE_BILL_RESOLUTION } from "./readerTypes";
import type { BillResolutionState } from "./readerTypes";

const billBadgeMock = vi.hoisted(() => vi.fn());

vi.mock("../../bills/BillBadge", () => ({
  default: function BillBadgeMock(props: Record<string, unknown>) {
    billBadgeMock(props);
    return <div data-testid="mobile-bill-badge" />;
  },
}));

afterEach(() => {
  cleanup();
  billBadgeMock.mockClear();
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
  return { onAction, onOpenRecordedBill, setBillOpen, setDrafting };
}

describe("MobileReader bill extraction", () => {
  it("passes the loaded provider body to bill extraction instead of preview text", () => {
    renderMobileReader();

    expect(screen.getByTestId("mobile-bill-badge")).toBeTruthy();
    expect(billBadgeMock).toHaveBeenCalledWith(expect.objectContaining({
      emailBody: "<html><body>Full mobile provider bill with amount $88.20.</body></html>",
      emailBodyLoading: false,
      emailBodySource: "loaded",
    }));
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

  it("opens an already-scheduled bill in the calendar from the actions menu", () => {
    const { onOpenRecordedBill, setBillOpen } = renderMobileReader({
      billOpen: true,
      billResolution: {
        status: "resolved",
        actualStatus: {
          status: "already_scheduled",
          evidence: {
            kind: "schedule",
            scheduleId: "schedule-acme",
            dueDate: "2026-08-12",
          },
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));
    fireEvent.click(screen.getByText("View bill details"));

    expect(onOpenRecordedBill).toHaveBeenCalledWith({
      date: "2026-08-12",
      itemId: "schedule-acme",
    });
    expect(setBillOpen).not.toHaveBeenCalled();
  });

  it("hides mobile bill pay for triaged non-bill emails", () => {
    renderMobileReader({
      email: {
        hasBill: false,
        _activeSnapshot: true,
        _lane: "needs_attention",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    expect(screen.queryByText("Open bill pay")).toBeNull();
  });

  it("allows FYI snapshot rows to be marked handled from the one-tap bar", () => {
    renderMobileReader({
      email: {
        hasBill: false,
        _activeSnapshot: true,
        _lane: "fyi",
      },
    });

    const triageBar = screen.getByTestId("inbox-mobile-triage-bar");
    expect(within(triageBar).getByText("Handled")).toBeTruthy();
    expect(within(triageBar).queryByText("FYI")).toBeNull();
  });

  it("limits Catch-up rows to read state and Gmail open actions", () => {
    renderMobileReader({
      email: {
        id: "gmail-gmail-work-late-fyi",
        uid: "gmail-gmail-work-late-fyi",
        account_id: "gmail-work",
        account_email: "work@example.test",
        hasBill: true,
        claude: { draftReply: "Thanks." },
        _activeSnapshot: true,
        _lane: "catch_up",
        lane_at_snapshot: "fyi",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    expect(screen.getByText("Mark read")).toBeTruthy();
    expect(screen.getByText("Open in Gmail")).toBeTruthy();
    expect(screen.queryByText("Open bill pay")).toBeNull();
    expect(screen.queryByText("Show draft reply")).toBeNull();
    expect(screen.queryByText("Move to Needs")).toBeNull();
    expect(screen.queryByText("Move to FYI")).toBeNull();
    expect(screen.queryByText("Move to Noise")).toBeNull();
    expect(screen.queryByText("Handled")).toBeNull();
    expect(screen.queryByText("Dismiss")).toBeNull();
    expect(screen.queryByText("Snooze")).toBeNull();
    expect(screen.queryByText("Trash")).toBeNull();
  });

  it("keeps queued snapshot rows dismissible but hides manual triage moves", () => {
    const { onAction } = renderMobileReader({
      billOpen: false,
      email: {
        hasBill: false,
        _activeSnapshot: true,
        _lane: "queued",
        _arrivalGraceQueued: true,
      },
    });

    expect(screen.getByText("Queued")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    const actionsMenu = screen.getByTestId("inbox-mobile-actions-menu");
    expect(within(actionsMenu).getByText("Dismiss")).toBeTruthy();
    expect(within(actionsMenu).getByText("Open bill pay")).toBeTruthy();
    expect(within(actionsMenu).queryByText("Move to Needs")).toBeNull();

    const triageBar = screen.getByTestId("inbox-mobile-triage-bar");
    expect(within(triageBar).getByText("Snooze")).toBeTruthy();
    expect(within(triageBar).getByText("Trash")).toBeTruthy();
    expect(within(triageBar).queryByText("FYI")).toBeNull();
    expect(within(triageBar).queryByText("Noise")).toBeNull();
    expect(within(triageBar).queryByText("Handled")).toBeNull();

    fireEvent.click(within(actionsMenu).getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("snapshot-dismiss", undefined);
  });

  it("hides snapshot lifecycle actions for untriaged-read rows", () => {
    renderMobileReader({
      billOpen: false,
      email: {
        hasBill: false,
        read: true,
        _activeSnapshot: true,
        _lane: "untriaged_read",
        _untriagedRead: true,
      },
    });

    expect(screen.getByText("Read")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    expect(screen.getByText("Mark unread")).toBeTruthy();
    expect(screen.getByText("Open bill pay")).toBeTruthy();
    expect(screen.queryByText("Dismiss")).toBeNull();
    expect(screen.queryByText("Move to FYI")).toBeNull();
    expect(screen.queryByText("Handled")).toBeNull();
  });

  it("hides snapshot lifecycle actions when snapshot_item_id is missing (drift guard)", () => {
    renderMobileReader({
      billOpen: false,
      email: { hasBill: false, _activeSnapshot: true, _lane: "needs_attention", snapshot_item_id: undefined },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    expect(screen.queryByText("Handled")).toBeNull();
    expect(screen.queryByText("Dismiss")).toBeNull();
    expect(screen.queryByText("Move to FYI")).toBeNull();
    expect(screen.queryByText("Move to Noise")).toBeNull();
  });
});

describe("MobileReader pin toggle", () => {
  it("renders a pin action in the tap menu and dispatches pin-toggle when clicked", () => {
    const { onAction } = renderMobileReader({
      billOpen: false,
      email: { hasBill: false },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));
    fireEvent.click(screen.getByText("Pin"));

    expect(onAction).toHaveBeenCalledWith("pin-toggle", undefined);
  });

  it("flips the label to Unpin when the email is pinned", () => {
    renderMobileReader({
      billOpen: false,
      email: { hasBill: false, _pinned: true },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    expect(screen.getByText("Unpin")).toBeTruthy();
    expect(screen.queryByText("Pin")).toBeNull();
  });

  it("tints the pinned pin row lavender to match the desktop pin toggle", () => {
    renderMobileReader({
      billOpen: false,
      email: { hasBill: false, _pinned: true },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    const pinRow = screen.getByText("Unpin").closest("button");
    expect(pinRow?.style.color).toMatch(/#b4befe|rgb\(180,\s*190,\s*254\)/i);

    const snoozeRow = screen.getByText("Snooze").closest("button");
    expect(snoozeRow?.style.color).toMatch(/rgba\(205,\s*214,\s*244,\s*0\.8\)/);
  });

  it("renders the pin action even for catch-up rows", () => {
    renderMobileReader({
      billOpen: false,
      email: {
        hasBill: false,
        _activeSnapshot: true,
        _lane: "catch_up",
        lane_at_snapshot: "fyi",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    expect(screen.getByText("Pin")).toBeTruthy();
  });
});

describe("MobileReader draft reply (P1-2)", () => {
  it("copies the AI draft to the clipboard without trashing the email", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { onAction, setDrafting } = renderMobileReader({
      drafting: true,
      email: { hasBill: false, claude: { draftReply: "Sounds good." } },
    });

    fireEvent.click(screen.getByRole("button", { name: /copy draft/i }));

    await waitFor(() => expect(setDrafting).toHaveBeenCalledWith(false));
    expect(writeText).toHaveBeenCalledWith("Sounds good.");
    expect(onAction).not.toHaveBeenCalledWith("trash");
    expect(screen.queryByRole("button", { name: /^send$/i })).toBeNull();
  });
});
