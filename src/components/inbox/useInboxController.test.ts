import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InboxEmailLike } from "./inboxTypes";
import type { InboxControllerOptions } from "./useInboxController";

vi.mock("../../hooks/email/useInboxSelectionHistory", () => ({ default: () => {} }));
vi.mock("./useInboxUndoSlot", () => ({
  default: () => ({ undo: null, onUndo: () => {}, commit: () => {}, settle: () => {} }),
}));
vi.mock("./useInboxActionDispatch", () => ({ default: () => ({ onAction: () => {} }) }));
vi.mock("./useInboxKeyboardCommands", () => ({ default: () => {} }));
vi.mock("./useSnapshotOptimisticOverlay", () => ({
  default: ({ activeSnapshotMode, rawActiveSnapshotEmails }: { activeSnapshotMode: boolean; rawActiveSnapshotEmails: InboxEmailLike[] }) => ({
    optimisticActiveSnapshotEmails: activeSnapshotMode ? rawActiveSnapshotEmails : [],
    setSnapshotOptimistic: () => {},
    snapshotPendingRef: { current: new Set() },
    snapshotRequestRef: { current: 0 },
  }),
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
const EMPTY: [] = [];

function renderController(extra: Partial<InboxControllerOptions> = {}) {
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

describe("useInboxController pinned rows", () => {
  const pinnedEntry = {
    uid: "pinned-1",
    pinned_at: "2026-06-30T12:00:00.000Z",
    account_id: "acct-1",
    subject: "Pinned subject",
    from_name: "Dana",
    from_address: "dana@example.com",
    preview: "hi",
    date: "2026-06-29T10:00:00.000Z",
    read: false,
    account_label: "Work",
    account_email: "work@example.com",
    account_color: "#89b4fa",
    account_icon: "Mail",
    lane: null,
    urgency: null,
    category: null,
    handled_at: null,
    provider_state: null,
  };

  function snapshotWithPinned(pinned: unknown[], extra: Record<string, unknown> = {}) {
    return {
      snapshot: { id: "snap-1" },
      filters: { accounts: [], categories: [] },
      lanes: {},
      carryover: [],
      pinned,
      ...extra,
    };
  }

  it("surfaces a _pinned row for an activeSnapshot.pinned entry", () => {
    const { result } = renderController({
      activeSnapshot: snapshotWithPinned([pinnedEntry]),
    });

    const row = result.current.visibleEmails.find((email) => (email.uid || email.id) === "pinned-1");
    expect(row).toBeTruthy();
    expect(row?._pinned).toBe(true);
  });

  it("dedups a pinned uid that is also a snapshot item into exactly one row", () => {
    const snapshotItem = {
      uid: "dual-1",
      email_id: "dual-1",
      snapshot_item_id: 77,
      subject: "Also pinned",
      lane: "needs_attention",
      account_id: "acct-1",
    };
    const { result } = renderController({
      activeSnapshot: snapshotWithPinned(
        [{ ...pinnedEntry, uid: "dual-1" }],
        { lanes: { needs_attention: [snapshotItem] } },
      ),
    });

    const matches = result.current.visibleEmails.filter((email) => (email.uid || email.id) === "dual-1");
    expect(matches).toHaveLength(1);
    expect(matches[0]?._pinned).toBe(true);
    expect(matches[0]?.snapshot_item_id).toBe(77);
  });

  it("contributes NO pinned rows when readOnly is true", () => {
    const { result } = renderController({
      activeSnapshot: snapshotWithPinned([pinnedEntry]),
      readOnly: true,
    });

    const row = result.current.visibleEmails.find((email) => (email.uid || email.id) === "pinned-1");
    expect(row).toBeUndefined();
  });
});
