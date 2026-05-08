import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MobileReader from "./MobileReader.jsx";

const billBadgeMock = vi.hoisted(() => vi.fn());

vi.mock("../../bills/BillBadge", () => ({
  default: function BillBadgeMock(props) {
    billBadgeMock(props);
    return <div data-testid="mobile-bill-badge" />;
  },
}));

afterEach(() => {
  cleanup();
  billBadgeMock.mockClear();
});

function renderMobileReader(overrides = {}) {
  const onAction = vi.fn();
  render(
    <MobileReader
      email={{
        id: "msg-1",
        uid: "msg-1",
        subject: "Card payment due",
        from: "Bank",
        fromEmail: "bank@example.test",
        date: "2026-05-03T15:00:00.000Z",
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
      billOpen
      setBillOpen={() => {}}
      snoozeOpen={false}
      setSnoozeOpen={() => {}}
      bodyState={overrides.bodyState || {
        loading: false,
        error: null,
        body: "<html><body>Full mobile provider bill with amount $88.20.</body></html>",
      }}
      drafting={false}
      setDrafting={() => {}}
    />,
  );
  return { onAction };
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

  it("keeps mobile actions tap-first without desktop key hints", () => {
    renderMobileReader({
      email: {
        hasBill: false,
        _activeSnapshot: true,
        _lane: "needs_attention",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    expect(screen.getByText("Handled")).toBeTruthy();
    expect(screen.getByText("Snooze")).toBeTruthy();
    expect(screen.getByText("Trash")).toBeTruthy();
    expect(screen.queryByText("H")).toBeNull();
    expect(screen.queryByText("S")).toBeNull();
    expect(screen.queryByText("E")).toBeNull();
  });

  it("allows FYI snapshot rows to be marked handled from the tap menu", () => {
    renderMobileReader({
      email: {
        hasBill: false,
        _activeSnapshot: true,
        _lane: "fyi",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    expect(screen.getByText("Handled")).toBeTruthy();
    expect(screen.queryByText("Move to FYI")).toBeNull();
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
      email: {
        hasBill: false,
        _activeSnapshot: true,
        _lane: "queued",
        _arrivalGraceQueued: true,
      },
    });

    expect(screen.getByText("Queued")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    expect(screen.getByText("Dismiss")).toBeTruthy();
    expect(screen.getByText("Snooze")).toBeTruthy();
    expect(screen.getByText("Trash")).toBeTruthy();
    expect(screen.queryByText("Move to Needs")).toBeNull();
    expect(screen.queryByText("Move to FYI")).toBeNull();
    expect(screen.queryByText("Move to Noise")).toBeNull();
    expect(screen.queryByText("Handled")).toBeNull();

    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("snapshot-dismiss", undefined);
  });

  it("hides snapshot lifecycle actions for untriaged-read rows", () => {
    renderMobileReader({
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
    expect(screen.queryByText("Dismiss")).toBeNull();
    expect(screen.queryByText("Move to FYI")).toBeNull();
    expect(screen.queryByText("Handled")).toBeNull();
  });
});
