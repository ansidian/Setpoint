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
      onAction={() => {}}
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
});
