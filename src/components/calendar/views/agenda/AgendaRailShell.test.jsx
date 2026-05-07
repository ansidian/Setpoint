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
  it("lands cold entry directly on the selected date header", async () => {
    render(
      <AgendaRailShell
        testId="agenda-shell"
        groups={GROUPS}
        firstVisibleDateKey="2026-05-01"
        todayKey="2026-05-02"
        selectedDateKey="2026-05-02"
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
    const secondHeader = screen.getByTestId("header-2026-05-02");
    const scrollTo = vi.fn();
    rail.scrollTop = 0;
    rail.scrollTo = scrollTo;
    rail.getBoundingClientRect = () => ({ top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 });
    secondHeader.getBoundingClientRect = () => ({ top: 360, bottom: 394, left: 0, right: 280, width: 280, height: 34 });

    await flushRailEffects();

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      top: 360,
      behavior: "auto",
    }));
    expect(rail.scrollTop).toBe(360);
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

  it("does not force scrollTop after requesting smooth item scroll", async () => {
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
      behavior: "smooth",
    }));
    expect(rail.scrollTop).toBe(120);
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
});
