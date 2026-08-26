import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Fragment, useState, type ComponentProps } from "react";
import MobileReader from "./MobileReader";
import type { InboxEmailLike } from "../inboxTypes";
import { IDLE_BILL_RESOLUTION } from "./readerTypes";
import type { BillResolutionState } from "./readerTypes";

afterEach(() => {
  cleanup();
});

type MobileReaderOverrides = Omit<Partial<ComponentProps<typeof MobileReader>>, "email" | "billResolution"> & {
  email?: Partial<InboxEmailLike>;
  billResolution?: Partial<BillResolutionState>;
};

function renderMobileReader(overrides: MobileReaderOverrides = {}) {
  const onAction = vi.fn();
  function Harness() {
    const [billOpen, setBillOpen] = useState(overrides.billOpen ?? true);
    const [openedBill, setOpenedBill] = useState("");
    return <Fragment><output aria-label="Opened recorded bill">{openedBill}</output><output aria-label="Bill drawer state">{billOpen ? "open" : "closed"}</output><MobileReader
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
      billOpen={billOpen}
      billMounted={overrides.billMounted}
      setBillOpen={overrides.setBillOpen || setBillOpen}
      onOpenRecordedBill={overrides.onOpenRecordedBill || ((target) => setOpenedBill(JSON.stringify(target)))}
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
      setDrafting={overrides.setDrafting || (() => {})}
    /></Fragment>;
  }
  render(<Harness />);
  return { onAction };
}

describe("MobileReader controls", () => {
  it("places loaded attachments above the mobile email body", () => {
    renderMobileReader({
      bodyState: {
        loading: false,
        error: null,
        body: "Body",
        source: "loaded",
        attachments: [{ id: "2", filename: "report.pdf", contentType: "application/pdf", inline: false }],
      },
    });

    expect(screen.getByLabelText("1 email attachment")).toBeTruthy();
  });

  it("keeps a previously opened bill drawer mounted but inert while closed", () => {
    renderMobileReader({ billOpen: false, billMounted: true });

    const drawer = screen.getByTestId("inbox-mobile-bill-panel");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(drawer.hasAttribute("inert")).toBe(true);
  });

  it("promotes the primary triage verbs while the overflow keeps the long tail", () => {
    renderMobileReader({
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
    renderMobileReader({
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

    expect(screen.getByLabelText("Opened recorded bill").textContent).toBe(JSON.stringify({
      date: "2026-07-16", itemId: "transaction-42",
    }));
    expect(screen.getByLabelText("Bill drawer state").textContent).toBe("open");
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
    expect(within(triageBar).queryByText("FYI")).toBeNull();
  });
});

describe("MobileReader pin toggle", () => {
  it("renders the current pin state in the tap menu", () => {
    renderMobileReader({
      billOpen: false,
      email: { hasBill: false, _pinned: true },
    });
    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));
    expect(screen.getByText("Unpin")).toBeTruthy();
  });
});
