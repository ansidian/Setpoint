import { describe, expect, it, vi } from "vitest";
import {
  DEADLINE_OVERLAY_STORAGE_KEY,
  dashboardDetailFocusRequest,
  initialDeadlineEditorState,
  normalizeCalendarWorkspaceView,
  readStoredBoolean,
  shouldForceDeadlineOverlay,
  writeStoredBoolean,
} from "./calendarModalInteractionModel.js";

describe("calendar modal interaction model", () => {
  it("limits top-level calendar workspaces to Events and Bills", () => {
    expect(normalizeCalendarWorkspaceView("events")).toBe("events");
    expect(normalizeCalendarWorkspaceView("bills")).toBe("bills");
    expect(normalizeCalendarWorkspaceView("legacy")).toBe("events");
    expect(normalizeCalendarWorkspaceView("todoist")).toBe("events");
    expect(normalizeCalendarWorkspaceView(null)).toBe("events");
  });

  it("normalizes persisted overlay visibility without needing the modal DOM", () => {
    const storage = new Map();
    const adapter = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    };

    expect(readStoredBoolean(adapter, DEADLINE_OVERLAY_STORAGE_KEY, true)).toBe(true);
    writeStoredBoolean(adapter, DEADLINE_OVERLAY_STORAGE_KEY, false);
    expect(readStoredBoolean(adapter, DEADLINE_OVERLAY_STORAGE_KEY, true)).toBe(false);
    writeStoredBoolean(adapter, DEADLINE_OVERLAY_STORAGE_KEY, true);
    expect(readStoredBoolean(adapter, DEADLINE_OVERLAY_STORAGE_KEY, false)).toBe(true);
  });

  it("keeps storage failures as preference fallbacks", () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(() => { throw new Error("blocked"); }),
    };

    expect(readStoredBoolean(storage, DEADLINE_OVERLAY_STORAGE_KEY, true)).toBe(true);
    expect(() => writeStoredBoolean(storage, DEADLINE_OVERLAY_STORAGE_KEY, false)).not.toThrow();
  });

  it("resolves initial deadline-create focus requests", () => {
    expect(initialDeadlineEditorState({
      open: true,
      view: "events",
      focusItemId: "new",
      forceDeadlineOverlay: true,
      todayDateKey: "2026-05-07",
    })).toEqual({ mode: "create", seedDate: "2026-05-07" });

    expect(initialDeadlineEditorState({
      open: true,
      view: "events",
      focusItemId: "new",
      forceDeadlineOverlay: false,
      todayDateKey: "2026-05-07",
    })).toBeNull();
  });

  it("keys dashboard detail focus requests so they are one-shot", () => {
    expect(dashboardDetailFocusRequest({
      open: true,
      focusOpenDetail: true,
      focusItemId: "todo-1",
      focusDate: "2026-05-08",
      openRequestId: 3,
      usesFloatingEditor: true,
      view: "events",
      forceDeadlineOverlay: true,
    })).toEqual({
      openRequestId: 3,
      view: "events",
      detailKind: "deadline",
      dateKey: "2026-05-08",
      itemId: "todo-1",
      requestKey: "3:events:deadline:2026-05-08:todo-1",
      attempts: 0,
    });

    expect(dashboardDetailFocusRequest({
      open: true,
      focusOpenDetail: true,
      focusItemId: "new",
      focusDate: "2026-05-08",
      openRequestId: 3,
      usesFloatingEditor: true,
      view: "events",
    })).toBeNull();
  });

  it("does not export floatingWorkspaceNavigationEffect (parking is rAF-driven)", async () => {
    const exports = await import("./calendarModalInteractionModel.js");
    expect(exports).not.toHaveProperty("floatingWorkspaceNavigationEffect");
  });

  it("forces the deadline overlay only for open Events requests", () => {
    expect(shouldForceDeadlineOverlay({ open: true, view: "events", forceDeadlineOverlay: true })).toBe(true);
    expect(shouldForceDeadlineOverlay({ open: true, view: "bills", forceDeadlineOverlay: true })).toBe(false);
    expect(shouldForceDeadlineOverlay({ open: false, view: "events", forceDeadlineOverlay: true })).toBe(false);
  });
});
