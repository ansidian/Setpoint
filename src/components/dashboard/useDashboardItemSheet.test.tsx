import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useDashboardItemSheet from "./useDashboardItemSheet";
import type { DashboardTab } from "./dashboardShellModel";

describe("useDashboardItemSheet", () => {
  it("owns selection and closes the dashboard sheet when its tab is left", () => {
    const openCalendar = vi.fn();
    const { result, rerender } = renderHook(
      ({ tab }) => useDashboardItemSheet({ tab: tab as DashboardTab, openCalendar }),
      { initialProps: { tab: "dashboard" } },
    );
    const task = { id: "task-1", title: "File report" };

    act(() => result.current.openDeadline(task, { id: "anchor" }));
    expect(result.current.itemSheet).toMatchObject({
      kind: "deadline",
      item: task,
      anchorRef: { current: { id: "anchor" } },
    });

    rerender({ tab: "calendar" });
    expect(result.current.itemSheet).toBeNull();
  });

});
