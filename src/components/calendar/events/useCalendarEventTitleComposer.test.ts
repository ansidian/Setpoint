import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
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
    const seed = defaultDraft("2026-07-14");
    const { result } = renderHook(() => {
      const [committedTitle, setCommittedTitle] = useState("");
      const composer = useCalendarEventTitleComposer({
        createSeedDraft: seed,
        draftTitle: "",
        isEditing: false,
        isEditingRecurring: false,
        recurringEditScope: null,
        touchedTitle: false,
        onInputStart: () => {},
        onCommitTitle: setCommittedTitle,
      });
      return { composer, committedTitle };
    });

    act(() => {
      result.current.composer.handleTitleInputChange("Planning");
      vi.advanceTimersByTime(119);
    });
    expect(result.current.committedTitle).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.committedTitle).toBe("Planning");
    expect(result.current.composer.titleInput).toBe("Planning");
  });

  it("flushes a pending title synchronously before save", () => {
    const seed = defaultDraft("2026-07-14");
    const { result } = renderHook(() => {
      const [committedTitle, setCommittedTitle] = useState("");
      const composer = useCalendarEventTitleComposer({
        createSeedDraft: seed,
        draftTitle: "",
        isEditing: false,
        isEditingRecurring: false,
        recurringEditScope: null,
        touchedTitle: false,
        onInputStart: () => {},
        onCommitTitle: setCommittedTitle,
      });
      return { composer, committedTitle };
    });

    act(() => {
      result.current.composer.handleTitleInputChange("Planning");
    });

    let flushed;
    act(() => {
      flushed = result.current.composer.flushPendingTitle();
    });

    expect(flushed).toBe(true);
    expect(result.current.committedTitle).toBe("Planning");
    expect(result.current.composer.titleInput).toBe("Planning");
  });
});
