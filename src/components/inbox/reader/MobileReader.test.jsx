import { cleanup, render, screen } from "@testing-library/react";
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
});
