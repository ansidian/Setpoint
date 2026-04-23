import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InboxList from "./InboxList.jsx";

vi.mock("./EmailRow", () => ({
  default: function EmailRowMock() {
    return <div data-testid="email-row">Email row</div>;
  },
}));

vi.mock("./primitives", () => ({
  Kbd: function KbdMock({ children }) {
    return <kbd>{children}</kbd>;
  },
  StickyHeader: function StickyHeaderMock({ children }) {
    return <div>{children}</div>;
  },
  IconBtn: function IconBtnMock({ children, onClick, title }) {
    return (
      <button type="button" onClick={onClick} title={title}>
        {children}
      </button>
    );
  },
  LaneIcon: function LaneIconMock() {
    return <span aria-hidden="true" />;
  },
}));

describe("InboxList", () => {
  it("renders the empty list state as a bounded square card near the top-left", () => {
    render(
      <InboxList
        accent="#cba6da"
        emails={[]}
        accountsById={{}}
        selectedId={null}
        onOpen={() => {}}
        density="default"
        layout="swimlanes"
        showPreview
        pinnedIds={new Set()}
        searchQuery=""
        onSearchChange={() => {}}
        onMarkAllRead={() => {}}
        onRefresh={() => {}}
        totalCount={0}
        unreadCount={0}
        briefingAgoLabel={null}
        briefingGeneratedAt={null}
        searchRef={null}
      />,
    );

    const card = screen.getByTestId("inbox-list-empty-state-card");
    expect(card.style.width).toBe("100%");
    expect(card.style.aspectRatio).toBe("1 / 1");
    expect(screen.getByText("No emails available")).toBeTruthy();
  });
});
