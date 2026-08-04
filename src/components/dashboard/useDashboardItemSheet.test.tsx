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

  it("opens bill and event sheets when item data is present", () => {
    const openCalendar = vi.fn();
    const { result } = renderHook(() => useDashboardItemSheet({
      tab: "dashboard",
      openCalendar,
    }));
    const bill = { id: "bill-1", name: "Electric" };

    act(() => result.current.openBill("2026-07-15", "bill-1", bill, null));
    expect(result.current.itemSheet).toMatchObject({ kind: "bill", item: bill });

    const event = { id: "event-1", title: "Roadmap sync" };
    act(() => result.current.openEvent("2026-07-16", "event-1", event));
    expect(result.current.itemSheet).toMatchObject({ kind: "event", item: event });
  });
});
