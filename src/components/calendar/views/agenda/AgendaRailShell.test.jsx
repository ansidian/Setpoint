import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("does not restart the today scroll when the first content is already visible", async () => {
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

    expect(scrollTo).not.toHaveBeenCalled();
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
});
