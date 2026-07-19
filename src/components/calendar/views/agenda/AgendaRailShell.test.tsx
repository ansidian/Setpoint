import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import type { ReactNode, Ref } from "react";
import AgendaMonthScrollContainer from "./AgendaMonthScrollContainer.tsx";
import AgendaRailShell from "./AgendaRailShell.tsx";
import type {
  AgendaMonthScrollContainerProps,
  AgendaMonthScrollHandle,
  AgendaRegistrationCallbacks,
  AgendaScrollCommand,
  AgendaScrollMonth,
} from "./AgendaMonthScrollContainer";
import type { AgendaRailGroup, AgendaRailShellProps } from "./AgendaRailShell";

type TestGroup = AgendaRailGroup;
type AgendaRenderHeader = NonNullable<AgendaRailShellProps<TestGroup>["renderHeader"]>;
type AgendaRenderGroup = NonNullable<AgendaRailShellProps<TestGroup>["renderGroup"]>;
type ContainerTestProps = Omit<AgendaMonthScrollContainerProps, "months" | "renderMonth"> & {
  firstVisibleDateKey?: string;
  ref?: Ref<AgendaMonthScrollHandle>;
  onDirtyBlocked?: () => void;
};
const asRect = (value: Omit<DOMRect, "x" | "y" | "toJSON">): DOMRect => value as DOMRect;

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const GROUPS = [
  { dateKey: "2026-05-01" },
  { dateKey: "2026-05-02" },
];

const MAY_WINDOW_MONTHS = [
  {
    monthKey: "2026-03",
    year: 2026,
    month: 2,
    firstVisibleDateKey: "2026-03-01",
    visibleGroups: [{ dateKey: "2026-03-01" }],
  },
  {
    monthKey: "2026-04",
    year: 2026,
    month: 3,
    firstVisibleDateKey: "2026-04-01",
    visibleGroups: [{ dateKey: "2026-04-01" }],
  },
  {
    monthKey: "2026-05",
    year: 2026,
    month: 4,
    firstVisibleDateKey: "2026-05-25",
    visibleGroups: [{ dateKey: "2026-05-25" }],
  },
  {
    monthKey: "2026-06",
    year: 2026,
    month: 5,
    firstVisibleDateKey: "2026-06-07",
    visibleGroups: [{ dateKey: "2026-06-07" }],
  },
  {
    monthKey: "2026-07",
    year: 2026,
    month: 6,
    firstVisibleDateKey: "2026-07-01",
    visibleGroups: [{ dateKey: "2026-07-01" }],
  },
];

