import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StrictMode, useState } from "react";
import MobileReader from "./MobileReader";

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
    const snoozeDialog = await screen.findByRole("dialog", { name: "Snooze" });
    const snoozeMenu = within(snoozeDialog).getByRole("menu", { name: "Snooze until" });
    const snoozeActions = within(snoozeMenu).getAllByRole("menuitem");
    expect(snoozeActions).toHaveLength(6);
    expect(within(snoozeDialog).queryByText("Snooze until")).toBeNull();
  });
});
