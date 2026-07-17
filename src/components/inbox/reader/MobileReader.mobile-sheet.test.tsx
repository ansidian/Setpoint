// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useState } from "react";
import MobileReader from "./MobileReader";

// The reader is explicitly the mobile surface; its menus must remain mobile
// even if the shared media-query hook has not caught up during hydration.
vi.mock("../../../hooks/useIsMobile", () => ({ default: () => false }));
vi.mock("../../bills/BillBadge", () => ({ default: () => null }));

afterEach(() => cleanup());

function MobileSheetHarness() {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  return <MobileReader
    email={{
      id: "mobile-message", uid: "gmail-work-mobile-message", account_id: "work",
      subject: "Mobile menus", from: "Sender", date: "2026-07-17T12:00:00Z",
      snapshot_item_id: 42, _activeSnapshot: true, _lane: "needs_attention",
    }}
    account={{ name: "Work" }}
    accent="#cba6da"
    onAction={() => {}}
    onClose={() => {}}
    showTriage={false}
    billOpen={billOpen}
    setBillOpen={setBillOpen}
    snoozeOpen={snoozeOpen}
    setSnoozeOpen={setSnoozeOpen}
    bodyState={{ loading: false, body: "Body", error: null, source: "loaded" }}
    drafting={drafting}
    setDrafting={setDrafting}
  />;
}

describe("MobileReader mobile-sheet menus", () => {
  it("opens Actions and Snooze from their visible mobile controls and keeps them open after history settles", async () => {
    render(<StrictMode><MobileSheetHarness /></StrictMode>);

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("dialog", { name: "Email actions" })).toBeTruthy();
    expect(within(screen.getByRole("dialog", { name: "Email actions" })).getByText("Pin")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Email actions" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    const snoozeDialog = screen.getByRole("dialog", { name: "Snooze" });
    const snoozeMenu = within(snoozeDialog).getByRole("menu", { name: "Snooze until" });
    const snoozeActions = within(snoozeMenu).getAllByRole("menuitem");
    expect(snoozeActions).toHaveLength(6);
    expect(snoozeActions.every((action) => action.style.minHeight === "var(--sp-touch-min)")).toBe(true);
    expect(within(snoozeDialog).queryByText("Snooze until")).toBeNull();
  });
});
