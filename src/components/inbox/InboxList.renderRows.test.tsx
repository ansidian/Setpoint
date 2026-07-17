import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, MouseEventHandler, ReactNode } from "react";
import InboxList from "./InboxList";
import type { InboxEmailLike } from "./inboxTypes";
import { makeInboxEmail } from "./test-utils/inboxFixtures";

// PERF-04: InboxList must hand LaneSection a referentially-stable `renderRows`
// so LaneSection's own memo (proven in LaneSection.test.tsx) actually engages.
// Mocking LaneSection here (rather than in InboxList.test.tsx) keeps that
// file's real-lane-rendering assertions intact — this file only probes the
// renderRows prop identity.
interface LaneSectionCall {
  laneKey: string;
  renderRows: (emails: InboxEmailLike[]) => ReactNode;
}

const { laneSectionCalls } = vi.hoisted(() => ({ laneSectionCalls: [] as LaneSectionCall[] }));

vi.mock("./LaneSection", () => ({
  default: function LaneSectionMock(props: LaneSectionCall) {
    laneSectionCalls.push(props);
    return <div data-testid={`lane-${props.laneKey}`}>{props.laneKey}</div>;
  },
}));

vi.mock("./primitives", () => ({
  Avatar: function AvatarMock({ name }: { name?: string | null }) {
    return <span aria-hidden="true">{name?.slice(0, 1)}</span>;
  },
  Kbd: function KbdMock({ children }: { children: ReactNode }) {
    return <kbd>{children}</kbd>;
  },
  StickyHeader: function StickyHeaderMock({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  },
  IconBtn: function IconBtnMock({ children, onClick, title }: { children: ReactNode; onClick: MouseEventHandler<HTMLButtonElement>; title?: string }) {
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

afterEach(() => {
  cleanup();
  laneSectionCalls.length = 0;
});

describe("InboxList renderRows stability", () => {
  it("passes a referentially stable renderRows to LaneSection across unrelated re-renders", () => {
    const accountsById = {};
    const onOpen = () => {};
    const emails = [makeInboxEmail({ id: "need-1", subject: "Needs attention deck", _lane: "needs_attention" })];

    const baseProps = {
      accent: "#cba6da",
      emails,
      accountsById,
      selectedId: null,
      onOpen,
      density: "default",
      layout: "swimlanes",
      showPreview: true,
      searchQuery: "",
      onSearchChange: () => {},
      onMarkAllRead: () => {},
      onRefresh: () => {},
      totalCount: 1,
      unreadCount: 1,
      briefingGeneratedAt: null,
      searchRef: null,
      activeSnapshotMode: true,
    } satisfies ComponentProps<typeof InboxList>;

    const { rerender } = render(<InboxList {...baseProps} />);

    // Unrelated re-render: unreadCount only feeds the count-header text, not
    // any of renderRows's closure inputs (accountsById/selectedId/onOpen/
    // density/showPreview/accent/nowTick).
    rerender(<InboxList {...baseProps} unreadCount={2} />);

    expect(laneSectionCalls.length).toBeGreaterThanOrEqual(2);
    const renderRowsRefs = laneSectionCalls.map((call) => call.renderRows);
    expect(renderRowsRefs[renderRowsRefs.length - 1]).toBe(renderRowsRefs[0]);
  });
});
