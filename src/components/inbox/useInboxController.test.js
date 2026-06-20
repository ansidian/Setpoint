import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/email/useInboxSelectionHistory", () => ({ default: () => {} }));
vi.mock("./useInboxUndoSlot", () => ({
  default: () => ({ undo: null, onUndo: () => {}, commit: () => {}, settle: () => {} }),
}));
vi.mock("./useInboxActionDispatch", () => ({ default: () => ({ onAction: () => {} }) }));
vi.mock("./useInboxKeyboardCommands", () => ({ default: () => {} }));
vi.mock("./useSnapshotOptimisticOverlay", () => ({
  default: () => ({ overlayEmails: [], applyOverlay: () => {}, reconcile: () => {} }),
}));
vi.mock("../../api", () => ({
  markEmailAsRead: vi.fn(),
  markAllEmailsAsRead: vi.fn(),
  searchEmails: vi.fn().mockResolvedValue({ results: [] }),
}));

import useInboxController from "./useInboxController";

// Stable references: the controller resets snoozedMap/resurfacedMap in effects
// keyed on snoozedEntries/resurfacedEntries, and re-reads emailAccounts/liveEmails
// in memos. The function-arg defaults (`= []`) allocate a fresh array each render,
// which would make those deps change every render and re-render forever. Hold one
// args object per render so every dep keeps a stable identity across re-renders.
const EMPTY = Object.freeze([]);

function renderController(extra = {}) {
  const args = {
    emailAccounts: EMPTY,
    activeSnapshot: null,
    liveEmails: EMPTY,
    snoozedEntries: EMPTY,
    resurfacedEntries: EMPTY,
    sessionState: { accountId: "__all", lane: "__all", search: "", selectedId: null },
    onSessionStateChange: () => {},
    ...extra,
  };
  return renderHook(() => useInboxController(args));
}

describe("useInboxController resolves hardcoded prefs without a customize store", () => {
  it("does not require a customize argument", () => {
    expect(() => renderController()).not.toThrow();
  });

  it("resolves the former-default desktop inbox config", () => {
    const { result } = renderController({ isMobile: false });
    expect(result.current.showTriage).toBe(true);
    expect(result.current.showDraft).toBe(false);
    expect(result.current.showPreview).toBe(true);
    expect(result.current.density).toBe("comfortable");
    expect(result.current.layout).toBe("two-pane");
    expect(result.current.grouping).toBe("swimlanes");
  });

  it("keeps the mobile-forced flat/two-pane config", () => {
    const { result } = renderController({ isMobile: true });
    expect(result.current.showPreview).toBe(true);
    expect(result.current.density).toBe("comfortable");
    expect(result.current.layout).toBe("two-pane");
    expect(result.current.grouping).toBe("flat");
  });
});
