import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import type { ReactNode, Ref } from "react";
import AgendaMonthScrollContainer from "./AgendaMonthScrollContainer.tsx";
import AgendaRailShell from "./AgendaRailShell.tsx";
import type {
  AgendaMonthScrollContainerProps,
  AgendaMonthScrollHandle,
} from "./AgendaMonthScrollContainer";
import type { AgendaRailGroup, AgendaRailShellProps } from "./AgendaRailShell";

type TestGroup = AgendaRailGroup;
type AgendaRenderHeader = NonNullable<AgendaRailShellProps<TestGroup>["renderHeader"]>;
type AgendaRenderGroup = NonNullable<AgendaRailShellProps<TestGroup>["renderGroup"]>;
type ContainerTestProps = Omit<AgendaMonthScrollContainerProps, "months" | "renderMonth"> & {
  firstVisibleDateKey?: string;
  ref?: Ref<AgendaMonthScrollHandle>;
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

    // test-architecture: allow-boundary-interaction -- Cold-entry readiness must suppress the native scroll command until content is measurable; happy-dom has no resulting layout state for a forbidden scroll.
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

    // test-architecture: allow-boundary-interaction -- Entry anchoring is an imperative browser scroll contract whose requested top and behavior are not reflected in happy-dom layout.
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      behavior: "auto",
    }));

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

    // test-architecture: allow-boundary-interaction -- A replacement entry command must issue the latest native scroll target; happy-dom does not apply or expose the requested browser scroll options.
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({
      behavior: "auto",
    }));
    // test-architecture: allow-boundary-interaction -- Native scrollTo is a browser-imperative boundary; duplicate entry commands are not reflected in happy-dom geometry.
    const entryScrollCalls = scrollTo.mock.calls.length;

    await advanceRailTime(760);

    // test-architecture: allow-boundary-interaction -- Passive synchronization must not replay the native entry scroll command; resulting happy-dom geometry cannot reveal duplicate imperative scrolls.
    expect(scrollTo).toHaveBeenCalledTimes(entryScrollCalls);

    firstHeader.getBoundingClientRect = () => asRect({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    secondHeader.getBoundingClientRect = () => asRect({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    firstSection.getBoundingClientRect = () => asRect({ top: -480, bottom: 0, left: 0, right: 280, width: 280, height: 480 });
    secondSection.getBoundingClientRect = () => asRect({ top: 0, bottom: 360, left: 0, right: 280, width: 280, height: 360 });

    fireEvent.scroll(rail);
    await flushRailEffects();

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
    // test-architecture: allow-boundary-interaction -- Agenda navigation must issue the exact native auto-scroll target; happy-dom has no browser scroll result from which to recover the requested command.
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      behavior: "auto",
    }));
    scrollTo.mockClear();

    expect(railRef.current!.scrollToItem("event-15", "2026-05-15", "grid-chip-click")).toBe(true);
    // test-architecture: allow-boundary-interaction -- User navigation must issue the exact native smooth-scroll target; happy-dom cannot reflect requested scroll behavior in layout state.
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
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

    // test-architecture: allow-boundary-interaction -- Reissuing the same navigation command must not duplicate the native browser scroll; DOM state cannot reveal a second imperative command.
    expect(scrollTo).toHaveBeenCalledTimes(1);
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


    await advanceRailTime(500);

    fireEvent.scroll(rail);
    await flushRailEffects();


    firstSection.getBoundingClientRect = () => asRect({ top: 0, bottom: 100, left: 0, right: 280, width: 280, height: 100 });
    secondSection.getBoundingClientRect = () => asRect({ top: 120, bottom: 220, left: 0, right: 280, width: 280, height: 100 });

    fireEvent.scroll(rail);
    await flushRailEffects();


    firstSection.getBoundingClientRect = () => asRect({ top: -120, bottom: -20, left: 0, right: 280, width: 280, height: 100 });
    secondSection.getBoundingClientRect = () => asRect({ top: 4, bottom: 104, left: 0, right: 280, width: 280, height: 100 });

    fireEvent.scroll(rail);
    await flushRailEffects();

  });

  it("blocks passive date sync while a dirty editor is open", async () => {
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

    rerender(<Shell ready />);
    await flushRailEffects();

    expect(railRef.current!.getItemAnchor("row-1", "2026-05-01")).toBe(screen.getByTestId("calendar-agenda-event-row"));
    expect(railRef.current!.activateItem("row-1", "2026-05-01")).toBe(true);
  });
});
