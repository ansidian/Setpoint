import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState, type ComponentProps } from "react";
import LaneSection from "./LaneSection";
import type { InboxEmailLike } from "./inboxTypes";
import { makeInboxEmail } from "./test-utils/inboxFixtures";

afterEach(() => {
  cleanup();
});

function renderRowsSpy(list: InboxEmailLike[]) {
  return list.map((email) => <div key={email.id}>{email.subject}</div>);
}

function renderLaneSection(props: Partial<ComponentProps<typeof LaneSection>> = {}) {
  const utils = render(
    <LaneSection
      laneKey="needs_attention"
      emails={[makeInboxEmail({ id: "need-1", subject: "Needs attention deck", _lane: "needs_attention" })]}
      collapsed={false}
      noiseUnreadCount={0}
      onToggle={() => {}}
      renderRows={renderRowsSpy}
      {...props}
    />,
  );
  return utils;
}

describe("LaneSection", () => {
  it("renders the lane header, count, and rows when expanded", () => {
    renderLaneSection();
    expect(screen.getByText("Needs Attention")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("Needs attention deck")).toBeTruthy();
  });

  it("hides rows when collapsed but keeps the header", () => {
    renderLaneSection({ collapsed: true });
    expect(screen.getByText("Needs Attention")).toBeTruthy();
    expect(screen.queryByText("Needs attention deck")).toBeNull();
  });

  it("collapses the lane when the header is activated", async () => {
    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return <LaneSection laneKey="needs_attention" emails={[makeInboxEmail({ id: "need-1", subject: "Needs attention deck", _lane: "needs_attention" })]} collapsed={collapsed} noiseUnreadCount={0} onToggle={() => setCollapsed((value) => !value)} renderRows={renderRowsSpy} />;
    }
    render(<Harness />);
    expect(screen.getByText("Needs attention deck")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(screen.queryByText("Needs attention deck")).toBeNull());
  });

  it("shows the noise-unread pill only for the noise lane with a positive count", () => {
    const { unmount } = renderLaneSection({ laneKey: "noise", noiseUnreadCount: 3 });
    expect(screen.getByText("3 unread")).toBeTruthy();
    unmount();

    // A non-noise lane never renders the pill, even when a positive count is passed.
    renderLaneSection({ laneKey: "fyi", noiseUnreadCount: 3 });
    expect(screen.queryByText("3 unread")).toBeNull();
  });

  it("renders updated rows when its emails change", () => {
    const onToggle = () => {};
    const first = [makeInboxEmail({ id: "need-1", subject: "A", _lane: "needs_attention" })];
    const { rerender } = render(
      <LaneSection laneKey="needs_attention" emails={first} collapsed={false} noiseUnreadCount={0} onToggle={onToggle} renderRows={renderRowsSpy} />,
    );

    const second = [makeInboxEmail({ id: "need-1", subject: "A (updated)", _lane: "needs_attention" })];
    rerender(
      <LaneSection laneKey="needs_attention" emails={second} collapsed={false} noiseUnreadCount={0} onToggle={onToggle} renderRows={renderRowsSpy} />,
    );
    expect(screen.getByText("A (updated)")).toBeTruthy();
  });
});
