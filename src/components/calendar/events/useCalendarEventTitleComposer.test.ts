import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDraft } from "./calendarEventEditorModel";
import useCalendarEventTitleComposer from "./useCalendarEventTitleComposer";

describe("useCalendarEventTitleComposer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits the latest title after the debounce window", () => {
    const onCommitTitle = vi.fn();
    const seed = defaultDraft("2026-07-14");
    const { result } = renderHook(() => useCalendarEventTitleComposer({
      createSeedDraft: seed,
      draftTitle: "",
      isEditing: false,
      isEditingRecurring: false,
      recurringEditScope: null,
      touchedTitle: false,
      onInputStart: vi.fn(),
      onCommitTitle,
    }));

    act(() => {
      result.current.handleTitleInputChange("Planning");
      vi.advanceTimersByTime(119);
    });
    expect(onCommitTitle).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onCommitTitle).toHaveBeenCalledWith("Planning");
    expect(result.current.titleInput).toBe("Planning");
  });

  it("flushes a pending title synchronously before save", () => {
    const onCommitTitle = vi.fn();
    const seed = defaultDraft("2026-07-14");
    const { result } = renderHook(() => useCalendarEventTitleComposer({
      createSeedDraft: seed,
      draftTitle: "",
      isEditing: false,
      isEditingRecurring: false,
      recurringEditScope: null,
      touchedTitle: false,
      onInputStart: vi.fn(),
      onCommitTitle,
    }));

    act(() => {
      result.current.handleTitleInputChange("Planning");
    });

    let flushed;
    act(() => {
      flushed = result.current.flushPendingTitle();
    });

    expect(flushed).toBe(true);
    expect(onCommitTitle).toHaveBeenCalledWith("Planning");
    expect(result.current.titleInput).toBe("Planning");
  });
});
