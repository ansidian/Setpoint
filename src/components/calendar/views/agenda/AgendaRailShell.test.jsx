import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import AgendaRailShell from "./AgendaRailShell.jsx";

afterEach(() => {
  cleanup();
});

const GROUPS = [
  { dateKey: "2026-05-01" },
  { dateKey: "2026-05-02" },
];

async function flushRailEffects() {
  await act(async () => {
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function renderShell({ scrollCommand = null, renderGroup }) {
  return render(
    <AgendaRailShell
      testId="agenda-shell"
      groups={GROUPS}
      firstVisibleDateKey="2026-05-01"
      todayKey="2026-05-01"
      selectedDateKey="2026-05-01"
      scrollCommand={scrollCommand}
      renderHeader={({ group, registerHeader }) => (
        <button
          type="button"
          ref={(node) => registerHeader(group.dateKey, node)}
          data-testid={`header-${group.dateKey}`}
        >
          {group.dateKey}
        </button>
      )}
      renderGroup={renderGroup}
    />,
  );
}

describe("AgendaRailShell", () => {
  it("waits for cold-entry readiness and lands on the captured entry date", async () => {
    const onPassiveDateChange = vi.fn();
    const { rerender } = render(
      <AgendaRailShell
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-02"
        selectedDateKey="2026-05-02"
        entryScrollTargetDateKey="2026-05-02"
        entryScrollReady={false}
        onPassiveDateChange={onPassiveDateChange}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={() => null}
      />,
    );

    const rail = screen.getByTestId("agenda-shell");
    const firstHeader = screen.getByTestId("header-2026-05-01");
    const secondHeader = screen.getByTestId("header-2026-05-02");
    const firstSection = rail.querySelector("section[data-date-key='2026-05-01']");
    const secondSection = rail.querySelector("section[data-date-key='2026-05-02']");
    const scrollTo = vi.fn();
    rail.scrollTop = 0;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 });
    firstHeader.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    secondHeader.getBoundingClientRect = () => ({ top: 360, bottom: 394, left: 0, right: 280, width: 280, height: 34 });
    firstSection.getBoundingClientRect = () => ({ top: 0, bottom: 360, left: 0, right: 280, width: 280, height: 360 });
    secondSection.getBoundingClientRect = () => ({ top: 360, bottom: 720, left: 0, right: 280, width: 280, height: 360 });

    await flushRailEffects();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(rail.scrollTop).toBe(0);

    firstHeader.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    secondHeader.getBoundingClientRect = () => ({ top: 480, bottom: 514, left: 0, right: 280, width: 280, height: 34 });
    firstSection.getBoundingClientRect = () => ({ top: 0, bottom: 480, left: 0, right: 280, width: 280, height: 480 });
    secondSection.getBoundingClientRect = () => ({ top: 480, bottom: 840, left: 0, right: 280, width: 280, height: 360 });

    rerender(
      <AgendaRailShell
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-02"
        selectedDateKey="2026-05-01"
        entryScrollTargetDateKey="2026-05-02"
        entryScrollReady
        onPassiveDateChange={onPassiveDateChange}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={() => null}
      />,
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 480,
      behavior: "auto",
    }));
    expect(rail.scrollTop).toBe(480);

    secondHeader.getBoundingClientRect = () => ({ top: 140, bottom: 174, left: 0, right: 280, width: 280, height: 34 });
    rerender(
      <AgendaRailShell
        testId="agenda-shell"
        groups={GROUPS.map((group) => ({ ...group }))}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-02"
        selectedDateKey="2026-05-01"
        entryScrollTargetDateKey="2026-05-02"
        entryScrollReady
        onPassiveDateChange={onPassiveDateChange}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={() => null}
      />,
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({
      top: 620,
      behavior: "auto",
    }));
    expect(rail.scrollTop).toBe(620);
    const entryScrollCalls = scrollTo.mock.calls.length;

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 760));
    });

    expect(scrollTo).toHaveBeenCalledTimes(entryScrollCalls);

    firstHeader.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    secondHeader.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    firstSection.getBoundingClientRect = () => ({ top: -480, bottom: 0, left: 0, right: 280, width: 280, height: 480 });
    secondSection.getBoundingClientRect = () => ({ top: 0, bottom: 360, left: 0, right: 280, width: 280, height: 360 });

    fireEvent.scroll(rail);
    await flushRailEffects();

    expect(onPassiveDateChange).toHaveBeenCalled();
    expect(onPassiveDateChange.mock.calls.every(([dateKey]) => dateKey === "2026-05-02")).toBe(true);
  });

  it("does not passive-select the month start while waiting for the entry target to mount", async () => {
    const onPassiveDateChange = vi.fn();

    render(
      <AgendaRailShell
        testId="agenda-shell"
        groups={[{ dateKey: "2026-05-01" }]}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-07"
        selectedDateKey="2026-05-07"
        entryScrollTargetDateKey="2026-05-07"
        entryScrollReady
        onPassiveDateChange={onPassiveDateChange}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={() => null}
      />,
    );

    const rail = screen.getByTestId("agenda-shell");
    const firstHeader = screen.getByTestId("header-2026-05-01");
    rail.scrollTop = 0;
    rail.scrollTo = vi.fn();
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 });
    firstHeader.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });

    await flushRailEffects();

    expect(onPassiveDateChange).not.toHaveBeenCalled();
  });

  it("does not repeat the same entry passive correction across hydration rerenders", async () => {
    const onPassiveDateChange = vi.fn();
    const renderHeader = ({ group, registerHeader }) => (
      <button
        type="button"
        ref={(node) => registerHeader(group.dateKey, node)}
        data-testid={`header-${group.dateKey}`}
      >
        {group.dateKey}
      </button>
    );

    const { rerender } = render(
      <AgendaRailShell
        testId="agenda-shell"
        groups={[
          { dateKey: "2026-05-01" },
          { dateKey: "2026-05-07" },
        ]}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-07"
        selectedDateKey="2026-05-01"
        entryScrollTargetDateKey="2026-05-07"
        entryScrollReady
        onPassiveDateChange={onPassiveDateChange}
        renderHeader={renderHeader}
        renderGroup={() => null}
      />,
    );

    const rail = screen.getByTestId("agenda-shell");
    const firstHeader = screen.getByTestId("header-2026-05-01");
    const todayHeader = screen.getByTestId("header-2026-05-07");
    rail.scrollTop = 0;
    rail.scrollTo = vi.fn();
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 });
    firstHeader.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    todayHeader.getBoundingClientRect = () => ({ top: 480, bottom: 514, left: 0, right: 280, width: 280, height: 34 });

    await flushRailEffects();

    expect(onPassiveDateChange).toHaveBeenCalledTimes(1);
    expect(onPassiveDateChange).toHaveBeenCalledWith("2026-05-07");

    rerender(
      <AgendaRailShell
        testId="agenda-shell"
        groups={[
          { dateKey: "2026-05-01" },
          { dateKey: "2026-05-07" },
        ]}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-07"
        selectedDateKey="2026-05-01"
        entryScrollTargetDateKey="2026-05-07"
        entryScrollReady
        onPassiveDateChange={onPassiveDateChange}
        renderHeader={renderHeader}
        renderGroup={() => null}
      />,
    );
    await flushRailEffects();

    expect(onPassiveDateChange).toHaveBeenCalledTimes(1);
  });

  it("does not replay cold-entry anchoring after an imperative item scroll", async () => {
    const railRef = createRef();
    const renderHeader = ({ group, registerHeader }) => (
      <button
        type="button"
        ref={(node) => registerHeader(group.dateKey, node)}
        data-testid={`header-${group.dateKey}`}
      >
        {group.dateKey}
      </button>
    );
    const renderGroup = ({ group, registerRow }) => (
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

    const { rerender } = render(
      <AgendaRailShell
        ref={railRef}
        testId="agenda-shell"
        groups={[
          { dateKey: "2026-05-01" },
          { dateKey: "2026-05-14" },
          { dateKey: "2026-05-15" },
        ]}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-14"
        selectedDateKey="2026-05-14"
        entryScrollTargetDateKey="2026-05-14"
        entryScrollReady
        renderHeader={renderHeader}
        renderGroup={renderGroup}
      />,
    );

    const rail = screen.getByTestId("agenda-shell");
    const may14Header = screen.getByTestId("header-2026-05-14");
    const row = screen.getByTestId("far-agenda-row");
    const scrollTo = vi.fn();
    rail.scrollTop = 0;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 });
    may14Header.getBoundingClientRect = () => ({ top: 360, bottom: 394, left: 0, right: 280, width: 280, height: 34 });
    row.getBoundingClientRect = () => ({ top: 760, bottom: 804, left: 0, right: 280, width: 280, height: 44 });

    await flushRailEffects();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 360,
      behavior: "auto",
    }));
    scrollTo.mockClear();

    expect(railRef.current.scrollToItem("event-15", "2026-05-15", "grid-chip-click")).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 854,
      behavior: "smooth",
    }));

    may14Header.getBoundingClientRect = () => ({ top: 40, bottom: 74, left: 0, right: 280, width: 280, height: 34 });
    row.getBoundingClientRect = () => ({ top: 44, bottom: 88, left: 0, right: 280, width: 280, height: 44 });
    rerender(
      <AgendaRailShell
        ref={railRef}
        testId="agenda-shell"
        groups={[
          { dateKey: "2026-05-01" },
          { dateKey: "2026-05-14" },
          { dateKey: "2026-05-15" },
        ].map((group) => ({ ...group }))}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-14"
        selectedDateKey="2026-05-15"
        entryScrollTargetDateKey="2026-05-14"
        entryScrollReady
        renderHeader={renderHeader}
        renderGroup={renderGroup}
      />,
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("scrolls today's first row below the sticky date header", async () => {
    const renderGroup = ({ group, registerRow }) => (
      group.dateKey === "2026-05-01" ? (
        <span
          ref={(node) => registerRow(`first-${group.dateKey}`, node, group.dateKey)}
          data-testid="today-first-row"
        >
          First row
        </span>
      ) : null
    );
    const { rerender } = renderShell({ renderGroup });
    await flushRailEffects();

    const rail = screen.getByTestId("agenda-shell");
    const row = screen.getByTestId("today-first-row");
    const scrollTo = vi.fn();
    rail.scrollTop = 120;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    row.getBoundingClientRect = () => ({ top: 20, bottom: 64, left: 0, right: 280, width: 280, height: 44 });

    rerender(
      <AgendaRailShell
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        scrollCommand={{ type: "today", id: "today-1" }}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={renderGroup}
      />,
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 96,
      behavior: "smooth",
    }));
  });

  it("recenters today's first content under the sticky date header", async () => {
    const renderGroup = ({ group, registerContent }) => (
      group.dateKey === "2026-05-01" ? (
        <span
          ref={(node) => registerContent(group.dateKey, node)}
          data-testid="today-empty-content"
        >
          No items
        </span>
      ) : null
    );
    const { rerender } = renderShell({ renderGroup });
    await flushRailEffects();

    const rail = screen.getByTestId("agenda-shell");
    const content = screen.getByTestId("today-empty-content");
    const scrollTo = vi.fn();
    rail.scrollTop = 96;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    content.getBoundingClientRect = () => ({ top: 52, bottom: 88, left: 0, right: 280, width: 280, height: 36 });

    rerender(
      <AgendaRailShell
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        scrollCommand={{ type: "today", id: "today-2" }}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={renderGroup}
      />,
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 104,
      behavior: "smooth",
    }));
  });

  it("scrolls back to today's first content when the sticky header is already pinned", async () => {
    const renderGroup = ({ group, registerRow }) => (
      group.dateKey === "2026-05-01" ? (
        <span
          ref={(node) => registerRow(`first-${group.dateKey}`, node, group.dateKey)}
          data-testid="today-first-row"
        >
          First row
        </span>
      ) : null
    );
    const { rerender } = renderShell({ renderGroup });
    await flushRailEffects();

    const rail = screen.getByTestId("agenda-shell");
    const row = screen.getByTestId("today-first-row");
    const scrollTo = vi.fn();
    rail.scrollTop = 700;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    row.getBoundingClientRect = () => ({ top: -72, bottom: -28, left: 0, right: 280, width: 280, height: 44 });

    rerender(
      <AgendaRailShell
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        scrollCommand={{ type: "today", id: "today-3" }}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={renderGroup}
      />,
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 584,
      behavior: "smooth",
    }));
  });

  it("keeps passive scroll from overriding a new today command until today lands", async () => {
    const onPassiveDateChange = vi.fn();
    const { rerender } = render(
      <AgendaRailShell
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        onPassiveDateChange={onPassiveDateChange}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={() => null}
      />,
    );
    await flushRailEffects();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    });

    const rail = screen.getByTestId("agenda-shell");
    const firstSection = rail.querySelector("section[data-date-key='2026-05-01']");
    const secondSection = rail.querySelector("section[data-date-key='2026-05-02']");
    const scrollTo = vi.fn();
    rail.scrollTop = 320;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    firstSection.getBoundingClientRect = () => ({ top: -120, bottom: -20, left: 0, right: 280, width: 280, height: 100 });
    secondSection.getBoundingClientRect = () => ({ top: 4, bottom: 104, left: 0, right: 280, width: 280, height: 100 });

    fireEvent.scroll(rail);

    rerender(
      <AgendaRailShell
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        scrollCommand={{ type: "today", id: "today-after-far-month" }}
        onPassiveDateChange={onPassiveDateChange}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={() => null}
      />,
    );
    await flushRailEffects();

    expect(onPassiveDateChange).not.toHaveBeenCalledWith("2026-05-02");

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    });

    fireEvent.scroll(rail);
    await flushRailEffects();

    expect(onPassiveDateChange).not.toHaveBeenCalledWith("2026-05-02");

    firstSection.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 280, width: 280, height: 100 });
    secondSection.getBoundingClientRect = () => ({ top: 120, bottom: 220, left: 0, right: 280, width: 280, height: 100 });

    fireEvent.scroll(rail);
    await flushRailEffects();

    expect(onPassiveDateChange).not.toHaveBeenCalledWith("2026-05-02");

    firstSection.getBoundingClientRect = () => ({ top: -120, bottom: -20, left: 0, right: 280, width: 280, height: 100 });
    secondSection.getBoundingClientRect = () => ({ top: 4, bottom: 104, left: 0, right: 280, width: 280, height: 100 });

    fireEvent.scroll(rail);
    await flushRailEffects();

    expect(onPassiveDateChange).toHaveBeenCalledWith("2026-05-02");
  });

  it("lands distant item scrolls directly instead of forcing a long smooth animation", async () => {
    const renderGroup = ({ group, registerRow }) => (
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
    const { rerender } = renderShell({ renderGroup });
    await flushRailEffects();

    const rail = screen.getByTestId("agenda-shell");
    const row = screen.getByTestId("agenda-row-target");
    const scrollTo = vi.fn();
    rail.scrollTop = 120;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 });
    row.getBoundingClientRect = () => ({ top: 940, bottom: 984, left: 0, right: 280, width: 280, height: 44 });

    rerender(
      <AgendaRailShell
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        scrollCommand={{ type: "item", itemId: "row-1", dateKey: "2026-05-01", id: "item-1" }}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={renderGroup}
      />,
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 794,
      behavior: "auto",
    }));
    expect(rail.scrollTop).toBe(794);
  });

  it("does not replay a command already handled through the imperative rail ref", async () => {
    const railRef = createRef();
    const renderGroup = ({ group, registerRow }) => (
      group.dateKey === "2026-05-01" ? (
        <span
          ref={(node) => registerRow(`first-${group.dateKey}`, node, group.dateKey)}
          data-testid="today-first-row"
        >
          First row
        </span>
      ) : null
    );

    const { rerender } = render(
      <AgendaRailShell
        ref={railRef}
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={renderGroup}
      />,
    );
    await flushRailEffects();

    const rail = screen.getByTestId("agenda-shell");
    const row = screen.getByTestId("today-first-row");
    const scrollTo = vi.fn();
    rail.scrollTop = 0;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    row.getBoundingClientRect = () => ({ top: 420, bottom: 464, left: 0, right: 280, width: 280, height: 44 });

    expect(railRef.current.scrollToToday("today-command")).toBe(true);

    rerender(
      <AgendaRailShell
        ref={railRef}
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        scrollCommand={{ type: "today", id: "today-command" }}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={renderGroup}
      />,
    );
    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: expect.any(Number),
    }));
  });

  it("does not dirty-block passive scroll sync while an editor is open", async () => {
    const onDirtyBlocked = vi.fn();
    const onPassiveDateChange = vi.fn();

    render(
      <AgendaRailShell
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-02"
        floatingEditorDirty
        onDirtyBlocked={onDirtyBlocked}
        onPassiveDateChange={onPassiveDateChange}
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={() => null}
      />,
    );
    await flushRailEffects();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    });

    const rail = screen.getByTestId("agenda-shell");
    const firstHeader = screen.getByTestId("header-2026-05-01");
    const secondHeader = screen.getByTestId("header-2026-05-02");
    rail.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 280, width: 280, height: 400 });
    firstHeader.getBoundingClientRect = () => ({ top: 96, bottom: 130, left: 0, right: 280, width: 280, height: 34 });
    secondHeader.getBoundingClientRect = () => ({ top: 600, bottom: 634, left: 0, right: 280, width: 280, height: 34 });

    fireEvent.scroll(rail);
    await flushRailEffects();

    expect(onDirtyBlocked).not.toHaveBeenCalled();
    expect(onPassiveDateChange).not.toHaveBeenCalled();
  });

  it("activates a mounted agenda row without scrolling", async () => {
    const railRef = createRef();
    const onRowClick = vi.fn();

    render(
      <AgendaRailShell
        ref={railRef}
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={({ group, registerRow }) => (
          group.dateKey === "2026-05-01" ? (
            <span ref={(node) => registerRow(`row-1-${group.dateKey}`, node, group.dateKey)}>
              <button
                type="button"
                data-testid="calendar-agenda-deadline-row"
                data-item-id="row-1"
                onClick={onRowClick}
              >
                Row one
              </button>
            </span>
          ) : null
        )}
      />,
    );
    await flushRailEffects();

    const rail = screen.getByTestId("agenda-shell");
    rail.scrollTo = vi.fn();

    expect(railRef.current.activateItem("row-1", "2026-05-01")).toBe(true);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(rail.scrollTo).not.toHaveBeenCalled();
  });

  it("activates rows registered with stable deadline occurrence ids", async () => {
    const railRef = createRef();
    const onRowClick = vi.fn();
    render(
      <AgendaRailShell
        ref={railRef}
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={({ group, registerRow }) => (
          group.dateKey === "2026-05-01" ? (
            <span ref={(node) => registerRow("deadline:row-1:2026-05-01", node, group.dateKey)}>
              <button
                type="button"
                data-testid="calendar-agenda-deadline-row"
                data-item-id="deadline:row-1:2026-05-01"
                onClick={onRowClick}
              >
                Row one
              </button>
            </span>
          ) : null
        )}
      />,
    );
    await flushRailEffects();

    expect(railRef.current.activateItem("deadline:row-1:2026-05-01", "2026-05-01")).toBe(true);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("does not replay entry scroll after an agenda row selection changes the selected date", async () => {
    const railRef = createRef();
    const onRowClick = vi.fn();
    const renderGroup = ({ group, registerRow }) => (
      group.dateKey === "2026-05-02" ? (
        <span ref={(node) => registerRow(`row-1-${group.dateKey}`, node, group.dateKey)}>
          <button
            type="button"
            data-testid="calendar-agenda-deadline-row"
            data-item-id="row-1"
            onClick={onRowClick}
          >
            Row one
          </button>
        </span>
      ) : null
    );

    const { rerender } = render(
      <AgendaRailShell
        ref={railRef}
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        entryScrollTargetDateKey="2026-05-01"
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={renderGroup}
      />,
    );
    await flushRailEffects();

    const rail = screen.getByTestId("agenda-shell");
    const firstHeader = screen.getByTestId("header-2026-05-01");
    const secondHeader = screen.getByTestId("header-2026-05-02");
    const row = screen.getByTestId("calendar-agenda-deadline-row");
    const scrollTo = vi.fn();
    rail.scrollTop = 0;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    firstHeader.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    secondHeader.getBoundingClientRect = () => ({ top: 420, bottom: 454, left: 0, right: 280, width: 280, height: 34 });

    fireEvent.pointerDown(row);
    expect(railRef.current.activateItem("row-1", "2026-05-02")).toBe(true);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    scrollTo.mockClear();

    rerender(
      <AgendaRailShell
        ref={railRef}
        testId="agenda-shell"
        groups={GROUPS.map((group) => ({ ...group }))}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-02"
        entryScrollTargetDateKey="2026-05-01"
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={renderGroup}
      />,
    );
    await flushRailEffects();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("returns false when activating an agenda row that has not mounted", async () => {
    const railRef = createRef();

    render(
      <AgendaRailShell
        ref={railRef}
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-01"
        selectedDateKey="2026-05-01"
        renderHeader={({ group, registerHeader }) => (
          <button
            type="button"
            ref={(node) => registerHeader(group.dateKey, node)}
            data-testid={`header-${group.dateKey}`}
          >
            {group.dateKey}
          </button>
        )}
        renderGroup={() => null}
      />,
    );
    await flushRailEffects();

    const rail = screen.getByTestId("agenda-shell");
    rail.scrollTo = vi.fn();

    expect(railRef.current.activateItem("missing", "2026-05-01")).toBe(false);
    expect(rail.scrollTo).not.toHaveBeenCalled();
  });

  it("waits for the actionable agenda anchor instead of activating the registered wrapper", async () => {
    const railRef = createRef();
    const onRowClick = vi.fn();

    function Shell({ ready = false }) {
      return (
        <AgendaRailShell
          ref={railRef}
          testId="agenda-shell"
          groups={GROUPS}
          firstVisibleDateKey="2026-05-01"
          todayKey="2026-05-01"
          selectedDateKey="2026-05-01"
          renderHeader={({ group, registerHeader }) => (
            <button
              type="button"
              ref={(node) => registerHeader(group.dateKey, node)}
              data-testid={`header-${group.dateKey}`}
            >
              {group.dateKey}
            </button>
          )}
          renderGroup={({ group, registerRow }) => (
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
          )}
        />
      );
    }

    const { rerender } = render(<Shell />);
    await flushRailEffects();

    expect(railRef.current.getItemAnchor("row-1", "2026-05-01")).toBeNull();
    expect(railRef.current.activateItem("row-1", "2026-05-01")).toBe(false);
    expect(onRowClick).not.toHaveBeenCalled();

    rerender(<Shell ready />);
    await flushRailEffects();

    expect(railRef.current.getItemAnchor("row-1", "2026-05-01")).toBe(screen.getByTestId("calendar-agenda-event-row"));
    expect(railRef.current.activateItem("row-1", "2026-05-01")).toBe(true);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
