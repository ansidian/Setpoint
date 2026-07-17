import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import LaneSection from "./LaneSection";
import type { InboxEmailLike } from "./inboxTypes";
import { makeInboxEmail } from "./test-utils/inboxFixtures";

vi.mock("./primitives", () => ({
  StickyHeader: function StickyHeaderMock({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  },
  LaneIcon: function LaneIconMock() {
    return <span aria-hidden="true" />;
  },
}));

afterEach(() => {
  cleanup();
});

function renderRowsSpy(list: InboxEmailLike[]) {
  return list.map((email) => <div key={email.id}>{email.subject}</div>);
}

function renderLaneSection(props: Partial<ComponentProps<typeof LaneSection>> = {}) {
  const renderRows = vi.fn(renderRowsSpy);
  const utils = render(
    <LaneSection
      laneKey="needs_attention"
      emails={[makeInboxEmail({ id: "need-1", subject: "Needs attention deck", _lane: "needs_attention" })]}
      collapsed={false}
      noiseUnreadCount={0}
      onToggle={() => {}}
      renderRows={renderRows}
      {...props}
    />,
  );
  return { ...utils, renderRows };
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

  it("fires onToggle with the lane key when the header is activated", () => {
    const onToggle = vi.fn();
    renderLaneSection({ onToggle });
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledWith("needs_attention");
  });

  it("shows the noise-unread pill only for the noise lane with a positive count", () => {
    const { unmount } = renderLaneSection({ laneKey: "noise", noiseUnreadCount: 3 });
    expect(screen.getByText("3 unread")).toBeTruthy();
    unmount();

    // A non-noise lane never renders the pill, even when a positive count is passed.
    renderLaneSection({ laneKey: "fyi", noiseUnreadCount: 3 });
    expect(screen.queryByText("3 unread")).toBeNull();
  });

  it("does not re-render when emails, collapsed, onToggle, and renderRows are referentially stable", () => {
    const emails = [makeInboxEmail({ id: "need-1", subject: "Needs attention deck", _lane: "needs_attention" })];
    const renderRows = vi.fn(renderRowsSpy);
    const onToggle = () => {};
    const { rerender } = render(
      <LaneSection laneKey="needs_attention" emails={emails} collapsed={false} noiseUnreadCount={0} onToggle={onToggle} renderRows={renderRows} />,
    );
    expect(renderRows).toHaveBeenCalledTimes(1);

    // All of LaneSection's props keep stable identity -> the memo must bail out.
    rerender(
      <LaneSection laneKey="needs_attention" emails={emails} collapsed={false} noiseUnreadCount={0} onToggle={onToggle} renderRows={renderRows} />,
    );
    expect(renderRows).toHaveBeenCalledTimes(1);
  });

  it("re-renders when its own emails array identity changes", () => {
    const renderRows = vi.fn(renderRowsSpy);
    const onToggle = () => {};
    const first = [makeInboxEmail({ id: "need-1", subject: "A", _lane: "needs_attention" })];
    const { rerender } = render(
      <LaneSection laneKey="needs_attention" emails={first} collapsed={false} noiseUnreadCount={0} onToggle={onToggle} renderRows={renderRows} />,
    );
    expect(renderRows).toHaveBeenCalledTimes(1);

    const second = [makeInboxEmail({ id: "need-1", subject: "A (updated)", _lane: "needs_attention" })];
    rerender(
      <LaneSection laneKey="needs_attention" emails={second} collapsed={false} noiseUnreadCount={0} onToggle={onToggle} renderRows={renderRows} />,
    );
    expect(renderRows).toHaveBeenCalledTimes(2);
    expect(screen.getByText("A (updated)")).toBeTruthy();
  });
});