async function flushRailEffects(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

async function advanceRailTime(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function wrapInContainer(
  groups: TestGroup[],
  containerProps: ContainerTestProps,
  renderHeader: AgendaRenderHeader,
  renderGroup: AgendaRenderGroup,
): ReactNode {
  const months = [{
    monthKey: "2026-05",
    year: 2026,
    month: 4,
    visibleGroups: groups,
    firstVisibleDateKey: containerProps.firstVisibleDateKey || groups[0]?.dateKey || "2026-05-01",
  }];
  return (
    <AgendaMonthScrollContainer
      {...containerProps}
      months={months}
      renderMonth={(month, callbacks) => (
        <AgendaRailShell
          groups={month.visibleGroups}
          {...callbacks}
          renderHeader={renderHeader}
          renderGroup={renderGroup}
        />
      )}
    />
  );
}

function renderShell({ scrollCommand = null, renderGroup }: {
  scrollCommand?: AgendaScrollCommand | null;
  renderGroup: AgendaRenderGroup;
}) {
  const renderHeader: AgendaRenderHeader = ({ group, registerHeader }) => (
    <button
      type="button"
      ref={(node) => registerHeader(group.dateKey, node)}
      data-testid={`header-${group.dateKey}`}
    >
      {group.dateKey}
    </button>
  );
  return render(
    wrapInContainer(GROUPS, {
      testId: "agenda-shell",
      firstVisibleDateKey: "2026-05-01",
      todayKey: "2026-05-01",
      selectedDateKey: "2026-05-01",
      scrollCommand,
    }, renderHeader, renderGroup),
  );
}

describe("AgendaRailShell", () => {
  it("waits for cold-entry readiness and lands on the captured entry date", async () => {
    const onTopmostDateChange = vi.fn();
    const renderHeader: AgendaRenderHeader = ({ group, registerHeader }) => (
      <button
        type="button"
        ref={(node) => registerHeader(group.dateKey, node)}
        data-testid={`header-${group.dateKey}`}
      >
        {group.dateKey}
      </button>
    );
    const renderGroup = () => null;

    const { rerender } = render(
      wrapInContainer(GROUPS, {
        testId: "agenda-shell",
        firstVisibleDateKey: "2026-05-01",
        todayKey: "2026-05-02",
        selectedDateKey: "2026-05-02",
        entryScrollTargetDateKey: "2026-05-02",
        entryScrollReady: false,
        onTopmostDateChange,
      }, renderHeader, renderGroup),
    );

    const rail = screen.getByTestId("agenda-shell");
    const firstHeader = screen.getByTestId("header-2026-05-01");
    const secondHeader = screen.getByTestId("header-2026-05-02");
    const firstSection = rail.querySelector("section[data-date-key='2026-05-01']")!;
    const secondSection = rail.querySelector("section[data-date-key='2026-05-02']")!;
    const scrollTo = vi.fn();
    rail.scrollTop = 0;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => asRect({ top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 });
    firstHeader.getBoundingClientRect = () => asRect({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    secondHeader.getBoundingClientRect = () => asRect({ top: 360, bottom: 394, left: 0, right: 280, width: 280, height: 34 });
    firstSection.getBoundingClientRect = () => asRect({ top: 0, bottom: 360, left: 0, right: 280, width: 280, height: 360 });
    secondSection.getBoundingClientRect = () => asRect({ top: 360, bottom: 720, left: 0, right: 280, width: 280, height: 360 });

    await flushRailEffects();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(rail.scrollTop).toBe(0);

    firstHeader.getBoundingClientRect = () => asRect({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    secondHeader.getBoundingClientRect = () => asRect({ top: 480, bottom: 514, left: 0, right: 280, width: 280, height: 34 });
    firstSection.getBoundingClientRect = () => asRect({ top: 0, bottom: 480, left: 0, right: 280, width: 280, height: 480 });
    secondSection.getBoundingClientRect = () => asRect({ top: 480, bottom: 840, left: 0, right: 280, width: 280, height: 360 });

    rerender(
      wrapInContainer(GROUPS, {
        testId: "agenda-shell",
        firstVisibleDateKey: "2026-05-01",
        todayKey: "2026-05-02",
        selectedDateKey: "2026-05-01",
        entryScrollTargetDateKey: "2026-05-02",
        entryScrollReady: true,
        onTopmostDateChange,
      }, renderHeader, renderGroup),
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 480,
      behavior: "auto",
    }));
    expect(rail.scrollTop).toBe(480);

    secondHeader.getBoundingClientRect = () => asRect({ top: 140, bottom: 174, left: 0, right: 280, width: 280, height: 34 });
    rerender(
      wrapInContainer(GROUPS.map((group) => ({ ...group })), {
        testId: "agenda-shell",
        firstVisibleDateKey: "2026-05-01",
        todayKey: "2026-05-02",
        selectedDateKey: "2026-05-01",
        entryScrollTargetDateKey: "2026-05-02",
        entryScrollReady: true,
        onTopmostDateChange,
      }, renderHeader, renderGroup),
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({
      top: 620,
      behavior: "auto",
    }));
    expect(rail.scrollTop).toBe(620);
    const entryScrollCalls = scrollTo.mock.calls.length;

    await advanceRailTime(760);

    expect(scrollTo).toHaveBeenCalledTimes(entryScrollCalls);

    firstHeader.getBoundingClientRect = () => asRect({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    secondHeader.getBoundingClientRect = () => asRect({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    firstSection.getBoundingClientRect = () => asRect({ top: -480, bottom: 0, left: 0, right: 280, width: 280, height: 480 });
    secondSection.getBoundingClientRect = () => asRect({ top: 0, bottom: 360, left: 0, right: 280, width: 280, height: 360 });

    fireEvent.scroll(rail);
    await flushRailEffects();

    expect(onTopmostDateChange).toHaveBeenCalled();
    expect(onTopmostDateChange.mock.calls.every(([dateKey]) => dateKey === "2026-05-02")).toBe(true);
  });

  it("does not replay cold-entry anchoring after an imperative item scroll", async () => {
    const railRef = createRef<AgendaMonthScrollHandle>();
    const renderHeader: AgendaRenderHeader = ({ group, registerHeader }) => (
      <button
        type="button"
        ref={(node) => registerHeader(group.dateKey, node)}
        data-testid={`header-${group.dateKey}`}
      >
        {group.dateKey}
      </button>
    );
    const renderGroup: AgendaRenderGroup = ({ group, registerRow }) => (
      group.dateKey === "2026-05-15" ? (
        <span
          ref={(node) => registerRow(`event-15-${group.dateKey}`, node, group.dateKey)}
          data-testid="far-agenda-row"
          data-item-id="event-15"
        >
          Far event
        </span>
      ) : null
    );
    const threeGroups = [
      { dateKey: "2026-05-01" },
      { dateKey: "2026-05-14" },
      { dateKey: "2026-05-15" },
    ];

    const { rerender } = render(
      wrapInContainer(threeGroups, {
        ref: railRef,
        testId: "agenda-shell",
        firstVisibleDateKey: "2026-05-01",
        todayKey: "2026-05-14",
        selectedDateKey: "2026-05-14",
        entryScrollTargetDateKey: "2026-05-14",
        entryScrollReady: true,
      }, renderHeader, renderGroup),
    );

    const rail = screen.getByTestId("agenda-shell");
    const may14Header = screen.getByTestId("header-2026-05-14");
    const row = screen.getByTestId("far-agenda-row");
    const scrollTo = vi.fn();
    rail.scrollTop = 0;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => asRect({ top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 });
    may14Header.getBoundingClientRect = () => asRect({ top: 360, bottom: 394, left: 0, right: 280, width: 280, height: 34 });
    row.getBoundingClientRect = () => asRect({ top: 760, bottom: 804, left: 0, right: 280, width: 280, height: 44 });

    await flushRailEffects();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 360,
      behavior: "auto",
    }));
    scrollTo.mockClear();

    expect(railRef.current!.scrollToItem("event-15", "2026-05-15", "grid-chip-click")).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 854,
      behavior: "smooth",
    }));

    may14Header.getBoundingClientRect = () => asRect({ top: 40, bottom: 74, left: 0, right: 280, width: 280, height: 34 });
    row.getBoundingClientRect = () => asRect({ top: 44, bottom: 88, left: 0, right: 280, width: 280, height: 44 });
    rerender(
      wrapInContainer(threeGroups.map((group) => ({ ...group })), {
        ref: railRef,
        testId: "agenda-shell",
        firstVisibleDateKey: "2026-05-01",
        todayKey: "2026-05-14",
        selectedDateKey: "2026-05-15",
        entryScrollTargetDateKey: "2026-05-14",
        entryScrollReady: true,
      }, renderHeader, renderGroup),
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("scrolls today's first row below the sticky date header", async () => {
    const renderGroup: AgendaRenderGroup = ({ group, registerRow }) => (
      group.dateKey === "2026-05-01" ? (
        <span
          ref={(node) => registerRow(`first-${group.dateKey}`, node, group.dateKey)}
          data-testid="today-first-row"
        >
          First row
        </span>
      ) : null
    );
    const renderHeader: AgendaRenderHeader = ({ group, registerHeader }) => (
      <button
        type="button"
        ref={(node) => registerHeader(group.dateKey, node)}
        data-testid={`header-${group.dateKey}`}
      >
        {group.dateKey}
      </button>
    );
    const { rerender } = renderShell({ renderGroup });
    await flushRailEffects();

    const rail = screen.getByTestId("agenda-shell");
    const row = screen.getByTestId("today-first-row");
    const scrollTo = vi.fn();
    rail.scrollTop = 120;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => asRect({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    row.getBoundingClientRect = () => asRect({ top: 20, bottom: 64, left: 0, right: 280, width: 280, height: 44 });

    rerender(
      wrapInContainer(GROUPS, {
        testId: "agenda-shell",
        firstVisibleDateKey: "2026-05-01",
        todayKey: "2026-05-01",
        selectedDateKey: "2026-05-01",
        scrollCommand: { type: "today", id: "today-1" },
      }, renderHeader, renderGroup),
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 96,
      behavior: "smooth",
    }));
  });

  it("keeps passive scroll from overriding a new today command until today lands", async () => {
    const onTopmostDateChange = vi.fn();
    const renderHeader: AgendaRenderHeader = ({ group, registerHeader }) => (
      <button
        type="button"
        ref={(node) => registerHeader(group.dateKey, node)}
        data-testid={`header-${group.dateKey}`}
      >
        {group.dateKey}
      </button>
    );
    const renderGroup = () => null;

    const { rerender } = render(
      wrapInContainer(GROUPS, {
        testId: "agenda-shell",
        firstVisibleDateKey: "2026-05-01",
        todayKey: "2026-05-01",
        selectedDateKey: "2026-05-01",
        onTopmostDateChange,
      }, renderHeader, renderGroup),
    );
    await flushRailEffects();
    await advanceRailTime(500);

    const rail = screen.getByTestId("agenda-shell");
    const firstSection = rail.querySelector("section[data-date-key='2026-05-01']")!;
    const secondSection = rail.querySelector("section[data-date-key='2026-05-02']")!;
    const scrollTo = vi.fn();
    rail.scrollTop = 320;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => asRect({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    firstSection.getBoundingClientRect = () => asRect({ top: -120, bottom: -20, left: 0, right: 280, width: 280, height: 100 });
    secondSection.getBoundingClientRect = () => asRect({ top: 4, bottom: 104, left: 0, right: 280, width: 280, height: 100 });

    fireEvent.scroll(rail);

    rerender(
      wrapInContainer(GROUPS, {
        testId: "agenda-shell",
        firstVisibleDateKey: "2026-05-01",
        todayKey: "2026-05-01",
        selectedDateKey: "2026-05-01",
        scrollCommand: { type: "today", id: "today-after-far-month" },
        onTopmostDateChange,
      }, renderHeader, renderGroup),
    );
    await flushRailEffects();

    expect(onTopmostDateChange).not.toHaveBeenCalledWith("2026-05-02");

    await advanceRailTime(500);

    fireEvent.scroll(rail);
    await flushRailEffects();

    expect(onTopmostDateChange).not.toHaveBeenCalledWith("2026-05-02");

    firstSection.getBoundingClientRect = () => asRect({ top: 0, bottom: 100, left: 0, right: 280, width: 280, height: 100 });
    secondSection.getBoundingClientRect = () => asRect({ top: 120, bottom: 220, left: 0, right: 280, width: 280, height: 100 });

    fireEvent.scroll(rail);
    await flushRailEffects();

    expect(onTopmostDateChange).not.toHaveBeenCalledWith("2026-05-02");

    firstSection.getBoundingClientRect = () => asRect({ top: -120, bottom: -20, left: 0, right: 280, width: 280, height: 100 });
    secondSection.getBoundingClientRect = () => asRect({ top: 4, bottom: 104, left: 0, right: 280, width: 280, height: 100 });

    fireEvent.scroll(rail);
    await flushRailEffects();

    expect(onTopmostDateChange).toHaveBeenCalledWith("2026-05-02");
  });

  it("lands distant item scrolls directly instead of forcing a long smooth animation", async () => {
    const renderGroup: AgendaRenderGroup = ({ group, registerRow }) => (
      group.dateKey === "2026-05-01" ? (
        <span
          ref={(node) => registerRow(`row-1-${group.dateKey}`, node, group.dateKey)}
          data-testid="agenda-row-target"
          data-item-id="row-1"
        >
          Row one
        </span>
      ) : null
    );
    const renderHeader: AgendaRenderHeader = ({ group, registerHeader }) => (
      <button
        type="button"
        ref={(node) => registerHeader(group.dateKey, node)}
        data-testid={`header-${group.dateKey}`}
      >
        {group.dateKey}
      </button>
    );
    const { rerender } = renderShell({ renderGroup });
    await flushRailEffects();

    const rail = screen.getByTestId("agenda-shell");
    const row = screen.getByTestId("agenda-row-target");
    const scrollTo = vi.fn();
    rail.scrollTop = 120;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => asRect({ top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 });
    row.getBoundingClientRect = () => asRect({ top: 940, bottom: 984, left: 0, right: 280, width: 280, height: 44 });

    rerender(
      wrapInContainer(GROUPS, {
        testId: "agenda-shell",
        firstVisibleDateKey: "2026-05-01",
        todayKey: "2026-05-01",
        selectedDateKey: "2026-05-01",
        scrollCommand: { type: "item", itemId: "row-1", dateKey: "2026-05-01", id: "item-1" },
      }, renderHeader, renderGroup),
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 794,
      behavior: "auto",
    }));
    expect(rail.scrollTop).toBe(794);
  });

  it("does not dirty-block passive scroll sync while an editor is open", async () => {
    const onDirtyBlocked = vi.fn();
    const onTopmostDateChange = vi.fn();
    const renderHeader: AgendaRenderHeader = ({ group, registerHeader }) => (
      <button
        type="button"
        ref={(node) => registerHeader(group.dateKey, node)}
        data-testid={`header-${group.dateKey}`}
      >
        {group.dateKey}
      </button>
    );

    render(
      wrapInContainer(GROUPS, {
        testId: "agenda-shell",
        firstVisibleDateKey: "2026-05-01",
        todayKey: "2026-05-01",
        selectedDateKey: "2026-05-02",
        floatingEditorDirty: true,
        onDirtyBlocked,
        onTopmostDateChange,
      }, renderHeader, () => null),
    );
    await flushRailEffects();
    await advanceRailTime(500);

    const rail = screen.getByTestId("agenda-shell");
    const firstHeader = screen.getByTestId("header-2026-05-01");
    const secondHeader = screen.getByTestId("header-2026-05-02");
    rail.getBoundingClientRect = () => asRect({ top: 100, bottom: 500, left: 0, right: 280, width: 280, height: 400 });
    firstHeader.getBoundingClientRect = () => asRect({ top: 96, bottom: 130, left: 0, right: 280, width: 280, height: 34 });
    secondHeader.getBoundingClientRect = () => asRect({ top: 600, bottom: 634, left: 0, right: 280, width: 280, height: 34 });

    fireEvent.scroll(rail);
    await flushRailEffects();

    expect(onDirtyBlocked).not.toHaveBeenCalled();
    expect(onTopmostDateChange).not.toHaveBeenCalled();
  });

  it("waits for the actionable agenda anchor instead of activating the registered wrapper", async () => {
    const railRef = createRef<AgendaMonthScrollHandle>();
    const onRowClick = vi.fn();
    const renderHeader: AgendaRenderHeader = ({ group, registerHeader }) => (
      <button
        type="button"
        ref={(node) => registerHeader(group.dateKey, node)}
        data-testid={`header-${group.dateKey}`}
      >
        {group.dateKey}
      </button>
    );

    function Shell({ ready = false }) {
      return wrapInContainer(GROUPS, {
        ref: railRef,
        testId: "agenda-shell",
        firstVisibleDateKey: "2026-05-01",
        todayKey: "2026-05-01",
        selectedDateKey: "2026-05-01",
      }, renderHeader, ({ group, registerRow }) => (
        group.dateKey === "2026-05-01" ? (
          <span ref={(node) => registerRow(`row-1-${group.dateKey}`, node, group.dateKey)}>
            {ready ? (
              <button
                type="button"
                data-testid="calendar-agenda-event-row"
                data-item-id="row-1"
                onClick={onRowClick}
              >
                Row one
              </button>
            ) : null}
          </span>
        ) : null
      ));
    }

    const { rerender } = render(<Shell />);
    await flushRailEffects();

    expect(railRef.current!.getItemAnchor("row-1", "2026-05-01")).toBeNull();
    expect(railRef.current!.activateItem("row-1", "2026-05-01")).toBe(false);
    expect(onRowClick).not.toHaveBeenCalled();

    rerender(<Shell ready />);
    await flushRailEffects();

    expect(railRef.current!.getItemAnchor("row-1", "2026-05-01")).toBe(screen.getByTestId("calendar-agenda-event-row"));
    expect(railRef.current!.activateItem("row-1", "2026-05-01")).toBe(true);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
