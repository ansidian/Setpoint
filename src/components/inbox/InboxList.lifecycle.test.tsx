import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import KeepAliveTab from "../dashboard/KeepAliveTab";
import InboxList from "./InboxList";
import type { InboxId } from "./inboxTypes";
import { makeInboxEmail } from "./test-utils/inboxFixtures";

// Consequential interaction regression: mail updated while Activity hides Inbox
// must leave its old lane and remain selectable. Keep the real tab lifecycle,
// list, nested lane/row presence, and buttons; no animation or internal mocks.
function InboxLifecycleHarness({ single }: { single: boolean }) {
  const [active, setActive] = useState(true);
  const [handled, setHandled] = useState(false);
  const [selected, setSelected] = useState<InboxId | null>(null);
  const target = makeInboxEmail({ _lane: handled ? "handled" : "needs_attention" });
  const emails = single ? [target] : [target, makeInboxEmail({
    id: "other", subject: "Other email", _lane: "needs_attention",
  })];

  return <>
    <button onClick={() => setActive((value) => !value)}>Switch tab</button>
    <button onClick={() => setHandled(true)}>Handle from dashboard</button>
    <output aria-label="Opened email">{selected}</output>
    <KeepAliveTab active={active}>
      <InboxList
        accent="#cba6da" emails={emails} accountsById={{}} selectedId={selected}
        onOpen={(email) => setSelected(email.id ?? null)} density="default"
        layout="swimlanes" showPreview searchQuery="" onClearSearch={() => {}}
        onShowAllMail={() => {}} onMarkAllRead={() => {}} onRefresh={() => {}}
        totalCount={emails.length} unreadCount={emails.length} activeSnapshotMode
      />
    </KeepAliveTab>
  </>;
}

afterEach(cleanup);

describe("Inbox mail updated while its tab is hidden", () => {
  it.each([false, true])("removes the stale row and opens handled mail (last in lane: %s)", async (single) => {
    render(<InboxLifecycleHarness single={single} />);
    fireEvent.click(screen.getByRole("button", { name: "Switch tab" }));
    fireEvent.click(screen.getByRole("button", { name: "Handle from dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch tab" }));

    // Handled starts collapsed. The old row must actually leave the DOM, not
    // stay visible under an inert ancestor where native clicks cannot reach it.
    await waitFor(() => expect(screen.queryByText("Project budget sign-off")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Handled/ }));
    const row = await screen.findByRole("button", { name: /Dana, Project budget sign-off/ });
    expect(row.closest("[inert]")).toBeNull();
    fireEvent.click(row);
    expect(screen.getByRole("status", { name: "Opened email" }).textContent).toBe("email-action");
  });
});
