import { describe, expect, it } from "vitest";
import buildCalendarModalShellProps from "./buildCalendarModalShellProps";
import type { BuildCalendarModalShellPropsInput } from "./buildCalendarModalShellProps";

function minimalInput(overrides: Record<string, unknown> = {}): BuildCalendarModalShellPropsInput {
  return {
    refs: {},
    viewState: {},
    data: { activeView: {} },
    viewModel: { computed: {} },
    selection: {},
    editors: {},
    quickActions: {},
    agenda: {},
    floating: {},
    handlers: {},
    search: {},
    availableCalendarViews: ["events"],
    ...overrides,
  } as unknown as BuildCalendarModalShellPropsInput;
}

describe("buildCalendarModalShellProps", () => {
  // Regression guard for the mobile jump-to-today wiring: the adapter rebuilds the
  // handlers object, so it must explicitly re-export navigateToToday or the mobile
  // agenda's re-tap / "Today" pill silently no-ops (it reads handlers.navigateToToday).
  it("threads navigateToToday through to the shell handlers", () => {
    const navigateToToday = () => {};
    const props = buildCalendarModalShellProps(minimalInput({ handlers: { navigateToToday } }));
    expect(props.handlers.navigateToToday).toBe(navigateToToday);
  });

  it("still exposes the existing month/view handlers", () => {
    const navigateMonth = () => {};
    const handleViewChange = () => {};
    const props = buildCalendarModalShellProps(
      minimalInput({ handlers: { navigateMonth, handleViewChange } }),
    );
    expect(props.handlers.navigateMonth).toBe(navigateMonth);
    expect(props.handlers.onViewChange).toBe(handleViewChange);
  });
});
