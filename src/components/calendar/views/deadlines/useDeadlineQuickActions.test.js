import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/api", () => ({
  deleteDeadline: vi.fn(),
}));

const { default: useDeadlineQuickActions } = await import("./useDeadlineQuickActions");

describe("useDeadlineQuickActions identity stability", () => {
  function makeProps() {
    return {
      enabled: true,
      actions: {
        onCompleteTask: vi.fn(),
        onDeleteTask: vi.fn(),
      },
      onEditTask: vi.fn(),
      onDeleted: vi.fn(),
    };
  }

  it("returns the same actions object when the parent re-renders with fresh callback props", () => {
    const { result, rerender } = renderHook((props) => useDeadlineQuickActions(props), {
      initialProps: makeProps(),
    });
    const first = result.current;

    rerender(makeProps());

    expect(result.current).toBe(first);
  });
});
